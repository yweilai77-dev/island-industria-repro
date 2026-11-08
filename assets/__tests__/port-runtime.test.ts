import { describe, expect, it } from 'vitest';
import { coreForPart } from '../industrial/catalog.ts';
import { PortRuntime } from '../industrial/port-runtime.ts';
import type { ItemId } from '../items/items.ts';

/**
 * P2-B 接口盒运行时：安装位占用、规格兼容、容量、原子转移、拆卸与清理。
 * 全部为纯逻辑测试，不启动引擎。
 */

const CRUSHER = coreForPart('crusher')!;
const FORGE = coreForPart('forge')!;
const CRUSHER_IN = 'slot.crusher.in.nz';
const CRUSHER_OUT = 'slot.crusher.out.px';

describe('安装与占用', () => {
  it('装到空闲输入位成功，并把它标记为占用', () => {
    const runtime = new PortRuntime();
    expect(runtime.freeInputSlotOf(CRUSHER, 1)?.id).toBe(CRUSHER_IN);
    expect(runtime.install(1, CRUSHER, CRUSHER_IN, 'port.through')).toEqual({ ok: true });
    expect(runtime.installedOf(1)).toHaveLength(1);
    expect(runtime.get(1, CRUSHER_IN)?.module.id).toBe('port.through');
    expect(runtime.freeInputSlotOf(CRUSHER, 1)).toBeUndefined();
  });

  it('同一安装位不能重复安装', () => {
    const runtime = new PortRuntime();
    runtime.install(1, CRUSHER, CRUSHER_IN, 'port.through');
    expect(runtime.install(1, CRUSHER, CRUSHER_IN, 'port.through'))
      .toEqual({ ok: false, reason: 'slot-occupied' });
    expect(runtime.installedOf(1)).toHaveLength(1);
  });

  it('未知安装位 / 未知接口盒被拒绝', () => {
    const runtime = new PortRuntime();
    expect(runtime.install(1, CRUSHER, 'slot.smelter.in.nz' as never, 'port.through').reason)
      .toBe('unknown-slot');
    expect(runtime.install(1, CRUSHER, CRUSHER_IN, 'port.ghost' as never).reason)
      .toBe('unknown-module');
  });

  it('规格不匹配被拒绝：分流盒不能装在输入位', () => {
    const runtime = new PortRuntime();
    expect(runtime.install(1, CRUSHER, CRUSHER_IN, 'port.splitter'))
      .toEqual({ ok: false, reason: 'module-not-installable' });
  });

  it('还没接入真实物品的接口盒不能安装（分流/合流盒属于 P2-C）', () => {
    const runtime = new PortRuntime();
    expect(runtime.install(1, CRUSHER, CRUSHER_OUT, 'port.splitter'))
      .toEqual({ ok: false, reason: 'module-not-a-real-item' });
    expect(runtime.install(1, CRUSHER, CRUSHER_IN, 'port.merger'))
      .toEqual({ ok: false, reason: 'module-not-a-real-item' });
  });

  it('不同机器上的安装位互不影响', () => {
    const runtime = new PortRuntime();
    runtime.install(1, CRUSHER, CRUSHER_IN, 'port.through');
    expect(runtime.freeInputSlotOf(FORGE, 2)?.id).toBe('slot.forge.in.nz');
    expect(runtime.install(2, FORGE, 'slot.forge.in.nz', 'port.through')).toEqual({ ok: true });
    expect(runtime.installedOf(1)).toHaveLength(1);
    expect(runtime.installedOf(2)).toHaveLength(1);
  });
});

describe('接口盒缓冲', () => {
  it('按安装位容量接收，满了就拒收（上游必须自己留着）', () => {
    const runtime = new PortRuntime();
    runtime.install(1, CRUSHER, CRUSHER_IN, 'port.through');
    const capacity = CRUSHER.portSlots.find((slot) => slot.id === CRUSHER_IN)!.capacity;
    expect(capacity).toBe(4);
    for (let index = 0; index < capacity; index += 1) {
      expect(runtime.accept(1, CRUSHER_IN, 'iron_ore')).toBe(true);
    }
    expect(runtime.get(1, CRUSHER_IN)?.count).toBe(capacity);
    expect(runtime.accept(1, CRUSHER_IN, 'iron_ore')).toBe(false);
    expect(runtime.get(1, CRUSHER_IN)?.count).toBe(capacity);
  });

  it('缓冲是单物料类型：不同类型不混装', () => {
    const runtime = new PortRuntime();
    runtime.install(1, CRUSHER, CRUSHER_IN, 'port.through');
    expect(runtime.accept(1, CRUSHER_IN, 'iron_ore')).toBe(true);
    expect(runtime.accept(1, CRUSHER_IN, 'crushed_ore')).toBe(false);
    expect(runtime.get(1, CRUSHER_IN)?.itemId).toBe('iron_ore');
  });

  it('没装盒的安装位拒收', () => {
    const runtime = new PortRuntime();
    expect(runtime.accept(1, CRUSHER_IN, 'iron_ore')).toBe(false);
  });

  it('推进机器是原子的：下游拒收时盒里一件不少', () => {
    const runtime = new PortRuntime();
    runtime.install(1, CRUSHER, CRUSHER_IN, 'port.through');
    runtime.accept(1, CRUSHER_IN, 'iron_ore');
    runtime.accept(1, CRUSHER_IN, 'iron_ore');
    expect(runtime.drain(1, () => false)).toBe(0);
    expect(runtime.get(1, CRUSHER_IN)?.count).toBe(2);
    expect(runtime.get(1, CRUSHER_IN)?.itemId).toBe('iron_ore');
  });

  it('推进机器成功时逐件扣减，直到机器拒收或盒空', () => {
    const runtime = new PortRuntime();
    runtime.install(1, CRUSHER, CRUSHER_IN, 'port.through');
    for (let index = 0; index < 3; index += 1) runtime.accept(1, CRUSHER_IN, 'iron_ore');
    let room = 2;
    const moved = runtime.drain(1, (itemId: ItemId) => {
      if (room <= 0 || itemId !== 'iron_ore') return false;
      room -= 1;
      return true;
    });
    expect(moved).toBe(2);
    expect(runtime.get(1, CRUSHER_IN)?.count).toBe(1);
  });

  it('输出位的盒子不参与自动输入（只认输入位）', () => {
    const runtime = new PortRuntime();
    runtime.install(1, CRUSHER, CRUSHER_OUT, 'port.through');
    expect(runtime.inputBoxesOf(1)).toHaveLength(0);
    expect(runtime.drain(1, () => true)).toBe(0);
  });
});

describe('拆卸与清理', () => {
  it('拆卸返还接口盒物品并把盒内物料一起交回', () => {
    const runtime = new PortRuntime();
    runtime.install(1, CRUSHER, CRUSHER_IN, 'port.through');
    runtime.accept(1, CRUSHER_IN, 'iron_ore');
    runtime.accept(1, CRUSHER_IN, 'iron_ore');
    const removal = runtime.remove(1, CRUSHER_IN);
    expect(removal).toEqual({ moduleItemId: 'interface_box', bufferItemId: 'iron_ore', bufferCount: 2 });
    expect(runtime.installedOf(1)).toHaveLength(0);
    expect(runtime.remove(1, CRUSHER_IN)).toBeUndefined();
  });

  it('拆卸空盒时缓冲为空但不报错', () => {
    const runtime = new PortRuntime();
    runtime.install(1, CRUSHER, CRUSHER_IN, 'port.through');
    expect(runtime.remove(1, CRUSHER_IN)).toEqual({
      moduleItemId: 'interface_box',
      bufferItemId: null,
      bufferCount: 0,
    });
  });

  it('flush 把盒子与缓冲全部交回，用于拆机', () => {
    const runtime = new PortRuntime();
    runtime.install(1, CRUSHER, CRUSHER_IN, 'port.through');
    runtime.accept(1, CRUSHER_IN, 'iron_ore');
    expect(runtime.flush(1)).toEqual([
      { itemId: 'interface_box', count: 1 },
      { itemId: 'iron_ore', count: 1 },
    ]);
    expect(runtime.installedOf(1)).toHaveLength(0);
  });

  it('sync 只清理已消失的机器，活着的机器保持安装状态', () => {
    const runtime = new PortRuntime();
    runtime.install(1, CRUSHER, CRUSHER_IN, 'port.through');
    runtime.install(2, FORGE, 'slot.forge.in.nz', 'port.through');
    runtime.accept(2, 'slot.forge.in.nz', 'iron_ingot');
    const removed = runtime.sync(new Set([1]));
    expect(removed).toHaveLength(1);
    expect(removed[0]?.partId).toBe(2);
    expect(removed[0]?.items).toEqual([
      { itemId: 'interface_box', count: 1 },
      { itemId: 'iron_ingot', count: 1 },
    ]);
    expect(runtime.installedOf(1)).toHaveLength(1);
    expect(runtime.installedOf(2)).toHaveLength(0);
  });
});

describe('读投影', () => {
  it('snapshot 是纯 JSON 且包含安装位、接口盒、缓冲与容量', () => {
    const runtime = new PortRuntime();
    runtime.install(1, CRUSHER, CRUSHER_IN, 'port.through');
    runtime.accept(1, CRUSHER_IN, 'iron_ore');
    expect(runtime.snapshot()).toEqual([{
      partId: 1,
      slotId: CRUSHER_IN,
      moduleId: 'port.through',
      itemId: 'iron_ore',
      count: 1,
      capacity: 4,
    }]);
    expect(JSON.parse(JSON.stringify(runtime.snapshot()))).toEqual(runtime.snapshot() as never);
  });
});
