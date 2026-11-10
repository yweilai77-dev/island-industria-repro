import { describe, expect, it } from 'vitest';
import { AssemblyRuntime } from '../industrial/assembly-runtime.ts';
import { EndgameProof, candidateAssemblyOf, conditionsOf, producedDeltaOf, baselineOf } from '../endgame/endgame.ts';
import type { EndgameWorldView } from '../endgame/endgame.ts';
import { CRUSHER, OUT, SMELTER, SMELTER_IN, part, power, rigOf, run, type Rig } from './link-test-rig.ts';

/**
 * P2-E3 运行证明的**真实运行时**集成测试：
 * 组合机械用真实 AssemblyRuntime 推导，物料连接 / 接口盒 / 加工产出全部来自
 * 真实 MaterialLinkRuntime / PortRuntime / ProductionRuntime（与游戏跑的是同一份实现）。
 *
 * 只把「服务快照 → 运行证明只读视图」的映射写在测试里（与 endgame.pack.ts 的映射同形），
 * 用来证明五条条件确实能从真实世界状态求出来，而不是手写布尔值。
 */

const SMELTER_OUT = 'slot.smelter.out.px';

/** 三台核心 + 三个结构框架 → 一个成员 =3 的组合机械；一台破碎机分流给两台熔炼炉。 */
function assembledLine(): { rig: Rig; assembly: AssemblyRuntime } {
  const rig = rigOf([
    part(1, 'crusher', 0, 0, 0),
    part(2, 'smelter', 1, 0, 90),
    part(3, 'smelter', 2, 0, 90),
    part(10, 'structure_frame', 0, 1, 0),
    part(11, 'structure_frame', 1, 1, 0),
    part(12, 'structure_frame', 2, 1, 0),
  ]);
  rig.ports.install(1, CRUSHER, OUT, 'port.splitter');
  rig.ports.install(2, SMELTER, SMELTER_IN, 'port.through');
  rig.ports.install(3, SMELTER, SMELTER_IN, 'port.through');
  // 让 ≥2 台成员核心装了「输出接口盒」：破碎机用分流盒（输出位），两台熔炼炉用输出接口盒。
  rig.ports.install(2, SMELTER, SMELTER_OUT, 'port.output');
  rig.ports.install(3, SMELTER, SMELTER_OUT, 'port.output');
  expect(rig.links.create(rig.out, { entityId: 2, slotId: SMELTER_IN }, rig.scene()).ok).toBe(true);
  expect(rig.links.create(rig.out, { entityId: 3, slotId: SMELTER_IN }, rig.scene()).ok).toBe(true);
  const assembly = new AssemblyRuntime();
  assembly.reconcile(rig.parts);
  return { rig, assembly };
}

/** 与 endgame.pack.ts 同形的只读映射：只用真实服务快照。 */
function worldOf(rig: Rig, assembly: AssemblyRuntime): EndgameWorldView {
  const assemblies = assembly.snapshot().map((entry) => ({ id: entry.id, memberIds: [...entry.memberIds] }));
  const machines = rig.production.snapshot().machines.map((machine) => ({
    partId: machine.partId,
    producedTotal: machine.producedTotal,
    powered: machine.powered,
  }));
  const memberIds = new Set(assemblies.flatMap((entry) => entry.memberIds));
  const outputPortPartIds = [...memberIds].filter((partId) => (
    rig.ports.installedOf(partId).some((port) => port.slot.role === 'output')
  ));
  const links = rig.links.snapshot(rig.scene()).map((link) => ({
    fromPartId: link.from.entityId,
    toPartId: link.to.entityId,
    active: link.active,
  }));
  return { assemblies, machines, outputPortPartIds, links };
}

function conditionMap(view: EndgameWorldView, produced = 0): Map<string, { ok: boolean; current: string }> {
  return new Map(conditionsOf(view, produced).map((entry) => [entry.id, entry]));
}

describe('真实世界状态 → 五条运行证明条件', () => {
  it('组合推导/接口盒/连接/动力全部来自真实快照；未产出时只有 produced 为 false', () => {
    const { rig, assembly } = assembledLine();
    power(rig, 1);
    power(rig, 2);
    const view = worldOf(rig, assembly);
    expect(candidateAssemblyOf(view)?.memberIds).toEqual([1, 2, 3]);
    expect([...view.outputPortPartIds].sort()).toEqual([1, 2, 3]);
    expect(view.links).toHaveLength(2);
    expect(view.links.every((link) => link.active)).toBe(true);
    const conditions = conditionMap(view, 0);
    expect(conditions.get('assembly')?.ok).toBe(true);
    expect(conditions.get('output-boxes')?.ok).toBe(true);
    expect(conditions.get('active-links')?.ok).toBe(true);
    expect(conditions.get('powered')?.ok).toBe(true);
    expect(conditions.get('produced')?.ok).toBe(false);
  });

  it('60 秒窗口内真实产出 ≥12 件 → passed（只统计组合成员核心的 producedTotal 增量）', () => {
    const { rig, assembly } = assembledLine();
    power(rig, 1);
    power(rig, 2);
    power(rig, 3);
    const proof = new EndgameProof(60, 12);
    const startView = worldOf(rig, assembly);
    const baseline = baselineOf(startView);
    expect(proof.begin(startView)).toBe('ok');
    let oreFed = 0;
    for (let step = 0; step < 240; step += 1) {
      if (rig.production.insertInto(1, 'iron_ore', 1) > 0) oreFed += 1;
      run(rig, 0.25, 0.05);
      proof.tick(0.25, worldOf(rig, assembly));
    }
    expect(oreFed).toBeGreaterThan(12);
    const finalView = worldOf(rig, assembly);
    const snapshot = proof.snapshotOf(finalView);
    expect(snapshot.state).toBe('passed');
    expect(proof.passed()).toBe(true);
    expect(snapshot.produced).toBeGreaterThanOrEqual(12);
    expect(snapshot.produced).toBe(producedDeltaOf(finalView, baseline));
    expect(snapshot.conditions.every((entry) => entry.ok)).toBe(true);
    // 物料真的走过连接：搬运件数与各成员 producedTotal 都 > 0。
    const moved = rig.links.snapshot(rig.scene()).reduce((total, link) => total + link.moved, 0);
    expect(moved).toBeGreaterThan(0);
    expect(finalView.machines.filter((machine) => machine.producedTotal > 0).length).toBeGreaterThanOrEqual(2);
  });

  it('真实产线不喂料（摆拍）→ failed，机器/连接/动力存在都不能伪造产出', () => {
    const { rig, assembly } = assembledLine();
    power(rig, 1);
    power(rig, 2);
    const proof = new EndgameProof(3, 12);
    proof.begin(worldOf(rig, assembly));
    for (let step = 0; step < 12; step += 1) {
      run(rig, 0.25, 0.05);
      proof.tick(0.25, worldOf(rig, assembly));
    }
    const snapshot = proof.snapshotOf(worldOf(rig, assembly));
    expect(snapshot.state).toBe('failed');
    expect(snapshot.produced).toBe(0);
    expect(snapshot.failureReason).toContain('观察窗口内组合成员核心产出增量');
  });

  it('动力只接 1 台成员核心 → powered 条件 false（动力来自真实 powered 读数）', () => {
    const { rig, assembly } = assembledLine();
    power(rig, 1);
    const view = worldOf(rig, assembly);
    expect(conditionMap(view).get('powered')?.ok).toBe(false);
    expect(conditionMap(view).get('powered')?.current).toContain('1');
  });
});
