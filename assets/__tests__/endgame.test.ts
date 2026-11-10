import { describe, expect, it } from 'vitest';
import {
  EMPTY_TECH_SNAPSHOT,
  PROOF_MIN_PRODUCED,
  candidateAssemblyOf,
  conditionsOf,
  deliveryOf,
} from '../endgame/endgame.ts';
import type { EndgameLinkView } from '../endgame/endgame.ts';
import { createTechState, techSnapshotOf } from '../tech/state.ts';
import { assembly, fullyDeliveredTech, machine, readyWorld, techStateWithDelivered, world } from './endgame-fixtures.ts';

/**
 * P2-E3 工作包 C · 终局联合工厂（交付 + 运行证明条件）测试。
 *
 * 覆盖任务书 §五 C1/C2 的只读派生部分：
 * - 成套交付进度来自真实 TechState.delivered（16 件、7 项、名称来自物品表）；
 * - 五条运行证明条件逐条 false→true（组合 / 输出盒 / active 连接 / powered / 窗口产出）；
 * - 候选取成员最多的组合机械（确定性）。
 *
 * 窗口累积/序列化的测试在 endgame-window.test.ts（单文件 20 KB 上限拆分）。
 */
describe('成套交付（真实 TechState.delivered → 只读投影）', () => {
  it('16 件 / 7 项 / 物品名来自物品表；部分交付只反映已交数量', () => {
    const state = techStateWithDelivered({ 'tech:combined-works': { shaft: 5, vertical_drive: 1 } }).state;
    const delivery = deliveryOf(techSnapshotOf(state));
    expect(delivery.entries).toHaveLength(7);
    expect(delivery.totalRequired).toBe(16);
    expect(delivery.totalDelivered).toBe(6);
    expect(delivery.complete).toBe(false);
    expect(delivery.entries.find((entry) => entry.itemId === 'shaft'))
      .toEqual({ itemId: 'shaft', name: '传动轴', required: 6, delivered: 5 });
    expect(delivery.entries.find((entry) => entry.itemId === 'vertical_drive')?.name).toBe('立式传动带');
    expect(delivery.entries.find((entry) => entry.itemId === 'structure_frame')?.required).toBe(3);
  });

  it('交齐 16 件后 delivery.complete=true（但节点仍 researching，完成由 proof 守卫）', () => {
    const delivery = deliveryOf(fullyDeliveredTech());
    expect(delivery.totalDelivered).toBe(16);
    expect(delivery.complete).toBe(true);
    expect(fullyDeliveredTech().nodes.find((entry) => entry.id === 'tech:combined-works')?.status)
      .toBe('researching');
  });

  it('没有科技节点数据时不虚构交付进度；有节点但未交付时 16 件全是 0', () => {
    expect(deliveryOf(EMPTY_TECH_SNAPSHOT).entries).toEqual([]);
    expect(deliveryOf(EMPTY_TECH_SNAPSHOT).totalRequired).toBe(0);
    const fresh = deliveryOf(techSnapshotOf(createTechState()));
    expect(fresh.totalRequired).toBe(16);
    expect(fresh.totalDelivered).toBe(0);
    expect(fresh.complete).toBe(false);
  });
});

describe('五条运行证明条件逐条 false → true', () => {
  it('基础世界四条结构条件全 true，产出单独判定', () => {
    const view = readyWorld();
    const conditions = new Map(conditionsOf(view, 0).map((entry) => [entry.id, entry]));
    expect(conditions.get('assembly')?.ok).toBe(true);
    expect(conditions.get('output-boxes')?.ok).toBe(true);
    expect(conditions.get('active-links')?.ok).toBe(true);
    expect(conditions.get('powered')?.ok).toBe(true);
    expect(conditions.get('produced')?.ok).toBe(false);
    expect(conditionsOf(view, PROOF_MIN_PRODUCED).find((entry) => entry.id === 'produced')?.ok).toBe(true);
  });

  it('条件 1：组合成员 <3 时失败，第 3 台核心加入后通过', () => {
    const two = world({
      assemblies: [assembly('assembly:1', [1, 2])],
      machines: [machine(1, 0, true), machine(2, 0, true)],
      outputPortPartIds: [1, 2],
      links: [{ fromPartId: 1, toPartId: 2, active: true }],
    });
    expect(conditionsOf(two, 0).find((entry) => entry.id === 'assembly')?.ok).toBe(false);
    expect(conditionsOf(readyWorld(), 0).find((entry) => entry.id === 'assembly')?.current).toContain('3');
  });

  it('条件 2：装了输出接口盒的核心 1 台 → 2 台', () => {
    const one = world({
      assemblies: [assembly('assembly:1', [1, 2, 3])],
      machines: [machine(1, 0, true), machine(2, 0, true), machine(3, 0, false)],
      outputPortPartIds: [1],
      links: [{ fromPartId: 1, toPartId: 2, active: true }, { fromPartId: 1, toPartId: 3, active: true }],
    });
    expect(conditionsOf(one, 0).find((entry) => entry.id === 'output-boxes')?.ok).toBe(false);
    expect(conditionsOf(readyWorld(), 0).find((entry) => entry.id === 'output-boxes')?.ok).toBe(true);
  });

  it('条件 3：口径 = 两端都是候选组合成员核心的 active 连接；外部/失效连接不计', () => {
    const base = {
      assemblies: [assembly('assembly:1', [1, 2, 3])],
      machines: [machine(1, 0, true), machine(2, 0, true), machine(3, 0, false)],
      outputPortPartIds: [1, 2],
    };
    const active = (links: readonly EndgameLinkView[]): boolean | undefined => conditionsOf(world({ ...base, links }), 0)
      .find((entry) => entry.id === 'active-links')?.ok;
    expect(active([{ fromPartId: 1, toPartId: 2, active: true }])).toBe(false);
    // 失效连接不计。
    expect(active([
      { fromPartId: 1, toPartId: 2, active: true }, { fromPartId: 1, toPartId: 3, active: false },
    ])).toBe(false);
    // 一端是外部核心（9）不算「组合内连接」。
    expect(active([
      { fromPartId: 1, toPartId: 2, active: true }, { fromPartId: 1, toPartId: 9, active: true },
    ])).toBe(false);
    expect(active([
      { fromPartId: 1, toPartId: 2, active: true }, { fromPartId: 1, toPartId: 3, active: true },
    ])).toBe(true);
  });

  it('条件 4：powered 1 台 → 2 台', () => {
    const base = {
      assemblies: [assembly('assembly:1', [1, 2, 3])],
      outputPortPartIds: [1, 2],
      links: [{ fromPartId: 1, toPartId: 2, active: true }, { fromPartId: 1, toPartId: 3, active: true }],
    };
    const one = world({ ...base, machines: [machine(1, 0, true), machine(2, 0, false), machine(3, 0, false)] });
    expect(conditionsOf(one, 0).find((entry) => entry.id === 'powered')?.ok).toBe(false);
    expect(conditionsOf(readyWorld(), 0).find((entry) => entry.id === 'powered')?.ok).toBe(true);
  });

  it('条件 5：产出 11 → 12 的边界', () => {
    const produced = (value: number): boolean | undefined => conditionsOf(readyWorld(), value)
      .find((entry) => entry.id === 'produced')?.ok;
    expect(produced(PROOF_MIN_PRODUCED - 1)).toBe(false);
    expect(produced(PROOF_MIN_PRODUCED)).toBe(true);
  });

  it('候选组合取成员最多者（并列取 ID 最小）；其它组合不参与判定', () => {
    const view = world({
      assemblies: [assembly('assembly:2', [8, 9]), assembly('assembly:1', [1, 2, 3])],
      machines: [machine(1, 0, true), machine(2, 0, true), machine(8, 0, true), machine(9, 0, true)],
    });
    expect(candidateAssemblyOf(view)?.id).toBe('assembly:1');
    expect(candidateAssemblyOf(world())).toBeUndefined();
    const tie = world({ assemblies: [assembly('assembly:9', [1, 2]), assembly('assembly:3', [4, 5])] });
    expect(candidateAssemblyOf(tie)?.id).toBe('assembly:3');
  });
});
