import { describe, expect, it } from 'vitest';
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
 * P2-C 物料传输集成测试：真实 `ProductionRuntime` + 真实 `PortRuntime` +
 * 真实 `MaterialLinkRuntime` + 共用网关（与游戏跑的是同一份实现）。
 *
 * 覆盖任务书 §7.1：基础连接、物料守恒、背压、分流/合流、断链/重连、拆盒/拆机、
 * 旋转、多帧连续运行、任何情况下不重复不丢失。
 */

const CRUSHER = coreForPart('crusher')!;
const SMELTER = coreForPart('smelter')!;
const OUT = 'slot.crusher.out.px';
const CRUSHER_IN = 'slot.crusher.in.nz';
const SMELTER_IN = 'slot.smelter.in.nz';

function part(id: number, defId: PartId, gx: number, gz: number, rotation: Rotation = 0): MechanicalPart {
  const def = MECHANICAL_PART_DEFS[defId];
  return { id, def, placement: createPlacement(gx, gz, def.w, def.d, rotation, 0) };
}

interface Rig {
  parts: MechanicalPart[];
  readonly production: ProductionRuntime;
  readonly ports: PortRuntime;
  readonly links: MaterialLinkRuntime;
  readonly inventory: InventoryService;
  readonly out: PortEndpoint;
  readonly smelterIn: PortEndpoint;
  scene(): LinkScene;
}

function rigOf(parts: MechanicalPart[]): Rig {
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
function dockedRig(): Rig {
  const rig = rigOf([part(1, 'crusher', 0, 0, 0), part(2, 'smelter', 1, 0, 90)]);
  rig.ports.install(1, CRUSHER, OUT, 'port.output');
  rig.ports.install(2, SMELTER, SMELTER_IN, 'port.through');
  return rig;
}

function run(rig: Rig, seconds: number, delta = 0.1): void {
  const steps = Math.round(seconds / delta);
  for (let index = 0; index < steps; index += 1) rig.production.tick(delta);
}

function power(rig: Rig, partId: number, rate = 4): void {
  rig.production.setPowerReading(partId, { powered: true, rate });
}

function machine(rig: Rig, partId: number) {
  return rig.production.snapshot().machines.find((entry) => entry.partId === partId);
}

/**
 * 全系统物料总数（库存 + 机器缓冲 + 溜槽在途 + 接口盒缓冲 + **正在加工的已消耗原料**）。
 * 加工状态机在周期开始时整笔消耗原料，所以物料守恒必须把「在制」的原料算回来，
 * 否则刚开工的那一帧会误报丢料（这是状态机的既有语义，不是 P2-C 引入的问题）。
 */
function totalItems(rig: Rig): number {
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

function producedOf(rig: Rig, itemId: string): number {
  return rig.production.snapshot().produced.find((entry) => entry.itemId === itemId)?.count ?? 0;
}

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
