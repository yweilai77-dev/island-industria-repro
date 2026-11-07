import type { Cell } from '../grid/grid.ts';
import type { ItemId } from '../items/items.ts';
import { isProductionMachine, type MechanicalPart, type MechanicalPartDef } from '../mechanical/parts.ts';
import { recipesFor } from './recipes.ts';
import {
  createMachineState,
  cycleRecipe,
  flushMachine,
  insertInput,
  takeOutput,
  tickMachine,
  activeRecipe,
  acceptedInputOf,
  type MachineState,
} from './production.ts';
import {
  acceptItem,
  advanceChute,
  chuteNextCell,
  createChuteState,
  flushChute,
  markBlocked,
  readyForHandoff,
  releaseItem,
  type ChuteState,
} from './transport.ts';

/**
 * M1.8-C/D 生产与运输运行时（纯状态容器 + 每帧推进，不持有实体、不直接写库存）。
 *
 * 职责边界：
 * - 只根据 `mechanical.parts()` 的机械零件、动力解算结果（由调用方注入）推进；
 * - 物品所有权在 **机器缓冲 / 溜槽在途 / 玩家库存** 三者之间显式转移，任何一刻只有一处持有；
 * - 零件被拆除时把缓冲/在途物品交回库存，**永不销毁物品**；
 * - 不做任何渲染；物品视觉由 runtime 读取本状态后写 Transform。
 */

export interface PowerReading {
  readonly powered: boolean;
  /** 实际转速 / 额定 60 RPM。 */
  readonly rate: number;
}

export interface ProductionRuntimeOptions {
  readonly partAt: (cell: Cell, level: number) => MechanicalPart | undefined;
  readonly addItem: (itemId: ItemId, count: number) => void;
}

export interface MachineSnapshot {
  readonly partId: number;
  readonly recipeId: string | null;
  readonly recipeLabel: string | null;
  readonly recipeIndex: number;
  readonly recipeCount: number;
  readonly progress: number;
  readonly inputItem: ItemId | null;
  readonly inputCount: number;
  readonly outputItem: ItemId | null;
  readonly outputCount: number;
  readonly running: boolean;
  readonly block: string;
  readonly producedTotal: number;
  readonly powered: boolean;
}

export interface ChuteSnapshot {
  readonly partId: number;
  readonly itemId: ItemId | null;
  readonly t: number;
  readonly blocked: boolean;
  readonly delivered: number;
}

export interface ProductionSnapshot {
  readonly machines: readonly MachineSnapshot[];
  readonly chutes: readonly ChuteSnapshot[];
  /** 累计产出（所有机器、全部时间）。 */
  readonly produced: readonly { readonly itemId: ItemId; readonly count: number }[];
}

/** 溜槽朝向（本地 +X 旋转后的世界方向），与机械端口同一约定。 */
function directionOf(rotation: number): { readonly dx: number; readonly dz: number } {
  switch (rotation) {
    case 0: return { dx: 1, dz: 0 };
    case 90: return { dx: 0, dz: -1 };
    case 180: return { dx: -1, dz: 0 };
    case 270: return { dx: 0, dz: 1 };
    default: return { dx: 1, dz: 0 };
  }
}

export class ProductionRuntime {
  private readonly machines = new Map<number, MachineState>();
  private readonly chutes = new Map<number, ChuteState>();
  private readonly partMap = new Map<number, MechanicalPart>();
  private readonly producedTotals = new Map<ItemId, number>();
  private readonly powerReadings = new Map<number, PowerReading>();
  private readonly options: ProductionRuntimeOptions;

  constructor(options: ProductionRuntimeOptions) {
    this.options = options;
  }

  /** 每帧同步零件集合：新增建状态，消失的零件把物品交回库存。 */
  sync(parts: readonly MechanicalPart[]): void {
    const seen = new Set<number>();
    this.partMap.clear();
    for (const part of parts) {
      seen.add(part.id);
      this.partMap.set(part.id, part);
      if (part.def.kind === 'machine' && isProductionMachine(part.def)) {
        if (!this.machines.has(part.id)) this.machines.set(part.id, createMachineState(part.id));
      }
      if (part.def.kind === 'transport') {
        if (!this.chutes.has(part.id)) this.chutes.set(part.id, createChuteState());
      }
    }
    for (const [partId, state] of [...this.machines]) {
      if (seen.has(partId)) continue;
      for (const item of flushMachine(state)) this.options.addItem(item.itemId, item.count);
      this.machines.delete(partId);
      this.powerReadings.delete(partId);
    }
    for (const [partId, state] of [...this.chutes]) {
      if (seen.has(partId)) continue;
      const item = flushChute(state);
      if (item) this.options.addItem(item.itemId, 1);
      this.chutes.delete(partId);
    }
  }

  machineState(partId: number): MachineState | undefined {
    return this.machines.get(partId);
  }

  chuteState(partId: number): ChuteState | undefined {
    return this.chutes.get(partId);
  }

  partOf(partId: number): MechanicalPart | undefined {
    return this.partMap.get(partId);
  }

  /** 玩家往机器里投料；返回实际投入数量。 */
  insertInto(partId: number, itemId: ItemId, count = 1): number {
    const state = this.machines.get(partId);
    const part = this.partMap.get(partId);
    if (!state || !part) return 0;
    return insertInput(state, part.def, itemId, count);
  }

  /**
   * 从玩家库存「投料」：按当前配方需要的原料取 1 件放进输入缓冲。
   * 这样玩家不必先把矿石绑到快捷栏（快捷栏 12 格已被 11 种零件占满）。
   */
  loadFromInventory(
    partId: number,
    io: { has: (itemId: ItemId, count: number) => boolean; remove: (itemId: ItemId, count: number) => boolean },
  ): number {
    const state = this.machines.get(partId);
    const part = this.partMap.get(partId);
    if (!state || !part) return 0;
    const accepted = acceptedInputOf(state, part.def);
    if (accepted === undefined) return 0;
    if (!io.has(accepted, 1)) return 0;
    const inserted = insertInput(state, part.def, accepted, 1);
    if (inserted <= 0) return 0;
    io.remove(accepted, inserted);
    return inserted;
  }

  /** 玩家从机器取出产物；返回取出的物品（由调用方加入库存）。 */
  takeFrom(partId: number, count = Number.MAX_SAFE_INTEGER): { readonly itemId: ItemId; readonly count: number } | undefined {
    const state = this.machines.get(partId);
    if (!state) return undefined;
    return takeOutput(state, count);
  }

  /** R 切换配方；进度未开始时才允许。 */
  cycleMachineRecipe(partId: number): boolean {
    const state = this.machines.get(partId);
    const part = this.partMap.get(partId);
    if (!state || !part) return false;
    return cycleRecipe(state, part.def);
  }

  setPowerReading(partId: number, reading: PowerReading): void {
    this.powerReadings.set(partId, reading);
  }

  powerOf(partId: number): PowerReading {
    return this.powerReadings.get(partId) ?? { powered: false, rate: 0 };
  }

  /**
   * 推进一帧：机器加工 → 机器把产物推进相邻溜槽 → 溜槽下滑并交接。
   * 顺序保证同一帧内物品最多移动一格，不会「穿透」整条链。
   */
  tick(delta: number): void {
    for (const [partId, state] of this.machines) {
      const part = this.partMap.get(partId);
      if (!part) continue;
      const reading = this.powerOf(partId);
      this.tickMachineAndRecord(state, part.def, reading, delta);
    }
    this.pushMachineOutputs();
    for (const [partId, state] of this.chutes) {
      const part = this.partMap.get(partId);
      if (!part) continue;
      advanceChute(state, delta);
      if (!readyForHandoff(state)) continue;
      this.handoff(part, state);
    }
  }

  private tickMachineAndRecord(
    state: MachineState,
    def: MechanicalPartDef,
    reading: PowerReading,
    delta: number,
  ): void {
    const completed = tickMachine(state, {
      def,
      powered: reading.powered,
      rate: reading.rate,
      delta,
    });
    if (!completed) return;
    const recipe = activeRecipe(state, def);
    const out = recipe?.outputs[0];
    if (!out) return;
    this.producedTotals.set(out.itemId, (this.producedTotals.get(out.itemId) ?? 0) + out.count);
  }

  /** 机器输出端（本地 +X 方向）相邻的溜槽自动接货。 */
  private pushMachineOutputs(): void {
    for (const [partId, state] of this.machines) {
      if (state.outputCount <= 0 || state.outputItem === null) continue;
      const part = this.partMap.get(partId);
      if (!part) continue;
      const dir = directionOf(part.placement.rotation);
      const cell = { gx: part.placement.gx + dir.dx, gz: part.placement.gz + dir.dz };
      const target = this.options.partAt(cell, part.placement.level);
      if (!target || target.def.kind !== 'transport') continue;
      const chute = this.chutes.get(target.id);
      if (!chute) continue;
      if (!acceptItem(chute, state.outputItem)) continue;
      state.outputCount -= 1;
      if (state.outputCount <= 0) {
        state.outputCount = 0;
        state.outputItem = null;
      }
    }
  }

  private handoff(part: MechanicalPart, state: ChuteState): void {
    const nextCell = chuteNextCell(part.placement);
    const target = this.options.partAt(nextCell, part.placement.level);
    if (target === undefined) {
      // 末端没有东西：交给玩家库存（本作唯一的「储存位置」）。
      const item = releaseItem(state);
      if (item) this.options.addItem(item.itemId, 1);
      return;
    }
    if (target.def.kind === 'transport') {
      const nextChute = this.chutes.get(target.id);
      if (!nextChute || state.item === null) {
        markBlocked(state);
        return;
      }
      if (nextChute.item !== null) {
        markBlocked(state);
        return;
      }
      acceptItem(nextChute, state.item.itemId);
      releaseItem(state);
      return;
    }
    if (target.def.kind === 'machine' && isProductionMachine(target.def)) {
      const machine = this.machines.get(target.id);
      if (!machine || state.item === null) {
        markBlocked(state);
        return;
      }
      const inserted = insertInput(machine, target.def, state.item.itemId, 1);
      if (inserted <= 0) {
        markBlocked(state);
        return;
      }
      releaseItem(state);
      return;
    }
    // 下一格是别的零件（支柱/轴/齿轮…）：堵住，不支持把物品塞进它们。
    markBlocked(state);
  }

  snapshot(): ProductionSnapshot {
    const machines: MachineSnapshot[] = [...this.machines.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([partId, state]) => {
        const part = this.partMap.get(partId);
        const recipe = part ? activeRecipe(state, part.def) : undefined;
        return {
          partId,
          recipeId: recipe?.id ?? null,
          recipeLabel: recipe?.label ?? null,
          recipeIndex: state.recipeIndex,
          recipeCount: part ? recipesFor(part.def.id).length : 0,
          progress: state.progress,
          inputItem: state.inputItem,
          inputCount: state.inputCount,
          outputItem: state.outputItem,
          outputCount: state.outputCount,
          running: state.running,
          block: state.block,
          producedTotal: state.producedTotal,
          powered: this.powerOf(partId).powered,
        };
      });
    const chutes: ChuteSnapshot[] = [...this.chutes.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([partId, state]) => ({
        partId,
        itemId: state.item?.itemId ?? null,
        t: state.item?.t ?? 0,
        blocked: state.item?.blocked ?? false,
        delivered: state.delivered,
      }));
    const produced = [...this.producedTotals.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([itemId, count]) => ({ itemId, count }));
    return { machines, chutes, produced };
  }

  clear(): void {
    this.machines.clear();
    this.chutes.clear();
    this.partMap.clear();
    this.producedTotals.clear();
    this.powerReadings.clear();
  }
}

/** 已产出物品总数（生产目标读数）。 */
export function producedCountOf(snapshot: ProductionSnapshot, itemId: ItemId): number {
  return snapshot.produced.find((entry) => entry.itemId === itemId)?.count ?? 0;
}
