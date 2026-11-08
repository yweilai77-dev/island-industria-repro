import { describe, expect, it } from 'vitest';
import { coreForPart } from '../industrial/catalog.ts';
import {
  CRUSHER,
  CRUSHER_IN,
  OUT,
  SMELTER,
  SMELTER_IN,
  dockedRig,
  machine,
  part,
  power,
  producedOf,
  rigOf,
  run,
  totalItems,
} from './link-test-rig.ts';

/**
 * P2-C 物料传输集成测试：核心间直接传输、断链/重连、旋转/拆机、多级产线、旧输入路径。
 * 装置（真实 ProductionRuntime + PortRuntime + MaterialLinkRuntime + 共用网关）见
 * `link-test-rig.ts`；分流/合流的分配与阻塞见 `link-distribution.test.ts`。
 */

describe('核心间直接传输（输出接口 → 连接 → 输入接口）', () => {
  it('单个物品走完整链路：破碎产物自动进入熔炼炉并炼成铁锭', () => {
    const rig = dockedRig();
    expect(rig.links.create(rig.out, rig.smelterIn, rig.scene()).ok).toBe(true);
    power(rig, 1);
    power(rig, 2);
    expect(rig.production.insertInto(1, 'iron_ore', 1)).toBe(1);

    run(rig, 8);

    expect(machine(rig, 2)?.producedTotal).toBe(1);
    expect(producedOf(rig, 'iron_ingot')).toBe(1);
    expect(producedOf(rig, 'crushed_ore')).toBe(1);
    // 只经过一条连接，连接的累计传递数 = 1（无复制、无重复提交）。
    expect(rig.links.snapshot(rig.scene())[0]?.moved).toBe(1);
    expect(totalItems(rig)).toBe(1);
  });

  it('多个物品连续传输，全程守恒', () => {
    const rig = dockedRig();
    rig.links.create(rig.out, rig.smelterIn, rig.scene());
    power(rig, 1);
    power(rig, 2);
    expect(rig.production.insertInto(1, 'iron_ore', 3)).toBe(3);
    run(rig, 20);
    expect(machine(rig, 2)?.producedTotal).toBe(3);
    expect(totalItems(rig)).toBe(3);
  });

  it('输出缓冲为空时不传输，也不产生任何物料', () => {
    const rig = dockedRig();
    rig.links.create(rig.out, rig.smelterIn, rig.scene());
    run(rig, 3);
    expect(rig.links.snapshot(rig.scene())[0]?.moved).toBe(0);
    expect(totalItems(rig)).toBe(0);
  });

  it('下游输入缓冲/接口盒满载时停止传输，上游物料保留不丢', () => {
    const rig = dockedRig();
    rig.links.create(rig.out, rig.smelterIn, rig.scene());
    power(rig, 1); // 熔炼炉不给动力：输入缓冲会一直占满
    // 破碎机输入缓冲只有 4：分两批喂，才能把下游输入缓冲和接口盒都填满。
    expect(rig.production.insertInto(1, 'iron_ore', 4)).toBe(4);
    run(rig, 8);
    expect(rig.production.insertInto(1, 'iron_ore', 4)).toBe(4);
    run(rig, 12);

    const smelter = machine(rig, 2);
    expect(smelter?.inputCount).toBe(4);
    const box = rig.ports.get(2, SMELTER_IN);
    expect(box?.count).toBe(4);
    // 所有物料都还在系统中（机器缓冲 / 接口盒缓冲），一件不少也不多。
    expect(totalItems(rig)).toBe(8);
    // 再跑一段时间也不变，既不会消失也不会复制。
    run(rig, 6);
    expect(totalItems(rig)).toBe(8);
    expect(machine(rig, 2)?.inputCount).toBe(4);
  });

  it('连接每次推进最多传 1 件；目标满后不传也不丢', () => {
    const rig = dockedRig();
    rig.links.create(rig.out, rig.smelterIn, rig.scene());
    for (let index = 0; index < 4; index += 1) {
      expect(rig.ports.accept(1, OUT as never, 'crushed_ore')).toBe(true);
    }
    const step = () => rig.links.step(rig.scene(), rig.ports);
    expect(step()).toBe(1);
    expect(rig.ports.get(1, OUT as never)?.count).toBe(3);
    expect(rig.ports.get(2, SMELTER_IN)?.count).toBe(1);
    expect(step()).toBe(1);
    expect(step()).toBe(1);
    expect(rig.ports.get(2, SMELTER_IN)?.count).toBe(3);
    // 目标接口盒容量 4：再传 1 件后满，第 5 件无处可去，留在源缓冲。
    expect(step()).toBe(1);
    expect(step()).toBe(0);
    expect(rig.ports.get(2, SMELTER_IN)?.count).toBe(4);
    expect(rig.ports.get(1, OUT as never)?.count).toBe(0);
  });
});

describe('断链、重连与例外状态', () => {
  it('断开连接后物料停在接口盒里，重新连接后继续输送', () => {
    const rig = dockedRig();
    const link = rig.links.create(rig.out, rig.smelterIn, rig.scene());
    expect(link.ok).toBe(true);
    power(rig, 1);
    expect(rig.production.insertInto(1, 'iron_ore', 2)).toBe(2);
    run(rig, 1.2); // 破碎机出一件，连接把它送进熔炼炉输入缓冲
    expect(rig.links.snapshot(rig.scene())[0]?.moved).toBe(1);
    expect(totalItems(rig)).toBe(2);

    rig.links.removeAt(1, OUT as never);
    expect(rig.links.all()).toHaveLength(0);
    run(rig, 5);
    // 没有连接：上游产物停在输出接口盒（不吞不丢）。
    expect(rig.ports.get(1, OUT as never)?.count).toBe(1);
    expect(totalItems(rig)).toBe(2);

    rig.links.create(rig.out, rig.smelterIn, rig.scene());
    power(rig, 2);
    run(rig, 20);
    expect(machine(rig, 2)?.producedTotal).toBe(2);
    expect(totalItems(rig)).toBe(2);
  });

  it('拆掉输入接口盒：自动传输停止，盒内物料由拆卸方交回（不销毁）', () => {
    const rig = dockedRig();
    rig.links.create(rig.out, rig.smelterIn, rig.scene());
    rig.ports.accept(2, SMELTER_IN as never, 'crushed_ore');
    const removal = rig.ports.remove(2, SMELTER_IN as never);
    expect(removal).toEqual({ moduleItemId: 'interface_box', bufferItemId: 'crushed_ore', bufferCount: 1 });
    rig.links.removeAt(2, SMELTER_IN as never);
    expect(rig.links.snapshot(rig.scene())).toHaveLength(0);
  });

  it('旋转核心使连接失效：传输停止；转回后恢复且物料守恒', () => {
    const rig = dockedRig();
    rig.links.create(rig.out, rig.smelterIn, rig.scene());
    power(rig, 1);
    rig.production.insertInto(1, 'iron_ore', 2);
    run(rig, 1.2);

    const before = totalItems(rig);
    rig.parts[1] = part(2, 'smelter', 1, 0, 0); // 转回 0°，断开对接
    rig.production.sync(rig.parts);
    run(rig, 4);
    expect(rig.links.snapshot(rig.scene())[0]).toMatchObject({ active: false, status: 'inactive-geometry' });
    expect(totalItems(rig)).toBe(before);

    rig.parts[1] = part(2, 'smelter', 1, 0, 90);
    rig.production.sync(rig.parts);
    power(rig, 2);
    run(rig, 20);
    expect(rig.links.snapshot(rig.scene())[0]).toMatchObject({ active: true, status: 'ok' });
    expect(machine(rig, 2)?.producedTotal).toBeGreaterThanOrEqual(1);
    expect(totalItems(rig)).toBe(before);
  });

  it('拆除下游核心：机器缓冲与接口盒物料交回库存，连接清除，零丢失', () => {
    const rig = dockedRig();
    rig.links.create(rig.out, rig.smelterIn, rig.scene());
    power(rig, 1);
    rig.production.insertInto(1, 'iron_ore', 2);
    run(rig, 1.2);
    const before = totalItems(rig);

    rig.parts = [rig.parts[0]!];
    rig.production.sync(rig.parts);
    for (const removed of rig.ports.sync(new Set([1]))) {
      for (const item of removed.items) rig.inventory.add(item.itemId, item.count);
    }
    rig.links.sync(new Set([1]));
    expect(rig.links.all()).toHaveLength(0);
    // 拆掉的核心把接口盒（1 件）一起退回库存，所以总数 +1；物料本身一件不少。
    expect(totalItems(rig)).toBe(before + 1);
  });
});

describe('多级生产线', () => {
  it('三台核心串联：A → B → C 自动完成两级加工', () => {
    const rig = rigOf([
      part(1, 'crusher', 0, 0, 0),
      part(2, 'smelter', 1, 0, 90),
      part(3, 'forge', 1, -1, 180),
    ]);
    rig.ports.install(1, CRUSHER, OUT, 'port.output');
    rig.ports.install(2, SMELTER, SMELTER_IN, 'port.through');
    rig.ports.install(2, SMELTER, 'slot.smelter.out.px', 'port.output');
    rig.ports.install(3, coreForPart('forge')!, 'slot.forge.in.nz', 'port.through');
    // 熔炼炉(1,0) 90°：输出 px → -Z；锻压机(1,-1) 180°：输入 nz → +Z，锚点重合对接。
    expect(rig.links.create(
      { entityId: 1, slotId: OUT as never },
      { entityId: 2, slotId: SMELTER_IN as never },
      rig.scene(),
    ).ok).toBe(true);
    expect(rig.links.create(
      { entityId: 2, slotId: 'slot.smelter.out.px' as never },
      { entityId: 3, slotId: 'slot.forge.in.nz' as never },
      rig.scene(),
    ).ok).toBe(true);
    for (const id of [1, 2, 3]) power(rig, id);
    rig.production.insertInto(1, 'iron_ore', 2);
    run(rig, 40);

    // 锻压机默认配方是传动轴（2 铁锭 → 1 轴）：2 个铁锭正好出一根轴。
    expect(producedOf(rig, 'shaft')).toBe(1);
    expect(rig.links.snapshot(rig.scene()).every((entry) => entry.active)).toBe(true);
    // 两条连接分别传递 2 件碎铁矿、2 件铁锭；最终只剩一根轴（原料 2 → 成品 1，不是丢料）。
    expect(rig.links.snapshot(rig.scene()).map((entry) => entry.moved)).toEqual([2, 2]);
    expect(totalItems(rig)).toBe(1);
    expect(producedOf(rig, 'iron_ingot')).toBe(2);
    expect(producedOf(rig, 'crushed_ore')).toBe(2);
  });

  it('分流与合流同时运行：一台破碎机分流到两台熔炼炉，两路铁锭再合流进锻压机', () => {
    const FORGE = coreForPart('forge')!;
    const rig = rigOf([
      part(1, 'crusher', 0, 0, 0),
      part(2, 'smelter', 1, 0, 90),
      part(3, 'smelter', 2, 0, 90),
      part(4, 'forge', 1, -2, 180),
    ]);
    rig.ports.install(1, CRUSHER, OUT, 'port.splitter');
    rig.ports.install(2, SMELTER, SMELTER_IN, 'port.through');
    rig.ports.install(2, SMELTER, 'slot.smelter.out.px', 'port.through');
    rig.ports.install(3, SMELTER, SMELTER_IN, 'port.through');
    rig.ports.install(3, SMELTER, 'slot.smelter.out.px', 'port.through');
    rig.ports.install(4, FORGE, 'slot.forge.in.nz', 'port.merger');
    const result = [
      rig.links.create({ entityId: 1, slotId: OUT as never }, { entityId: 2, slotId: SMELTER_IN as never }, rig.scene()),
      rig.links.create({ entityId: 1, slotId: OUT as never }, { entityId: 3, slotId: SMELTER_IN as never }, rig.scene()),
      rig.links.create({ entityId: 2, slotId: 'slot.smelter.out.px' as never }, { entityId: 4, slotId: 'slot.forge.in.nz' as never }, rig.scene()),
      rig.links.create({ entityId: 3, slotId: 'slot.smelter.out.px' as never }, { entityId: 4, slotId: 'slot.forge.in.nz' as never }, rig.scene()),
    ];
    for (const entry of result) expect(entry.ok).toBe(true);
    for (const id of [1, 2, 3, 4]) power(rig, id);
    rig.production.insertInto(1, 'iron_ore', 4);
    run(rig, 60);

    // 4 矿 → 4 碎矿（分流 2/2）→ 4 铁锭（合流 2+2）→ 2 传动轴（锻压 2 铁锭/根）。
    expect(producedOf(rig, 'crushed_ore')).toBe(4);
    expect(producedOf(rig, 'iron_ingot')).toBe(4);
    expect(producedOf(rig, 'shaft')).toBe(2);
    expect(rig.links.snapshot(rig.scene()).map((entry) => entry.moved)).toEqual([2, 2, 2, 2]);
    expect(rig.links.snapshot(rig.scene()).every((entry) => entry.active)).toBe(true);
    expect(totalItems(rig)).toBe(2);
  });
});

describe('旧输入路径不受影响', () => {
  it('没有物料连接时，手动投料与接口盒输入照常工作', () => {
    const rig = rigOf([part(1, 'smelter', 0, 0, 0)]);
    rig.ports.install(1, SMELTER, SMELTER_IN, 'port.through');
    power(rig, 1);
    expect(rig.production.insertInto(1, 'crushed_ore', 2)).toBe(2);
    run(rig, 10);
    expect(machine(rig, 1)?.producedTotal).toBe(2);
    expect(rig.production.insertInto(1, 'crushed_ore', 1)).toBe(1);
    expect(rig.ports.get(1, CRUSHER_IN as never)).toBeUndefined();
  });
});
