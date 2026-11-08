import { describe, expect, it } from 'vitest';
import {
  CRUSHER_ID,
  CYCLIC_BREAK_PART_ID,
  CYCLIC_LOOP_LINE,
  FLYWHEEL_ID,
  FORGE_ID,
  GoalRig,
  OVERLOAD_ORDER_LINE,
  POWERED_LINE,
  SMELTER_ID,
  engageFlywheel,
  expectGoalViewMatches,
  feedFromInventory,
  producedCount,
  runUntil,
  startOrder,
  tick,
} from './goal-e2e-fixtures.ts';

/**
 * M2.0-P1-D 场景 2 / 3 / 4：动力网络层面的订单判定。
 * 闭环、过载、动力中断全部由真实 buildConnections + solvePower 产生，测试不手写网络状态。
 */

describe('M2.0-P1-D 场景 2：闭环网络识别', () => {
  it('rejects a real gear loop and only advances after the loop is cut', () => {
    const rig = new GoalRig(CYCLIC_LOOP_LINE);
    rig.inventory.add('iron_ore', 2);
    engageFlywheel(rig);
    const { progress, snapshot: first } = startOrder(rig);

    // 真实 buildConnections 把两条平行轴系在两端啮合，solver 必须在扭矩分配之前拒绝整网。
    const networks = rig.mech.snapshot().networks;
    expect(networks).toHaveLength(1);
    expect(networks[0]?.status).toBe('unsupported');
    expect(networks[0]?.reason).toBe('cyclic-network');
    expect(networks[0]?.speedFactor).toBe(0);
    expect(networks[0]?.sourceIds).toEqual([FLYWHEEL_ID]);
    expect(networks[0]?.machineIds).toEqual(expect.arrayContaining([CRUSHER_ID, SMELTER_ID, FORGE_ID]));
    expect(networks[0]?.partIds).toHaveLength(CYCLIC_LOOP_LINE.length);
    expect(rig.mech.snapshot().parts.every((part) => part.powered === false)).toBe(true);

    // 订单不会锁存 connect-power，阻塞原因明确是「连接未完成」（闭环不算可用网络）。
    expect(first.currentStep.id).toBe('connect-power');
    expect(progress.state().completed).toEqual(['gather-ore', 'build-machines']);
    expect(first.blocker?.code).toBe('no-connection');
    expect(first.complete).toBe(false);
    expectGoalViewMatches(first);

    // 真实拆掉环路闭口齿轮后：同一批零件重新连接成树状网络，订单推进。
    rig.setParts(CYCLIC_LOOP_LINE.filter((spec) => spec.id !== CYCLIC_BREAK_PART_ID));
    const fixed = rig.mech.snapshot().networks;
    expect(fixed).toHaveLength(1);
    expect(fixed[0]?.status).toBe('powered');
    expect(fixed[0]?.speedFactor).toBeGreaterThan(0);
    expect(fixed[0]?.machineIds).toEqual(expect.arrayContaining([CRUSHER_ID, SMELTER_ID, FORGE_ID]));

    const snapshot = tick(rig, progress);
    expect(progress.state().completed).toEqual([
      'gather-ore',
      'build-machines',
      'connect-power',
      'start-power',
    ]);
    expect(snapshot.currentStep.id).toBe('crush-ore');
    expect(snapshot.blocker?.code).toBe('no-input');
    expect(snapshot.complete).toBe(false);
    expectGoalViewMatches(snapshot);
  });
});

describe('M2.0-P1-D 场景 3：真实网络过载', () => {
  it('stalls a real overloaded network and blocks start-power with network-overload', () => {
    const rig = new GoalRig(OVERLOAD_ORDER_LINE);
    rig.inventory.add('iron_ore', 2);
    const { progress, snapshot: first } = startOrder(rig);

    // 源未合上离合器：网络 idle，前三步锁存，第四步提示 no-power。
    expect(progress.state().completed).toEqual(['gather-ore', 'build-machines', 'connect-power']);
    expect(first.currentStep.id).toBe('start-power');
    expect(first.blocker?.code).toBe('no-power');
    expectGoalViewMatches(first);

    // 真实打开测试动力源 → 真实负载 110 ≥ 容量 100 → 整网 stalled。
    rig.mech.setSourceEnabled(1, true);
    const snapshot = tick(rig, progress);
    const network = rig.mech.snapshot().networks[0];
    expect(network?.status).toBe('stalled');
    expect(network?.reason).toBe('source-overload');
    expect(network?.speedFactor).toBe(0);
    expect(network?.demandTorque).toBeGreaterThanOrEqual(100);
    expect(rig.mech.snapshot().parts.every((part) => part.powered === false)).toBe(true);
    expect(rig.production.snapshot().machines.every((machine) => machine.block === 'no-power')).toBe(true);

    expect(snapshot.currentStep.id).toBe('start-power');
    expect(progress.state().completed).not.toContain('start-power');
    expect(snapshot.blocker?.code).toBe('network-overload');
    expect(snapshot.complete).toBe(false);
    expectGoalViewMatches(snapshot);
  });
});

describe('M2.0-P1-D 场景 4：动力中断与恢复', () => {
  it('freezes real production progress while unpowered and resumes from the same progress', () => {
    const rig = new GoalRig(POWERED_LINE);
    rig.inventory.add('iron_ore', 2);
    engageFlywheel(rig);
    const { progress, snapshot: first } = startOrder(rig);
    expect(first.currentStep.id).toBe('crush-ore');

    expect(feedFromInventory(rig, CRUSHER_ID, 2)).toBe(2);
    let snapshot = tick(rig, progress);
    let machine = rig.production.snapshot().machines.find((entry) => entry.partId === CRUSHER_ID);
    for (let index = 0; index < 20 && (machine?.progress ?? 0) <= 0.2; index += 1) {
      snapshot = tick(rig, progress);
      machine = rig.production.snapshot().machines.find((entry) => entry.partId === CRUSHER_ID);
    }
    expect(machine?.progress ?? 0).toBeGreaterThan(0.2);
    expect(producedCount(rig, 'crushed_ore')).toBe(0);
    const frozenProgress = machine?.progress ?? 0;

    // 真实断开离合：机器断电，进度冻结、不消耗原料。
    rig.mech.setSourceEnabled(FLYWHEEL_ID, false);
    snapshot = tick(rig, progress);
    expect(snapshot.currentStep.id).toBe('crush-ore');
    expect(snapshot.blocker?.code).toBe('no-power');
    expect(rig.production.snapshot().machines.find((entry) => entry.partId === CRUSHER_ID)?.block).toBe('no-power');
    expect(rig.production.snapshot().machines.find((entry) => entry.partId === CRUSHER_ID)?.progress)
      .toBeCloseTo(frozenProgress, 10);

    // 空转 10 帧：订单不前进、不误判完成、HUD 视图与快照一致。
    for (let index = 0; index < 10; index += 1) snapshot = tick(rig, progress);
    expect(producedCount(rig, 'crushed_ore')).toBe(0);
    expect(rig.production.snapshot().machines.find((entry) => entry.partId === CRUSHER_ID)?.progress)
      .toBeCloseTo(frozenProgress, 10);
    expect(progress.state().completed).toContain('start-power');
    expect(snapshot.steps.find((step) => step.id === 'crush-ore')?.progress).toEqual({ current: 0, required: 2 });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.blocker?.code).toBe('no-power');
    expectGoalViewMatches(snapshot);

    // 重新合上离合：从原进度继续，真实产出 2 个碎铁矿后推进到熔炼步。
    rig.mech.setSourceEnabled(FLYWHEEL_ID, true);
    snapshot = tick(rig, progress);
    expect(rig.production.snapshot().machines.find((entry) => entry.partId === CRUSHER_ID)?.progress ?? 0)
      .toBeGreaterThan(frozenProgress);
    snapshot = runUntil(rig, progress, () => producedCount(rig, 'crushed_ore') >= 2);
    expect(producedCount(rig, 'crushed_ore')).toBe(2);
    expect(snapshot.currentStep.id).toBe('smelt-ingot');
    expect(progress.state().completed).toContain('crush-ore');
    expectGoalViewMatches(snapshot);
  });
});
