import { describe, expect, it } from 'vitest';
import {
  ENDGAME_NODE_ID,
  ENDGAME_PROJECT_ID,
  EndgameProof,
  PROOF_DURATION_SECONDS,
  PROOF_MIN_PRODUCED,
  baselineOf,
  buildEndgameSnapshot,
  producedDeltaOf,
} from '../endgame/endgame.ts';
import type { EndgameWorldView } from '../endgame/endgame.ts';
import { completeProjectNode, createTechState, restoreTechState, techSnapshotOf } from '../tech/state.ts';
import { TECH_NODES } from '../tech/nodes.ts';
import {
  assembly,
  fullyDeliveredTech,
  fullyDeliveredTechState,
  machine,
  readyWorld,
  t3NodeId,
  techStateWithDelivered,
  world,
} from './endgame-fixtures.ts';

/**
 * P2-E3 工作包 C · 运行证明窗口 / 序列化 / 完成结算测试。
 *
 * 覆盖任务书 §五 C2/C3：
 * - 观察窗口用确定性 delta 时钟累积 producedTotal 增量（历史累计不算产出）；
 * - 不满足时 failed 且绝不完成项目节点；满足时 passed 且只完成一次；
 * - serialize/restore 往返（不存派生量）；
 * - 禁止伪造：机器存在、全局计数、结构满足但没产出都不能通过。
 */
const ALL = TECH_NODES.map((node) => node.id);

/** 让 1 秒窗口通过：每 tick 两台成员核心各产出 4 件。 */
function passedProof(): EndgameProof {
  const proof = new EndgameProof(1, 12);
  const totals = new Map([[1, 0], [2, 0], [3, 0]]);
  const viewNow = (): EndgameWorldView => world({
    assemblies: [assembly('assembly:1', [1, 2, 3])],
    machines: [...totals].map(([partId, producedTotal]) => machine(partId, producedTotal, partId !== 3)),
    outputPortPartIds: [1, 2],
    links: [{ fromPartId: 1, toPartId: 2, active: true }, { fromPartId: 1, toPartId: 3, active: true }],
  });
  proof.begin(viewNow());
  for (let step = 0; step < 4; step += 1) {
    totals.set(1, (totals.get(1) ?? 0) + 4);
    totals.set(2, (totals.get(2) ?? 0) + 4);
    proof.tick(0.25, viewNow());
  }
  expect(proof.passed()).toBe(true);
  return proof;
}

describe('观察窗口：确定性 delta 时钟累积 producedTotal 增量', () => {
  it('默认参数 60 秒 / 12 件；只累加窗口内增量（历史累计 150 不算）', () => {
    expect(PROOF_DURATION_SECONDS).toBe(60);
    expect(PROOF_MIN_PRODUCED).toBe(12);
    const proof = new EndgameProof();
    expect(proof.durationSeconds).toBe(60);
    expect(proof.targetProduced).toBe(12);
    const totals = new Map([[1, 100], [2, 50], [3, 0]]);
    const viewNow = (): EndgameWorldView => world({
      assemblies: [assembly('assembly:1', [1, 2, 3])],
      machines: [...totals].map(([partId, producedTotal]) => machine(partId, producedTotal, partId !== 3)),
      outputPortPartIds: [1, 2],
      links: [{ fromPartId: 1, toPartId: 2, active: true }, { fromPartId: 1, toPartId: 3, active: true }],
    });
    const baseline = baselineOf(viewNow());
    expect(baseline).toEqual({ '1': 100, '2': 50, '3': 0 });
    expect(producedDeltaOf(viewNow(), baseline)).toBe(0);
    expect(proof.begin(viewNow())).toBe('ok');
    for (let step = 0; step < 40; step += 1) proof.tick(0.25, viewNow());
    expect(proof.snapshotOf(viewNow()).state).toBe('running');
    expect(proof.snapshotOf(viewNow()).produced).toBe(0);
    for (let step = 0; step < 40; step += 1) {
      totals.set(1, (totals.get(1) ?? 0) + 1);
      totals.set(2, (totals.get(2) ?? 0) + 1);
      proof.tick(0.25, viewNow());
    }
    expect(proof.snapshotOf(viewNow()).produced).toBe(80);
    expect(proof.snapshotOf(viewNow()).state).toBe('running');
    for (let step = 0; step < 160; step += 1) {
      totals.set(1, (totals.get(1) ?? 0) + 1);
      totals.set(2, (totals.get(2) ?? 0) + 1);
      proof.tick(0.25, viewNow());
    }
    const done = proof.snapshotOf(viewNow());
    expect(done.state).toBe('passed');
    expect(done.elapsedSeconds).toBe(60);
    expect(done.produced).toBe(400);
    expect(proof.completionBlocker()).toBeNull();
  });

  it('窗口结束但产出不足 → failed + 明确原因；completeProjectNode 被拒且状态不变', () => {
    const proof = new EndgameProof(5, 12);
    const view = readyWorld();
    expect(proof.begin(view)).toBe('ok');
    for (let step = 0; step < 20; step += 1) proof.tick(0.25, view);
    const snapshot = proof.snapshotOf(view);
    expect(snapshot.state).toBe('failed');
    expect(proof.passed()).toBe(false);
    expect(snapshot.failureReason).toContain('观察窗口内组合成员核心产出增量');
    expect(proof.completionBlocker()).not.toBeNull();
    const state = fullyDeliveredTechState().state;
    const outcome = completeProjectNode(state, t3NodeId, () => proof.completionBlocker());
    expect(outcome.result.code).toBe('project-blocked');
    expect(outcome.state).toBe(state);
  });

  it('结构条件不满足时 failed 且原因点名缺哪条（机器存在不算完成）', () => {
    const noAssembly = world({ machines: [machine(1, 0, true), machine(2, 0, true)] });
    const proof = new EndgameProof(2, 12);
    proof.begin(noAssembly);
    for (let step = 0; step < 8; step += 1) proof.tick(0.25, noAssembly);
    const snapshot = proof.snapshotOf(noAssembly);
    expect(snapshot.state).toBe('failed');
    expect(snapshot.failureReason).toContain('存在 ≥3 台加工核心的组合机械');
    expect(snapshot.conditions.find((entry) => entry.id === 'assembly')?.ok).toBe(false);
  });

  it('cancel：运行中可中止；已通过不可回退；failed 后可重来', () => {
    const proof = new EndgameProof(10, 12);
    proof.begin(readyWorld());
    proof.tick(1, readyWorld());
    expect(proof.cancel()).toBe(true);
    expect(proof.state()).toBe('idle');
    expect(proof.snapshotOf(readyWorld()).produced).toBe(0);
    proof.begin(readyWorld());
    proof.tick(2, readyWorld());
    expect(proof.begin(readyWorld())).toBe('already-running');
    expect(proof.snapshotOf(readyWorld()).elapsedSeconds).toBe(2);
    proof.cancel();
    const failing = new EndgameProof(1, 12);
    failing.begin(readyWorld());
    failing.tick(1, readyWorld());
    expect(failing.state()).toBe('failed');
    expect(failing.begin(readyWorld())).toBe('ok');
    expect(failing.state()).toBe('running');
    const passed = passedProof();
    expect(passed.cancel()).toBe(false);
    expect(passed.state()).toBe('passed');
    expect(passed.begin(readyWorld())).toBe('already-passed');
  });
});

describe('proof passed → completeProjectNode 只完成一次', () => {
  it('通过后项目节点完成一次；再次调用幂等', () => {
    const proof = passedProof();
    const guard = () => proof.completionBlocker();
    const state = fullyDeliveredTechState().state;
    const done = completeProjectNode(state, t3NodeId, guard);
    expect(done.result.ok).toBe(true);
    expect(done.result.completed).toBe(true);
    expect(done.state.unlocked.filter((id) => id === ENDGAME_NODE_ID)).toHaveLength(1);
    const again = completeProjectNode(done.state, t3NodeId, guard);
    expect(again.result.ok).toBe(true);
    expect(again.result.completed).toBe(true);
    expect(again.state).toBe(done.state);
    expect(again.state.unlocked.filter((id) => id === t3NodeId)).toHaveLength(1);
  });

  it('begin 不扣材料、不写科技进度：只读快照前后一致', () => {
    const state = fullyDeliveredTechState().state;
    const before = JSON.stringify(techSnapshotOf(state));
    const proof = new EndgameProof();
    proof.begin(readyWorld());
    expect(JSON.stringify(techSnapshotOf(state))).toBe(before);
    expect(proof.snapshotOf(readyWorld()).state).toBe('running');
  });
});

describe('serialize / restore（纯 JSON，不存派生量）', () => {
  it('running 窗口往返后继续计时并正常通过', () => {
    const totals = new Map([[1, 10], [2, 0], [3, 0]]);
    const viewNow = (): EndgameWorldView => world({
      assemblies: [assembly('assembly:1', [1, 2, 3])],
      machines: [...totals].map(([partId, producedTotal]) => machine(partId, producedTotal, partId !== 3)),
      outputPortPartIds: [1, 2],
      links: [{ fromPartId: 1, toPartId: 2, active: true }, { fromPartId: 1, toPartId: 3, active: true }],
    });
    const proof = new EndgameProof(4, 12);
    proof.begin(viewNow());
    for (let step = 0; step < 8; step += 1) {
      totals.set(1, (totals.get(1) ?? 0) + 3);
      totals.set(2, (totals.get(2) ?? 0) + 3);
      proof.tick(0.25, viewNow());
    }
    const serialized = proof.serialize();
    expect(Object.keys(serialized).sort()).toEqual([
      'baseline', 'elapsedSeconds', 'failureReason', 'lastConclusion', 'passed', 'produced', 'startedAt', 'state', 'version',
    ]);
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);
    const restored = new EndgameProof(4, 12);
    const outcome = restored.restore(JSON.parse(JSON.stringify(serialized)));
    expect(outcome.repaired).toBe(false);
    expect(restored.state()).toBe('running');
    expect(restored.snapshotOf(viewNow()).elapsedSeconds).toBe(serialized.elapsedSeconds);
    for (let step = 0; step < 8; step += 1) {
      totals.set(1, (totals.get(1) ?? 0) + 3);
      totals.set(2, (totals.get(2) ?? 0) + 3);
      restored.tick(0.25, viewNow());
    }
    expect(restored.passed()).toBe(true);
  });

  it('passed 状态往返后仍是终态（不重新开窗）', () => {
    const proof = passedProof();
    const restored = new EndgameProof(1, 12);
    const outcome = restored.restore(JSON.parse(JSON.stringify(proof.serialize())));
    expect(outcome.repaired).toBe(false);
    expect(restored.passed()).toBe(true);
    expect(restored.state()).toBe('passed');
    expect(restored.completionBlocker()).toBeNull();
  });

  it('不可信数据：版本/状态/计数/基线逐条修复，绝不变成 passed', () => {
    const proof = new EndgameProof(60, 12);
    const outcome = proof.restore({
      version: 9,
      state: 'flying',
      passed: false,
      elapsedSeconds: 999,
      produced: -5,
      baseline: { '1': 3, abc: 2, '2': -1 },
      startedAt: 'soon',
      failureReason: '伪造原因',
      lastConclusion: { at: 'x' },
    });
    expect(outcome.repaired).toBe(true);
    expect(outcome.issues.length).toBeGreaterThan(0);
    expect(proof.state()).toBe('idle');
    expect(proof.passed()).toBe(false);
    expect(proof.completionBlocker()).not.toBeNull();
    const empty = new EndgameProof(60, 12);
    for (const raw of [null, 42, 'boom', [], undefined]) {
      expect(empty.restore(raw).repaired).toBe(true);
      expect(empty.passed()).toBe(false);
    }
  });
});

describe('终局快照与 blocks（两个独立条件）', () => {
  it('交付未齐 + 证明未开始：两条 block 都出现，completed=false', () => {
    const state = techStateWithDelivered({ [t3NodeId]: { shaft: 5 } }).state;
    const proof = new EndgameProof();
    const snapshot = buildEndgameSnapshot(techSnapshotOf(state), proof.snapshotOf(world()));
    expect(snapshot.projectId).toBe(ENDGAME_PROJECT_ID);
    expect(snapshot.completed).toBe(false);
    expect(snapshot.unlocked).toBe(true);
    expect(snapshot.blocks.join('|')).toContain('成套设备还差');
    expect(snapshot.blocks.join('|')).toContain('运行证明');
    expect(snapshot.delivery.totalRequired).toBe(16);
  });

  it('交付已齐 + 证明已过：blocks 为空（等待自动结算），completed 仍来自 tech', () => {
    const proof = passedProof();
    const view = readyWorld();
    const snapshot = buildEndgameSnapshot(fullyDeliveredTech(), proof.snapshotOf(view));
    expect(snapshot.completed).toBe(false);
    expect(snapshot.blocks).toEqual([]);
  });

  it('科技节点 completed 时终局 completed=true 且 blocks 为空；前置未完成时 unlocked=false', () => {
    const done = restoreTechState({
      version: 1, mode: 'player', delivered: {}, unlocked: [...ALL], trackedId: null,
    });
    expect(done.issues).toEqual([]);
    const proof = new EndgameProof();
    const completedSnapshot = buildEndgameSnapshot(techSnapshotOf(done.state), proof.snapshotOf(world()));
    expect(completedSnapshot.completed).toBe(true);
    expect(completedSnapshot.blocks).toEqual([]);
    const locked = buildEndgameSnapshot(techSnapshotOf(createTechState()), proof.snapshotOf(world()));
    expect(locked.unlocked).toBe(false);
    expect(locked.blocks.join('|')).toContain('前置科技');
  });
});
