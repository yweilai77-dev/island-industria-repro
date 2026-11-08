import { createPlacement, type Rotation } from '../grid/grid.ts';
import { coreForPart } from '../industrial/catalog.ts';
import { MaterialLinkRuntime, type LinkScene } from '../industrial/link-runtime.ts';
import { createPortFlowGateway } from '../industrial/port-flow.ts';
import { PortRuntime } from '../industrial/port-runtime.ts';
import { createInventoryService, type InventoryService } from '../inventory/inventory.ts';
import { MECHANICAL_PART_DEFS, type MechanicalPart, type PartId } from '../mechanical/parts.ts';
import { ProductionRuntime } from '../production/production-runtime.ts';
import { recipesFor } from '../production/recipes.ts';
import type { PortEndpoint } from '../industrial/runtime-model.ts';

/**
 * P2-C 物料流集成测试的共享装置：
 * 真实 `ProductionRuntime` + 真实 `PortRuntime` + 真实 `MaterialLinkRuntime` + 共用网关
 *（与游戏跑的是同一份实现）。`link-flow.test.ts` 与 `link-distribution.test.ts` 共用，
 * 避免两份装置漂移。本文件不是测试文件（不以 `.test.ts` 结尾）。
 */

export const CRUSHER = coreForPart('crusher')!;
export const SMELTER = coreForPart('smelter')!;
export const OUT = 'slot.crusher.out.px';
export const CRUSHER_IN = 'slot.crusher.in.nz';
export const SMELTER_IN = 'slot.smelter.in.nz';

export function part(id: number, defId: PartId, gx: number, gz: number, rotation: Rotation = 0): MechanicalPart {
  const def = MECHANICAL_PART_DEFS[defId];
  return { id, def, placement: createPlacement(gx, gz, def.w, def.d, rotation, 0) };
}

export interface Rig {
  parts: MechanicalPart[];
  readonly production: ProductionRuntime;
  readonly ports: PortRuntime;
  readonly links: MaterialLinkRuntime;
  readonly inventory: InventoryService;
  readonly out: PortEndpoint;
  readonly smelterIn: PortEndpoint;
  scene(): LinkScene;
}

export function rigOf(parts: MechanicalPart[]): Rig {
  const byCell = new Map<string, MechanicalPart>();
  for (const entry of parts) {
    byCell.set(`${entry.placement.gx},${entry.placement.gz},${entry.placement.level}`, entry);
  }
  const inventory = createInventoryService();
  const ports = new PortRuntime();
  const links = new MaterialLinkRuntime();
  const scene = (): LinkScene => ({
    partOf: (partId) => parts.find((entry) => entry.id === partId),
    portOf: (partId, slotId) => ports.get(partId, slotId),
  });
  const production = new ProductionRuntime({
    partAt: (cell, level) => byCell.get(`${cell.gx},${cell.gz},${level}`),
    addItem: (itemId, count) => { inventory.add(itemId, count); },
    ports: createPortFlowGateway(ports, { step: () => links.step(scene(), ports) }),
  });
  production.sync(parts);
  return {
    parts,
    production,
    ports,
    links,
    inventory,
    out: { entityId: 1, slotId: OUT },
    smelterIn: { entityId: 2, slotId: SMELTER_IN },
    scene,
  };
}

/** 破碎机(0,0) 朝 0° ──对接── 熔炼炉(1,0) 朝 90°。 */
export function dockedRig(): Rig {
  const rig = rigOf([part(1, 'crusher', 0, 0, 0), part(2, 'smelter', 1, 0, 90)]);
  rig.ports.install(1, CRUSHER, OUT, 'port.output');
  rig.ports.install(2, SMELTER, SMELTER_IN, 'port.through');
  return rig;
}

export function run(rig: Rig, seconds: number, delta = 0.1): void {
  const steps = Math.round(seconds / delta);
  for (let index = 0; index < steps; index += 1) rig.production.tick(delta);
}

export function power(rig: Rig, partId: number, rate = 4): void {
  rig.production.setPowerReading(partId, { powered: true, rate });
}

export function machine(rig: Rig, partId: number) {
  return rig.production.snapshot().machines.find((entry) => entry.partId === partId);
}

/**
 * 全系统物料总数（库存 + 机器缓冲 + 溜槽在途 + 接口盒缓冲 + **正在加工的已消耗原料**）。
 * 加工状态机在周期开始时整笔消耗原料，所以物料守恒必须把「在制」的原料算回来，
 * 否则刚开工的那一帧会误报丢料（这是状态机的既有语义，不是 P2-C 引入的问题）。
 */
export function totalItems(rig: Rig): number {
  let total = 0;
  for (const stack of rig.inventory.stacks()) total += stack.count;
  const snapshot = rig.production.snapshot();
  for (const entry of snapshot.machines) total += entry.inputCount + entry.outputCount;
  for (const entry of snapshot.chutes) total += entry.itemId === null ? 0 : 1;
  for (const port of rig.ports.snapshot()) total += port.count;
  for (const entry of snapshot.machines) {
    if (entry.progress <= 0) continue;
    const def = rig.parts.find((part) => part.id === entry.partId)?.def;
    if (!def) continue;
    const list = recipesFor(def.id);
    const recipe = list[Math.min(Math.max(entry.recipeIndex, 0), list.length - 1)];
    total += recipe?.inputs[0]?.count ?? 0;
  }
  return total;
}

export function producedOf(rig: Rig, itemId: string): number {
  return rig.production.snapshot().produced.find((entry) => entry.itemId === itemId)?.count ?? 0;
}
