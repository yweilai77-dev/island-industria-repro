import { describe, expect, it } from 'vitest';
import { coreForPart } from '../industrial/catalog.ts';
import { AssemblyRuntime } from '../industrial/assembly-runtime.ts';
import { buildConnections } from '../mechanical/ports.ts';
import { buildPowerTopology } from '../mechanical/power.ts';
import {
  CRUSHER,
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
  type Rig,
} from './link-test-rig.ts';

/**
 * P2-D 与既有系统的共存测试：
 * - 组合关系不接管加工状态机：加工进度、输入/输出缓冲、多核并行都不受影响；
 * - 结构模块没有端口，不改变机械动力连接与动力网络求解；
 * - P2-C 的 MaterialLink 在组合前后、拆解后都保持独立并可继续工作；
 * - 组合需求只是成员额定动力需求的求和，不产生任何虚构产能。
 */

/** 两台核心互相面对、可直连物料；两个结构框架把它们组织成一个组合。 */
function assembledRig(): { rig: Rig; runtime: AssemblyRuntime } {
  const rig = dockedRig();
  expect(rig.links.create(rig.out, rig.smelterIn, rig.scene()).ok).toBe(true);
  const frameA = part(10, 'structure_frame', 0, 1, 0); // 紧贴破碎机（0,0）的 +Z 侧
  const frameB = part(11, 'structure_frame', 1, 1, 0); // 紧贴熔炼炉（1,0）的 +Z 侧，且与 frameA 相邻
  rig.parts = [...rig.parts, frameA, frameB];
  rig.production.sync(rig.parts);
  const runtime = new AssemblyRuntime();
  runtime.reconcile(rig.parts);
  return { rig, runtime };
}

describe('组合与加工/库存共存', () => {
  it('组合前后加工状态、缓冲与进度保持不变，多核继续各自加工', () => {
    const { rig, runtime } = assembledRig();
    const [assembly] = runtime.snapshot();
    expect(assembly?.memberIds).toEqual([1, 2]);

    power(rig, 1);
    power(rig, 2);
    expect(rig.production.insertInto(1, 'iron_ore', 2)).toBe(2);
    run(rig, 2.2);
    const before = {
      crusher: machine(rig, 1),
      smelter: machine(rig, 2),
      moved: rig.links.snapshot(rig.scene())[0]?.moved,
    };
    expect(before.crusher?.producedTotal).toBeGreaterThanOrEqual(1);
    expect(before.moved).toBeGreaterThanOrEqual(1);

    // 组合关系每帧重新推导（相当于持续存在），加工不应被重置。
    runtime.reconcile(rig.parts);
    run(rig, 0.5);
    const crusherAfter = machine(rig, 1);
    expect(crusherAfter?.producedTotal).toBeGreaterThanOrEqual(before.crusher?.producedTotal ?? 0);
    expect(crusherAfter?.progress ?? 0).toBeGreaterThanOrEqual(before.crusher?.progress ?? 0);

    run(rig, 20);
    expect(machine(rig, 1)?.producedTotal).toBeGreaterThanOrEqual(2);
    expect(machine(rig, 2)?.producedTotal).toBeGreaterThanOrEqual(1);
    expect(totalItems(rig)).toBe(2);
  });

  it('组合不产生虚构产能：整体需求只是成员额定扭矩之和，快照没有速度/产能字段', () => {
    const { runtime } = assembledRig();
    const [assembly] = runtime.snapshot()!;
    const expected = (coreForPart('crusher')?.ratedLoadTorque ?? 0) + (coreForPart('smelter')?.ratedLoadTorque ?? 0);
    expect(assembly?.powerDemandTorque).toBe(expected);
    expect(assembly?.members.map((member) => member.ratedLoadTorque)).toEqual([
      coreForPart('crusher')?.ratedLoadTorque,
      coreForPart('smelter')?.ratedLoadTorque,
    ]);
    const keys = Object.keys(assembly ?? {});
    for (const forbidden of ['speed', 'throughput', 'capacity', 'rate', 'rpm']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('组合与机械动力共存', () => {
  it('结构模块无端口：组合前后动力连接与动力求解结果完全一致', () => {
    const rig = dockedRig();
    // 给两台核心接上轴与动力源（真实端口），再对比加入结构框架前后的求解。
    const shaftA = part(20, 'shaft', -1, 0, 0);
    const sourceA = part(21, 'power_source', -2, 0, 0);
    const shaftB = part(22, 'shaft', 2, 0, 0);
    const sourceB = part(23, 'power_source', 3, 0, 0);
    rig.parts = [...rig.parts, shaftA, sourceA, shaftB, sourceB];
    rig.production.sync(rig.parts);
    const connectionsBefore = buildConnections(rig.parts);
    const topologyBefore = buildPowerTopology(rig.parts, connectionsBefore, 0);
    expect(connectionsBefore.length).toBeGreaterThan(0);

    const frames = [part(30, 'structure_frame', 0, 1, 0), part(31, 'structure_frame', 1, 1, 0)];
    rig.parts = [...rig.parts, ...frames];
    rig.production.sync(rig.parts);
    const connectionsAfter = buildConnections(rig.parts);
    const topologyAfter = buildPowerTopology(rig.parts, connectionsAfter, 0);

    expect(connectionsAfter).toEqual(connectionsBefore);
    expect(topologyAfter.components).toEqual(topologyBefore.components);
    expect(topologyAfter.components.flatMap((component) => component.partIds)).not.toContain(30);
    expect(topologyAfter.components.flatMap((component) => component.partIds)).not.toContain(31);

    const assembly = new AssemblyRuntime();
    assembly.reconcile(rig.parts);
    expect(assembly.snapshot()[0]?.powerDemandTorque).toBeGreaterThan(0);
  });
});

describe('组合与物料连接共存', () => {
  it('组合前后 MaterialLink 继续保持；拆掉结构模块只解除组合，不动物流连接', () => {
    const { rig, runtime } = assembledRig();
    power(rig, 1);
    power(rig, 2);
    expect(rig.production.insertInto(1, 'iron_ore', 2)).toBe(2);
    run(rig, 10);
    const linkBefore = rig.links.snapshot(rig.scene())[0];
    expect(linkBefore?.moved).toBe(2);
    expect(linkBefore?.active).toBe(true);
    expect(runtime.snapshot()).toHaveLength(1);

    // 拆除结构模块：只移除零件，不清链接、不清端口、不清加工缓冲。
    rig.parts = rig.parts.filter((entry) => entry.def.kind !== 'structure');
    rig.production.sync(rig.parts);
    runtime.reconcile(rig.parts);
    expect(runtime.snapshot()).toHaveLength(0);
    expect(rig.links.snapshot(rig.scene())).toHaveLength(1);
    expect(rig.links.snapshot(rig.scene())[0]?.active).toBe(true);
    expect(rig.ports.get(2, SMELTER_IN)?.count).toBeDefined();

    // 物流继续工作：再喂一批矿石，连接累计传递增加，铁锭继续产出。
    const producedBefore = producedOf(rig, 'iron_ingot');
    expect(rig.production.insertInto(1, 'iron_ore', 2)).toBe(2);
    run(rig, 12);
    expect(rig.links.snapshot(rig.scene())[0]?.moved).toBeGreaterThan(linkBefore?.moved ?? 0);
    expect(producedOf(rig, 'iron_ingot')).toBeGreaterThan(producedBefore);
  });

  it('组合不会自动创建物料连接：两台核心相邻但不建链时没有传输', () => {
    const rig = dockedRig();
    rig.ports.install(2, SMELTER, SMELTER_IN, 'port.through');
    const frames = [part(40, 'structure_frame', 0, 1, 0), part(41, 'structure_frame', 1, 1, 0)];
    rig.parts = [...rig.parts, ...frames];
    rig.production.sync(rig.parts);
    const runtime = new AssemblyRuntime();
    runtime.reconcile(rig.parts);
    expect(runtime.snapshot()).toHaveLength(1);
    expect(rig.links.snapshot(rig.scene())).toHaveLength(0);
    power(rig, 1);
    power(rig, 2);
    rig.production.insertInto(1, 'iron_ore', 1);
    run(rig, 8);
    expect(producedOf(rig, 'iron_ingot')).toBe(0);
    expect(machine(rig, 2)?.producedTotal ?? 0).toBe(0);
  });

  it('拆除结构模块不误删无关连接：多组连接同时存在时只解除组合', () => {
    const rig = rigOf([
      part(1, 'crusher', 0, 0, 0),
      part(2, 'smelter', 1, 0, 90),
      part(3, 'smelter', 2, 0, 90),
    ]);
    rig.ports.install(1, CRUSHER, OUT, 'port.splitter');
    rig.ports.install(2, SMELTER, SMELTER_IN, 'port.through');
    rig.ports.install(3, SMELTER, SMELTER_IN, 'port.through');
    expect(rig.links.create(rig.out, { entityId: 2, slotId: SMELTER_IN as never }, rig.scene()).ok).toBe(true);
    expect(rig.links.create(rig.out, { entityId: 3, slotId: SMELTER_IN as never }, rig.scene()).ok).toBe(true);
    // 只有前两台核心被结构框架组织成一个组合；第三台独立。
    const frames = [part(10, 'structure_frame', 0, 1, 0), part(11, 'structure_frame', 1, 1, 0)];
    rig.parts = [...rig.parts, ...frames];
    rig.production.sync(rig.parts);
    const runtime = new AssemblyRuntime();
    runtime.reconcile(rig.parts);
    const [assembly] = runtime.snapshot();
    expect(assembly?.memberIds).toEqual([1, 2]);
    expect(assembly?.moduleIds).toEqual([10, 11]);

    const linksBefore = rig.links.snapshot(rig.scene());
    expect(linksBefore).toHaveLength(2);

    rig.parts = rig.parts.filter((entry) => entry.def.kind !== 'structure');
    rig.production.sync(rig.parts);
    runtime.reconcile(rig.parts);
    expect(runtime.snapshot()).toHaveLength(0);
    expect(rig.links.snapshot(rig.scene())).toHaveLength(2);
    expect(rig.links.snapshot(rig.scene()).every((link) => link.active)).toBe(true);
  });
});
