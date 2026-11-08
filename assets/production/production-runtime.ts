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
  chuteDirectionOf,
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

/**
 * 输出接口的窄视图：加工运行时只需要知道「往哪个安装位投料」，不认识接口盒结构。
 */
export interface PortOutputTarget {
  readonly slotId: string;
}

/**
 * P2-B/P2-C 物料流网关：把「接口盒 / 物料连接」接进加工运行时，同时不让加工运行时
 * 认识它们的内部结构。
 *
 * 语义：
 * - 自动输入**必须**经过已安装的输入接口盒；没有盒子 → 溜槽堵塞（不吞料、不丢料）。
 * - 手动投料（玩家按 C / 右键）**不走**这个网关，直接进机器输入缓冲，与接口盒并存。
 * - 自动输出**必须**经过已安装的输出接口盒（P2-C）：机器产物先进接口盒缓冲，
 *   再由物料连接送到下游；没有输出接口时保持 M1.8 的「产物推到相邻溜槽」行为。
 * - 没有注入网关时（旧单测场景）自动输入/输出/连接一律不成立。
 */
export interface PortFlowGateway {
  /** 溜槽末端把 1 件物料交给该机器的输入接口盒；成功接收返回 true。 */
  acceptFromChute(
    part: MechanicalPart,
    itemId: ItemId,
    incoming: { readonly dx: number; readonly dz: number },
  ): boolean;
  /** 把输入接口盒缓冲里的物料推进机器输入缓冲；返回实际转移件数。 */
  drain(partId: number, tryInsert: (itemId: ItemId) => boolean): number;
  /** 该机器上已安装的输出接口（自动输出的合法目标，按安装位排序）。 */
  outputBoxesOf(partId: number): readonly PortOutputTarget[];
  /** 往输出接口投 1 件物料；容量满/物料类型不符返回 false。 */
  acceptInto(partId: number, slotId: string, itemId: ItemId): boolean;
  /** 推进所有物料连接；返回传递件数（P2-C）。 */
  stepLinks(): number;
}

export interface ProductionRuntimeOptions {
  readonly partAt: (cell: Cell, level: number) => MechanicalPart | undefined;
  readonly addItem: (itemId: ItemId, count: number) => void;
  /** P2-B 接口盒网关；缺省表示该场景不支持自动输入。 */
  readonly ports?: PortFlowGateway;
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
   * 推进一帧：输入接口盒 → 机器输入缓冲 → 机器输出缓冲 → 输出接口盒 → 物料连接 →
   * 机器加工 → 机器产物推到相邻溜槽 → 溜槽下滑并交接。
   *
   * 顺序保证：
   * - 先 drain（盒→机器）再加工，本帧到达的物料本帧就可能开工；
   * - 先 pull（机器→输出盒）再推进连接，连接当帧就能把货送到下游输入盒；
   * - 机器产物推给相邻溜槽仍排在最后：装了输出接口时产物优先走接口盒，
   *   接口盒满了才溢出到溜槽（未装盒玩家保持 M1.8 行为）。
   */
  tick(delta: number): void {
    for (const [partId, state] of this.machines) {
      const part = this.partMap.get(partId);
      if (!part) continue;
      // P2-B：先把输入接口盒里的物料推进机器输入缓冲，再推进加工。
      // 顺序保证「本帧到达的物料本帧就可能开工」，且 drain 内部是原子转移。
      this.options.ports?.drain(partId, (itemId) => insertInput(state, part.def, itemId, 1) > 0);
    }
    // P2-C：机器输出缓冲 → 输出接口盒缓冲 → 物料连接（连接两端都是接口盒缓冲）。
    this.pullToOutputPorts();
    this.options.ports?.stepLinks();
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
      // P2-B：堵塞是「暂时」状态而不是永久死亡。堵住的物品停在槽口不动，
      // 但每帧都在重试交接 —— 下游恢复（装上接口盒 / 盒子腾出空间 / 机器缓冲腾空）
      // 后物品会自动继续走，不需要玩家干预。位置不重置，所以读数与画面都不抖。
      if (state.item?.blocked === true) {
        this.handoff(part, state);
        continue;
      }
      advanceChute(state, delta);
      if (!readyForHandoff(state)) continue;
      this.handoff(part, state);
    }
  }

  /**
   * 机器输出缓冲 → 已装输出接口盒（P2-C）。
   * 只有装了输出接口的机器才走这条路；没有接口盒时产物继续留在机器输出缓冲，
   * 由随后的 `pushMachineOutputs()` 交给相邻溜槽（M1.8 行为不变）。
   */
  private pullToOutputPorts(): void {
    const gateway = this.options.ports;
    if (!gateway) return;
    for (const [partId, state] of this.machines) {
      if (state.outputCount <= 0 || state.outputItem === null) continue;
      const targets = gateway.outputBoxesOf(partId);
      if (targets.length === 0) continue;
      for (const target of targets) {
        while (state.outputCount > 0 && state.outputItem !== null) {
          if (!gateway.acceptInto(partId, target.slotId, state.outputItem)) break;
          takeOutput(state, 1);
        }
        if (state.outputCount <= 0) break;
      }
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
      if (state.item === null) {
        markBlocked(state);
        return;
      }
      // P2-B（方案 P1）：自动输入必须经过装在该机器输入安装位上的接口盒。
      // 没装盒、盒子满了、或溜槽没有正对安装位的面 → 堵塞：物品留在溜槽上，不吞不丢。
      const delivered = this.options.ports?.acceptFromChute(
        target,
        state.item.itemId,
        chuteDirectionOf(part.placement.rotation),
      ) ?? false;
      if (!delivered) {
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
