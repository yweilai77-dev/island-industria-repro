import { describe, expect, it } from 'vitest';
import { createPlacement, type Rotation } from '../grid/grid.ts';
import { coreForPart } from '../industrial/catalog.ts';
import { createPortFlowGateway } from '../industrial/port-flow.ts';
import { PortRuntime } from '../industrial/port-runtime.ts';
import { createInventoryService, type InventoryService } from '../inventory/inventory.ts';
import { MECHANICAL_PART_DEFS, type MechanicalPart, type PartId } from '../mechanical/parts.ts';
import { ProductionRuntime } from '../production/production-runtime.ts';

/**
 * P2-B 物料流集成测试：真实 `ProductionRuntime` + 真实 `PortRuntime` + 共用网关。
 *
 * 布局与 `scripts/m18c-production.mjs` 的已验收产线一致：
 *   破碎机(-3,8) --产物推到 +X--> 溜槽(-2,8) --朝 +Z 推--> 熔炼炉(-2,9)
 * 熔炼炉输入安装位在 -Z 面，所以溜槽必须从 -Z 侧朝 +Z 推才算「正对接口」。
 *
 * 这些用例覆盖任务书 §6.1 的自动输入相关条目：
 * 未装盒禁止自动输入 / 装盒后允许 / 盒容量 / 核心容量 / 新旧输入路径并存 /
 * 同一物料不重复转移 / 上游物料不丢失。
 */

function part(id: number, defId: PartId, gx: number, gz: number, rotation: Rotation = 0): MechanicalPart {
  const def = MECHANICAL_PART_DEFS[defId];
  return { id, def, placement: createPlacement(gx, gz, def.w, def.d, rotation, 0) };
}

const CRUSHER_ID = 1;
const CHUTE_ID = 2;
const SMELTER_ID = 3;
const SMELTER_IN = 'slot.smelter.in.nz';

interface Rig {
  readonly parts: readonly MechanicalPart[];
  readonly production: ProductionRuntime;
  readonly ports: PortRuntime;
  readonly inventory: InventoryService;
}

function rig(): Rig {
  const parts: MechanicalPart[] = [
    part(CRUSHER_ID, 'crusher', -3, 8, 0),
    part(CHUTE_ID, 'chute', -2, 8, 270),
    part(SMELTER_ID, 'smelter', -2, 9, 0),
  ];
  const byCell = new Map<string, MechanicalPart>();
  for (const entry of parts) {
    byCell.set(`${entry.placement.gx},${entry.placement.gz},${entry.placement.level}`, entry);
  }
  const inventory = createInventoryService();
  const ports = new PortRuntime();
  const production = new ProductionRuntime({
    partAt: (cell, level) => byCell.get(`${cell.gx},${cell.gz},${level}`),
    addItem: (itemId, count) => { inventory.add(itemId, count); },
    ports: createPortFlowGateway(ports),
  });
  production.sync(parts);
  return { parts, production, ports, inventory, byCell } as Rig;
}

/** 以 deci-second 推进，等价于真实 Update 每帧 0.1s 上限。 */
function run(production: ProductionRuntime, seconds: number, delta = 0.1): void {
  const steps = Math.round(seconds / delta);
  for (let index = 0; index < steps; index += 1) production.tick(delta);
}

function power(production: ProductionRuntime, partId: number, rate = 4): void {
  production.setPowerReading(partId, { powered: true, rate });
}

function installSmelterBox(target: Rig): PortRuntime {
  const core = coreForPart('smelter')!;
  expect(target.ports.install(SMELTER_ID, core, SMELTER_IN, 'port.through')).toEqual({ ok: true });
  return target.ports;
}

describe('未安装接口盒：自动输入不成立', () => {
  it('溜槽把产物推到机器前面就堵住，物品留在槽上不丢', () => {
    const target = rig();
    power(target.production, CRUSHER_ID);
    expect(target.production.insertInto(CRUSHER_ID, 'iron_ore', 1)).toBe(1);
    run(target.production, 4);

    const chute = target.production.chuteState(CHUTE_ID);
    expect(chute?.item?.itemId).toBe('crushed_ore');
    run(target.production, 2);
    expect(target.production.chuteState(CHUTE_ID)?.item?.blocked).toBe(true);
    // 没有接口盒 → 机器输入缓冲一件也没进；物品仍在溜槽上，没有被吞掉。
    expect(target.production.machineState(SMELTER_ID)?.inputCount).toBe(0);
    expect(target.production.chuteState(CHUTE_ID)?.item?.itemId).toBe('crushed_ore');
    expect(target.inventory.count('crushed_ore')).toBe(0);
  });

  it('网关在没装盒时拒绝任何投递', () => {
    const target = rig();
    const smelter = target.parts.find((entry) => entry.id === SMELTER_ID)!;
    const gateway = createPortFlowGateway(target.ports);
    expect(gateway.acceptFromChute(smelter, 'crushed_ore', { dx: 0, dz: 1 })).toBe(false);
  });
});

describe('安装接口盒后：自动输入成立', () => {
  it('物品经溜槽进接口盒，再进机器输入缓冲，机器完成真实熔炼', () => {
    const target = rig();
    installSmelterBox(target);
    power(target.production, CRUSHER_ID);
    power(target.production, SMELTER_ID);
    expect(target.production.insertInto(CRUSHER_ID, 'iron_ore', 1)).toBe(1);

    run(target.production, 12);

    const produced = target.production.snapshot().produced;
    expect(produced.find((entry) => entry.itemId === 'iron_ingot')?.count).toBe(1);
    // 一件碎铁矿从破碎机产出、经溜槽与接口盒进入熔炼炉，全程只被一方持有。
    expect(produced.find((entry) => entry.itemId === 'crushed_ore')?.count).toBe(1);
    const box = target.ports.get(SMELTER_ID, SMELTER_IN);
    expect(box?.count).toBe(0);
    expect(target.production.chuteState(CHUTE_ID)?.item).toBeNull();
  });

  it('接口盒只有在溜槽正对安装位所在的面时才收料', () => {
    const target = rig();
    installSmelterBox(target);
    const smelter = target.parts.find((entry) => entry.id === SMELTER_ID)!;
    const gateway = createPortFlowGateway(target.ports);
    // 熔炼炉 rotation=0 时输入位在 -Z 面 → 物料必须朝 +Z 进入。
    expect(gateway.acceptFromChute(smelter, 'crushed_ore', { dx: 1, dz: 0 })).toBe(false);
    expect(gateway.acceptFromChute(smelter, 'crushed_ore', { dx: 0, dz: -1 })).toBe(false);
    expect(target.ports.get(SMELTER_ID, SMELTER_IN)?.count).toBe(0);
    expect(gateway.acceptFromChute(smelter, 'crushed_ore', { dx: 0, dz: 1 })).toBe(true);
    expect(target.ports.get(SMELTER_ID, SMELTER_IN)?.count).toBe(1);
  });

  it('机器输入缓冲满了以后，接口盒停止推进并自己留着物料', () => {
    const target = rig();
    installSmelterBox(target);
    // 熔炼炉不给动力：加工不推进，输入缓冲会被填满。
    for (let index = 0; index < 4; index += 1) target.ports.accept(SMELTER_ID, SMELTER_IN, 'crushed_ore');
    target.production.tick(0.1);
    expect(target.production.machineState(SMELTER_ID)?.inputCount).toBe(4);
    expect(target.ports.get(SMELTER_ID, SMELTER_IN)?.count).toBe(0);

    for (let index = 0; index < 4; index += 1) target.ports.accept(SMELTER_ID, SMELTER_IN, 'crushed_ore');
    target.production.tick(0.1);
    expect(target.production.machineState(SMELTER_ID)?.inputCount).toBe(4);
    expect(target.ports.get(SMELTER_ID, SMELTER_IN)?.count).toBe(4);
  });

  it('接口盒满了以后不再接收，上游溜槽保持堵塞不丢料', () => {
    const target = rig();
    installSmelterBox(target);
    for (let index = 0; index < 4; index += 1) target.ports.accept(SMELTER_ID, SMELTER_IN, 'crushed_ore');
    const smelter = target.parts.find((entry) => entry.id === SMELTER_ID)!;
    const gateway = createPortFlowGateway(target.ports);
    expect(gateway.acceptFromChute(smelter, 'crushed_ore', { dx: 0, dz: 1 })).toBe(false);
    expect(target.ports.get(SMELTER_ID, SMELTER_IN)?.count).toBe(4);
  });
});

describe('新旧输入路径共存', () => {
  it('手动投料与接口盒自动输入写进同一个输入缓冲，不重复', () => {
    const target = rig();
    installSmelterBox(target);
    expect(target.ports.accept(SMELTER_ID, SMELTER_IN, 'crushed_ore')).toBe(true);
    target.production.tick(0.1);
    expect(target.production.machineState(SMELTER_ID)?.inputCount).toBe(1);

    // 原有手动路径：玩家按 C / 右键从库存投料，完全不走接口盒。
    expect(target.production.insertInto(SMELTER_ID, 'crushed_ore', 1)).toBe(1);
    expect(target.production.machineState(SMELTER_ID)?.inputCount).toBe(2);
    expect(target.ports.get(SMELTER_ID, SMELTER_IN)?.count).toBe(0);
  });

  it('没有接口盒时手动投料照常可用（旧玩法不退化）', () => {
    const target = rig();
    power(target.production, SMELTER_ID);
    expect(target.production.insertInto(SMELTER_ID, 'crushed_ore', 2)).toBe(2);
    run(target.production, 8);
    expect(target.production.snapshot().produced.find((entry) => entry.itemId === 'iron_ingot')?.count)
      .toBeGreaterThanOrEqual(1);
  });
});

describe('拆卸与拆机时物料安全', () => {
  it('拆下接口盒后自动输入立即停止，盒内物料由拆卸方交回', () => {
    const target = rig();
    installSmelterBox(target);
    target.ports.accept(SMELTER_ID, SMELTER_IN, 'crushed_ore');
    target.ports.accept(SMELTER_ID, SMELTER_IN, 'crushed_ore');
    const removal = target.ports.remove(SMELTER_ID, SMELTER_IN);
    expect(removal).toEqual({ moduleItemId: 'interface_box', bufferItemId: 'crushed_ore', bufferCount: 2 });
    const smelter = target.parts.find((entry) => entry.id === SMELTER_ID)!;
    expect(createPortFlowGateway(target.ports).acceptFromChute(smelter, 'crushed_ore', { dx: 0, dz: 1 })).toBe(false);
  });

  it('机器被拆掉时接口盒与盒内物料一起交回，不静默销毁', () => {
    const target = rig();
    installSmelterBox(target);
    target.ports.accept(SMELTER_ID, SMELTER_IN, 'crushed_ore');
    const alive = new Set([CRUSHER_ID, CHUTE_ID]);
    const removed = target.ports.sync(alive);
    expect(removed).toHaveLength(1);
    expect(removed[0]?.partId).toBe(SMELTER_ID);
    expect(removed[0]?.items).toEqual([
      { itemId: 'interface_box', count: 1 },
      { itemId: 'crushed_ore', count: 1 },
    ]);
    for (const item of removed[0]?.items ?? []) target.inventory.add(item.itemId, item.count);
    expect(target.inventory.count('interface_box')).toBe(1);
    expect(target.inventory.count('crushed_ore')).toBe(1);
  });
});
