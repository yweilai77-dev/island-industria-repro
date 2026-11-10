import { describe, expect, it } from 'vitest';
import { createPlacement } from '../grid/grid.ts';
import { createHotbarService } from '../hotbar/hotbar.ts';
import { createInventoryService } from '../inventory/inventory.ts';
import { ITEM_IDS } from '../items/items.ts';
import { MATERIAL_LINK_CAPACITY, MaterialLinkRuntime, type LinkScene } from '../industrial/link-runtime.ts';
import { coreForPart } from '../industrial/catalog.ts';
import { materialLinkBetween } from '../industrial/runtime-model.ts';
import type { PortSlotId } from '../industrial/ids.ts';
import { PortRuntime } from '../industrial/port-runtime.ts';
import { MECHANICAL_PART_DEFS, type MechanicalPart } from '../mechanical/parts.ts';
import { restoreProduction, snapshotProduction } from '../mechanical/production-save.ts';
import { MechanicalRegistry } from '../mechanical/registry.ts';
import { ProductionRuntime } from '../production/production-runtime.ts';

/**
 * 各系统的存档切片往返（纯逻辑，不启动引擎）：
 * snapshot -> JSON -> restore 后逻辑状态一致；非法数据逐条跳过。
 * 需要引擎实例的部分（建筑/楼层/机械/资源/玩家的 restore）由真实游戏脚本覆盖。
 */

const IRON = ITEM_IDS.IRON_ORE;
const SHAFT = ITEM_IDS.SHAFT;
const CRUSHER_ITEM = ITEM_IDS.CRUSHER;

describe('inventory 切片', () => {
  it('snapshot -> JSON -> restore 后总数与堆叠一致', () => {
    const source = createInventoryService();
    source.add(IRON, 5);
    source.add(SHAFT, 2);
    const json = JSON.stringify(source.snapshot());
    const target = createInventoryService();
    const report = target.restore(JSON.parse(json));
    expect(report.issues).toEqual([]);
    expect(report.restored).toBe(2);
    expect(target.count(IRON)).toBe(5);
    expect(target.count(SHAFT)).toBe(2);
    expect(target.stacks()).toEqual(source.stacks());
  });

  it('restore 先清空再重建（幂等），未知物品/非法数量逐条跳过', () => {
    const inventory = createInventoryService();
    inventory.add(IRON, 7);
    const report = inventory.restore({
      stacks: [
        { itemId: 'stone', count: 3 },
        { itemId: 'iron_ore', count: 2 },
        { itemId: 'shaft', count: -2 },
      ],
    });
    expect(inventory.count(IRON)).toBe(2);
    expect(inventory.count(SHAFT)).toBe(0);
    expect(report.issues.length).toBeGreaterThanOrEqual(2);
    inventory.restore({ stacks: [{ itemId: 'iron_ore', count: 2 }] });
    expect(inventory.count(IRON)).toBe(2);
  });
});

describe('hotbar 切片', () => {
  it('snapshot -> JSON -> restore 后槽位与选中一致', () => {
    const source = createHotbarService();
    source.bind(0, SHAFT);
    source.bind(6, CRUSHER_ITEM);
    source.select(6);
    const json = JSON.stringify(source.snapshot());
    const target = createHotbarService();
    const report = target.restore(JSON.parse(json));
    expect(report.issues).toEqual([]);
    expect(target.slots).toEqual(source.slots);
    expect(target.selected).toBe(6);
  });

  it('非法槽位/未知物品/重复绑定被丢弃，选中槽越界钳制', () => {
    const hotbar = createHotbarService();
    const report = hotbar.restore({
      slots: ['shaft', 'stone', 'shaft', 'crusher'],
      selected: 99,
    });
    expect(hotbar.slots[0]).toBe(SHAFT);
    expect(hotbar.slots[1]).toBeNull();
    expect(hotbar.slots[2]).toBeNull();
    expect(hotbar.slots[3]).toBe(CRUSHER_ITEM);
    expect(hotbar.selected).toBe(11);
    expect(report.issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe('interface box 运行时切片', () => {
  const CRUSHER = coreForPart('crusher')!;
  const IN = 'slot.crusher.in.nz' as PortSlotId;
  const OUT = 'slot.crusher.out.px' as PortSlotId;

  it('restore 安装接口盒并恢复盒内缓冲', () => {
    const runtime = new PortRuntime();
    expect(runtime.restore(1, CRUSHER, IN, 'port.through', { itemId: 'iron_ore', count: 2 })).toBeUndefined();
    expect(runtime.get(1, IN)?.module.id).toBe('port.through');
    expect(runtime.bufferOf(1, IN)).toEqual({ itemId: 'iron_ore', count: 2, capacity: 4 });
    expect(runtime.snapshot()).toHaveLength(1);
  });

  it('缓冲越界钳制到安装位容量，空计数清空物品', () => {
    const runtime = new PortRuntime();
    expect(runtime.restore(1, CRUSHER, IN, 'port.through', { itemId: 'iron_ore', count: 99 }))
      .toBe('buffer-count-clamped');
    expect(runtime.get(1, IN)?.count).toBe(4);
    expect(runtime.restore(2, CRUSHER, IN, 'port.through', { itemId: null, count: 3 }))
      .toBe('buffer-item-missing');
    expect(runtime.get(2, IN)?.count).toBe(0);
  });

  it('未知接口盒/重复安装位被拒绝', () => {
    const runtime = new PortRuntime();
    expect(runtime.restore(1, CRUSHER, IN, 'port.ghost' as never, { itemId: null, count: 0 }))
      .toBe('unknown-module');
    runtime.restore(1, CRUSHER, IN, 'port.through', { itemId: null, count: 0 });
    expect(runtime.restore(1, CRUSHER, IN, 'port.through', { itemId: null, count: 0 }))
      .toBe('slot-occupied');
  });
});

describe('material link 运行时切片', () => {
  const CRUSHER = coreForPart('crusher')!;
  const IN = 'slot.crusher.in.nz' as PortSlotId;
  const OUT = 'slot.crusher.out.px' as PortSlotId;
  const partA: MechanicalPart = { id: 1, def: MECHANICAL_PART_DEFS.crusher, placement: createPlacement(0, 0, 1, 1, 0, 0) };
  const partB: MechanicalPart = { id: 2, def: MECHANICAL_PART_DEFS.crusher, placement: createPlacement(1, 0, 1, 1, 0, 0) };

  function sceneWithPorts(): LinkScene {
    const runtime = new PortRuntime();
    runtime.install(1, CRUSHER, OUT, 'port.output');
    runtime.install(2, CRUSHER, IN, 'port.through');
    const byId = new Map<number, MechanicalPart>([[1, partA], [2, partB]]);
    return {
      partOf: (partId) => byId.get(partId),
      portOf: (partId, slotId) => runtime.get(partId, slotId),
    };
  }

  it('restore 只校验两端（几何状态由运行时重算），保留累计传递件数', () => {
    const scene = sceneWithPorts();
    const link = materialLinkBetween({ entityId: 1, slotId: OUT }, { entityId: 2, slotId: IN });
    const links = new MaterialLinkRuntime();
    const report = links.restore([{ id: link.id, from: link.from, to: link.to, moved: 5 }], scene);
    expect(report.issues).toEqual([]);
    expect(report.restored).toBe(1);
    expect(links.all()).toHaveLength(1);
    const snapshot = links.snapshot(scene);
    expect(snapshot[0]!.id).toBe(link.id);
    expect(snapshot[0]!.moved).toBe(5);
    expect(snapshot[0]!.capacity).toBe(MATERIAL_LINK_CAPACITY);
  });

  it('缺失零件/缺失接口盒/重复连接逐条跳过', () => {
    const scene = sceneWithPorts();
    const link = materialLinkBetween({ entityId: 1, slotId: OUT }, { entityId: 2, slotId: IN });
    const links = new MaterialLinkRuntime();
    const report = links.restore([
      { id: 'link:99:slot.crusher.out.px->2:slot.crusher.in.nz' as never, from: { entityId: 99, slotId: OUT }, to: { entityId: 2, slotId: IN } },
      { id: link.id, from: link.from, to: link.to },
      { id: link.id, from: link.from, to: link.to },
    ], scene);
    expect(report.restored).toBe(1);
    expect(report.issues.length).toBe(2);
    expect(links.all()).toHaveLength(1);
  });
});

describe('加工运行时切片', () => {
  const crusher: MechanicalPart = { id: 1, def: MECHANICAL_PART_DEFS.crusher, placement: createPlacement(-6, 7, 1, 1, 0, 0) };
  const chute: MechanicalPart = { id: 2, def: MECHANICAL_PART_DEFS.chute, placement: createPlacement(-5, 7, 1, 1, 0, 0) };
  const parts = [crusher, chute];

  function newRuntime(): ProductionRuntime {
    return new ProductionRuntime({ partAt: () => undefined, addItem: () => {} });
  }

  it('snapshot -> JSON -> restore 后机器缓冲/进度/溜槽在途物品一致', () => {
    const source = newRuntime();
    source.sync(parts);
    const state = source.machineState(1)!;
    expect(source.insertInto(1, 'iron_ore', 2)).toBe(2);
    state.progress = 0.4;
    state.producedTotal = 7;
    const chuteState = source.chuteState(2)!;
    chuteState.item = { itemId: 'iron_ore', t: 0.5, blocked: false };
    chuteState.delivered = 3;
    const raw = JSON.parse(JSON.stringify(snapshotProduction(source)));

    const target = newRuntime();
    const report = restoreProduction(target, parts, raw);
    expect(report.issues).toEqual([]);
    expect(report.restored).toBe(2);
    const restored = target.machineState(1)!;
    expect(restored.recipeId).toBe('crush-iron-ore');
    expect(restored.inputItem).toBe('iron_ore');
    expect(restored.inputCount).toBe(2);
    expect(restored.progress).toBeCloseTo(0.4, 6);
    expect(restored.producedTotal).toBe(7);
    const restoredChute = target.chuteState(2)!;
    expect(restoredChute.item).toEqual({ itemId: 'iron_ore', t: 0.5, blocked: false });
    expect(restoredChute.delivered).toBe(3);
  });

  it('不存在的机器/未知配方逐条跳过并修复，不抛异常', () => {
    const target = newRuntime();
    const report = restoreProduction(target, parts, {
      machines: [{
        partId: 999,
        recipeId: 'crush-iron-ore',
        progress: 0,
        inputItem: null,
        inputCount: 0,
        outputItem: null,
        outputCount: 0,
        producedTotal: 0,
      }, {
        partId: 1,
        recipeId: 'not-a-recipe',
        progress: 0,
        inputItem: null,
        inputCount: 0,
        outputItem: null,
        outputCount: 0,
        producedTotal: 0,
      }],
      chutes: [],
    });
    expect(report.issues.length).toBeGreaterThanOrEqual(2);
    expect(target.machineState(1)?.recipeId).toBe('crush-iron-ore');
  });
});

describe('mechanical registry 计数器存档', () => {
  it('nextPartId 可读可设，clear 后归 1，非法值抛错', () => {
    const registry = new MechanicalRegistry();
    expect(registry.nextPartId).toBe(1);
    expect(registry.allocateId()).toBe(1);
    expect(registry.nextPartId).toBe(2);
    registry.setNextPartId(42);
    expect(registry.nextPartId).toBe(42);
    expect(registry.allocateId()).toBe(42);
    expect(() => registry.setNextPartId(0)).toThrow(RangeError);
    expect(() => registry.setNextPartId(1.5)).toThrow(RangeError);
    registry.clear();
    expect(registry.nextPartId).toBe(1);
  });
});
