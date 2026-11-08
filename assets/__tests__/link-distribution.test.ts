import { describe, expect, it } from 'vitest';
import {
  CRUSHER,
  OUT,
  SMELTER,
  SMELTER_IN,
  machine,
  part,
  power,
  rigOf,
  run,
  totalItems,
  type Rig,
} from './link-test-rig.ts';

/**
 * P2-C 分流 / 合流专项测试：1→2 轮询分配、全部/部分目标满载、逐件到达的严格交替、
 * 2→1 合流不覆盖。装置见 `link-test-rig.ts`；核心间直接传输与多级产线见
 * `link-flow.test.ts`。
 */

describe('分流（一进二出）', () => {
  function splitterRig(): Rig {
    const rig = rigOf([
      part(1, 'crusher', 0, 0, 0),
      part(2, 'smelter', 1, 0, 90),
      part(3, 'smelter', 2, 0, 90),
    ]);
    rig.ports.install(1, CRUSHER, OUT, 'port.splitter');
    rig.ports.install(2, SMELTER, SMELTER_IN, 'port.through');
    rig.ports.install(3, SMELTER, SMELTER_IN, 'port.through');
    return rig;
  }

  it('一轮输入按轮询分配到两台下游，两边都收到、总数守恒', () => {
    const rig = splitterRig();
    expect(rig.links.create(rig.out, { entityId: 2, slotId: SMELTER_IN as never }, rig.scene()).ok).toBe(true);
    expect(rig.links.create(rig.out, { entityId: 3, slotId: SMELTER_IN as never }, rig.scene()).ok).toBe(true);
    for (const id of [1, 2, 3]) power(rig, id);
    rig.production.insertInto(1, 'iron_ore', 4);
    run(rig, 30);

    expect(machine(rig, 2)?.producedTotal).toBe(2);
    expect(machine(rig, 3)?.producedTotal).toBe(2);
    expect(totalItems(rig)).toBe(4);
    const moved = rig.links.snapshot(rig.scene()).map((entry) => entry.moved);
    expect(moved).toEqual([2, 2]);
  });

  it('一个目标满载时，物料全部分配给另一个目标，留在源缓冲的不丢', () => {
    const rig = splitterRig();
    rig.links.create(rig.out, { entityId: 2, slotId: SMELTER_IN as never }, rig.scene());
    rig.links.create(rig.out, { entityId: 3, slotId: SMELTER_IN as never }, rig.scene());
    power(rig, 1);
    // 3 号熔炼炉不给动力且输入缓冲先塞满：它的接口盒会满，连接被阻塞。
    rig.production.insertInto(3, 'crushed_ore', 4);
    rig.ports.accept(3, SMELTER_IN as never, 'crushed_ore');
    rig.ports.accept(3, SMELTER_IN as never, 'crushed_ore');
    rig.ports.accept(3, SMELTER_IN as never, 'crushed_ore');
    rig.ports.accept(3, SMELTER_IN as never, 'crushed_ore');
    power(rig, 2); // 只有 2 号下游可加工
    const before = totalItems(rig);
    rig.production.insertInto(1, 'iron_ore', 2);
    run(rig, 30);

    expect(machine(rig, 2)?.producedTotal).toBe(2);
    expect(rig.ports.get(3, SMELTER_IN as never)?.count).toBe(4);
    expect(totalItems(rig)).toBe(before + 2);
    const [toTwo, toThree] = rig.links.snapshot(rig.scene());
    expect(toTwo?.moved).toBe(2);
    expect(toThree?.moved).toBe(0);
  });

  it('逐件到达：分配游标只按成功件数前进，连续多件严格交替', () => {
    const rig = splitterRig();
    rig.links.create(rig.out, { entityId: 2, slotId: SMELTER_IN as never }, rig.scene());
    rig.links.create(rig.out, { entityId: 3, slotId: SMELTER_IN as never }, rig.scene());
    // 不经加工、不 drain：每放进源盒 1 件就推进一次物流，模拟"隔几帧才来一件"的真实节奏。
    for (let index = 0; index < 6; index += 1) {
      expect(rig.ports.accept(1, OUT as never, 'crushed_ore')).toBe(true);
      expect(rig.links.step(rig.scene(), rig.ports)).toBe(1);
    }
    expect(rig.links.snapshot(rig.scene()).map((entry) => entry.moved)).toEqual([3, 3]);
    expect(rig.ports.get(2, SMELTER_IN as never)?.count).toBe(3);
    expect(rig.ports.get(3, SMELTER_IN as never)?.count).toBe(3);
  });

  it('所有目标都满载时停止分配：物料留在源接口盒，不重复读取', () => {
    const rig = splitterRig();
    rig.links.create(rig.out, { entityId: 2, slotId: SMELTER_IN as never }, rig.scene());
    rig.links.create(rig.out, { entityId: 3, slotId: SMELTER_IN as never }, rig.scene());
    for (const id of [2, 3]) {
      rig.production.insertInto(id, 'crushed_ore', 4);
      for (let index = 0; index < 4; index += 1) rig.ports.accept(id, SMELTER_IN as never, 'crushed_ore');
    }
    rig.ports.accept(1, OUT as never, 'crushed_ore');
    rig.ports.accept(1, OUT as never, 'crushed_ore');
    const step = () => rig.links.step(rig.scene(), rig.ports);
    expect(step()).toBe(0);
    expect(step()).toBe(0);
    expect(rig.ports.get(1, OUT as never)?.count).toBe(2);
    expect(rig.links.snapshot(rig.scene()).map((entry) => entry.moved)).toEqual([0, 0]);
  });
});

describe('合流（二进一出）', () => {
  it('两台上游同时供料给一台下游：两路都到达、无覆盖、无丢失', () => {
    const rig = rigOf([
      part(1, 'crusher', 0, -1, 270),
      part(2, 'crusher', -1, -1, 0),
      part(3, 'smelter', 0, 0, 0),
    ]);
    rig.ports.install(1, CRUSHER, OUT, 'port.through');
    rig.ports.install(2, CRUSHER, OUT, 'port.through');
    rig.ports.install(3, SMELTER, SMELTER_IN, 'port.merger');
    const resultA = rig.links.create({ entityId: 1, slotId: OUT as never }, { entityId: 3, slotId: SMELTER_IN as never }, rig.scene());
    const resultB = rig.links.create({ entityId: 2, slotId: OUT as never }, { entityId: 3, slotId: SMELTER_IN as never }, rig.scene());
    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    for (const id of [1, 2, 3]) power(rig, id);
    rig.production.insertInto(1, 'iron_ore', 2);
    rig.production.insertInto(2, 'iron_ore', 2);
    run(rig, 30);

    expect(machine(rig, 3)?.producedTotal).toBe(4);
    expect(totalItems(rig)).toBe(4);
    const moved = rig.links.snapshot(rig.scene()).map((entry) => entry.moved);
    expect(moved).toEqual([2, 2]);
  });
});
