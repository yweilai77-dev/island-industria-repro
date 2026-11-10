import { describe, expect, it } from 'vitest';
import {
  buildTechTracker,
  buildTechView,
  describeTechError,
  hudModeFor,
  parseTechSnapshot,
  TECH_STATUS_ICONS,
  TECH_STATUS_LABELS,
  type TechView,
} from '../frontend/frontend-tech-view.ts';
import { createTechState, submit, submitAll, techSnapshotOf, trackNode } from '../tech/state.ts';
import type { TechSnapshot } from '../tech/types.ts';
import type { UiGoalState } from '../game-ui-bridge/goal-view.ts';

// P2-E2 科技页视图模型单测：全部是纯函数（不依赖 DOM / 引擎），数据来自真实科技状态机。

const GEAR = 'tech:gear-manufacture';
const CHUTE = 'tech:chute-logistics';

function fakeInventory(initial: Record<string, number>) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    has: (itemId: string, count: number) => (map.get(itemId) ?? 0) >= count,
    remove: (itemId: string, count: number) => {
      const have = map.get(itemId) ?? 0;
      if (have < count) return false;
      map.set(itemId, have - count);
      return true;
    },
    add: (itemId: string, count: number) => {
      map.set(itemId, (map.get(itemId) ?? 0) + count);
    },
  };
}

/** 一直交到 T1.1 完成（3 铁锭 + 2 传动轴）后的快照。 */
function completedGearSnapshot(): TechSnapshot {
  const inventory = fakeInventory({ iron_ingot: 3, shaft: 2 });
  let state = createTechState('player');
  const first = submit(state, GEAR, 'iron_ingot', 3, inventory);
  state = first.state;
  const second = submit(state, GEAR, 'shaft', 2, inventory);
  state = second.state;
  return techSnapshotOf(state);
}

function researchingGearSnapshot(): TechSnapshot {
  const inventory = fakeInventory({ iron_ingot: 3, shaft: 2 });
  const partial = submit(createTechState('player'), GEAR, 'iron_ingot', 1, inventory);
  return techSnapshotOf(partial.state);
}

const snapshotCache = {
  initial: techSnapshotOf(createTechState('player')),
  researching: researchingGearSnapshot(),
  completed: completedGearSnapshot(),
};

const inventoryOf = (counts: Record<string, number>) => new Map(Object.entries(counts));

describe('tech view: stage grouping and node fields', () => {
  it('groups all 12 nodes into the 3 stage labels from TECH_STAGE_LABELS', () => {
    const view = buildTechView(snapshotCache.initial, inventoryOf({}));
    expect(view).not.toBeNull();
    expect(view?.nodes).toHaveLength(12);
    expect(view?.groups.map((group) => [group.stage, group.label, group.total])).toEqual([
      [1, '基础工业', 4],
      [2, '机械化生产', 5],
      [3, '初级自动化工业', 3],
    ]);
    expect(view?.unlockedCount).toBe(0);
  });

  it('exposes name/description/purpose/materials/unlocks for every node', () => {
    const view = buildTechView(snapshotCache.initial, inventoryOf({ iron_ingot: 5, shaft: 3 }));
    const gear = view?.nodes.find((node) => node.id === GEAR);
    expect(gear).toBeDefined();
    expect(gear?.name).toBe('齿轮制造');
    expect(gear?.description.length).toBeGreaterThan(0);
    expect(gear?.purpose.length).toBeGreaterThan(0);
    expect(gear?.stageLabel).toBe('基础工业');
    expect(gear?.routeLabel).toBe('机械动力');
    // 材料行：名称/已交/需求/剩余/库存。
    expect(gear?.materials.map((row) => [row.itemId, row.name, row.delivered, row.required, row.remaining, row.have])).toEqual([
      ['iron_ingot', '铁锭', 0, 3, 3, 5],
      ['shaft', '传动轴', 0, 2, 2, 3],
    ]);
    // 解锁目标用人类可读名（配方 label），不是裸 recipeId。
    expect(gear?.unlocks.map((row) => row.text)).toEqual(['配方 · 锻压 12 齿齿轮', '配方 · 锻压 24 齿齿轮']);
    expect(gear?.requiredTotal).toBe(5);
    expect(gear?.progressPercent).toBe(0);
  });

  it('maps each status to a label, icon and color tone (dual encoding)', () => {
    const view = buildTechView(snapshotCache.initial, inventoryOf({}));
    const gear = view?.nodes.find((node) => node.id === GEAR);
    const chute = view?.nodes.find((node) => node.id === CHUTE);
    expect(gear?.status).toBe('available');
    expect(gear?.statusLabel).toBe('可研究');
    expect(gear?.statusIcon).toBe(TECH_STATUS_ICONS.available);
    expect(gear?.statusTone).toBe('info');
    expect(chute?.status).toBe('locked');
    expect(chute?.statusLabel).toBe('未解锁');
    expect(chute?.statusTone).toBe('muted');
    expect(TECH_STATUS_LABELS.completed).toBe('已完成');
    // 四态颜色/图标互不相同（文字之外还有图形编码，照顾色弱）。
    const icons = new Set(Object.values(TECH_STATUS_ICONS));
    expect(icons.size).toBe(4);
  });

  it('shows prerequisite names with their own status', () => {
    const view = buildTechView(snapshotCache.initial, inventoryOf({}));
    const chute = view?.nodes.find((node) => node.id === CHUTE);
    expect(chute?.requires).toHaveLength(1);
    expect(chute?.requires[0]).toMatchObject({ id: GEAR, name: '齿轮制造', status: 'available', ok: false });
    expect(chute?.requires[0].statusLabel).toBe('可研究');
    expect(chute?.submitEnabled).toBe(false);
    expect(chute?.materials.every((row) => row.canSubmit === false)).toBe(true);
  });

  it('derives researching progress and completed unlock state from the engine snapshot', () => {
    const researching = buildTechView(snapshotCache.researching, inventoryOf({ shaft: 2 }));
    const gear = researching?.nodes.find((node) => node.id === GEAR);
    expect(gear?.status).toBe('researching');
    expect(gear?.deliveredTotal).toBe(1);
    expect(gear?.progressPercent).toBe(20);
    expect(gear?.awaitingProof).toBe(false);
    expect(gear?.materials.find((row) => row.itemId === 'iron_ingot')).toMatchObject({
      delivered: 1, required: 3, remaining: 2, have: 0, canSubmit: false,
    });

    const completed = buildTechView(snapshotCache.completed, inventoryOf({}));
    const done = completed?.nodes.find((node) => node.id === GEAR);
    expect(done?.status).toBe('completed');
    expect(done?.completed).toBe(true);
    expect(done?.progressPercent).toBe(100);
    expect(done?.submitEnabled).toBe(false);
    expect(completed?.unlockedCount).toBe(1);
    const chuteAfter = completed?.nodes.find((node) => node.id === CHUTE);
    expect(chuteAfter?.status).toBe('available');
    expect(chuteAfter?.requires[0].ok).toBe(true);
    expect(chuteAfter?.submitEnabled).toBe(true);
  });

  it('marks a fully delivered but still-researching node as awaiting the running proof', () => {
    const base = snapshotCache.initial;
    const target = base.nodes.find((node) => node.id === 'tech:combined-works');
    expect(target).toBeDefined();
    const delivered = Object.fromEntries((target?.cost ?? []).map((entry) => [entry.itemId, entry.count]));
    const snapshot: TechSnapshot = {
      ...base,
      nodes: base.nodes.map((node) => (node.id === target?.id
        ? { ...node, status: 'researching', delivered }
        : node)),
    };
    const view = buildTechView(snapshot, inventoryOf({}));
    const node = view?.nodes.find((entry) => entry.id === 'tech:combined-works');
    expect(node?.status).toBe('researching');
    expect(node?.deliveredTotal).toBe(node?.requiredTotal);
    expect(node?.awaitingProof).toBe(true);
    expect(node?.unlocks.map((row) => row.text)).toEqual(['终局项目 · 联合工厂总成（Demo 终局）']);
  });
});

describe('tech tracker and HUD switch', () => {
  function trackedSnapshot(nodeId: string | null): TechSnapshot {
    const tracked = trackNode(createTechState('player'), nodeId);
    return techSnapshotOf(tracked.state);
  }

  it('builds the tracker from tech.trackedId only (old target disappears on switch)', () => {
    const view = buildTechView(trackedSnapshot(CHUTE), inventoryOf({ iron_ingot: 1, gear_12: 2, crushed_ore: 3 }));
    const tracker = buildTechTracker(view);
    expect(tracker?.nodeId).toBe(CHUTE);
    expect(tracker?.name).toBe('溜槽物流');
    expect(tracker?.blockedBy).toEqual(['齿轮制造']);
    expect(tracker?.materials.map((row) => [row.itemId, row.name, row.have, row.required, row.remaining])).toEqual([
      ['shaft', '传动轴', 0, 2, 2],
      ['gear_12', '12 齿齿轮', 2, 2, 2],
      ['crushed_ore', '碎铁矿', 3, 3, 3],
    ]);
    expect(buildTechTracker(view)?.completed).toBe(false);

    const switched = buildTechView(trackedSnapshot(GEAR), inventoryOf({}));
    expect(buildTechTracker(switched)?.nodeId).toBe(GEAR);
    expect(buildTechTracker(switched)?.materials.some((row) => row.name === '12 齿齿轮')).toBe(false);
    expect(buildTechTracker(buildTechView(trackedSnapshot(null), inventoryOf({})))).toBeNull();
  });

  it('tracks completed nodes with full progress and no blocking prerequisite', () => {
    const state = (() => {
      const inventory = fakeInventory({ iron_ingot: 3, shaft: 2 });
      let current = createTechState('player');
      current = submit(current, GEAR, 'iron_ingot', 3, inventory).state;
      current = submit(current, GEAR, 'shaft', 2, inventory).state;
      return trackNode(current, GEAR).state;
    })();
    const tracker = buildTechTracker(buildTechView(techSnapshotOf(state), inventoryOf({})));
    expect(tracker?.completed).toBe(true);
    expect(tracker?.statusLabel).toBe('已完成');
    expect(tracker?.progressPercent).toBe(100);
    expect(tracker?.blockedBy).toEqual([]);
    expect(tracker?.materials.every((row) => row.complete)).toBe(true);
  });

  it('never shows both HUDs: order until complete, then tracker or Tab hint', () => {
    const goal = (complete: boolean): UiGoalState => ({
      title: '第一份工业订单',
      subtitle: '教学',
      complete,
      completedCount: complete ? 8 : 0,
      totalCount: 8,
      currentStepId: null,
      currentStep: null,
      steps: [],
      blocker: null,
    });
    const trackerView = buildTechView(trackedSnapshot(GEAR), inventoryOf({}));
    const noTrackerView = buildTechView(trackedSnapshot(null), inventoryOf({}));
    expect(hudModeFor(null, trackerView)).toBe('order');
    expect(hudModeFor(goal(false), trackerView)).toBe('order');
    expect(hudModeFor(goal(true), trackerView)).toBe('tracker');
    expect(hudModeFor(goal(true), noTrackerView)).toBe('hint');
    expect(hudModeFor(goal(true), null)).toBe('hint');
  });
});

describe('tech error messages', () => {
  const view = buildTechView(snapshotCache.initial, inventoryOf({ iron_ingot: 1, crushed_ore: 3 }));
  const inventory = inventoryOf({ iron_ingot: 1 });

  it('explains shortage with exact missing count', () => {
    const text = describeTechError('insufficient-items', {
      view,
      inventory,
      nodeId: GEAR,
      itemId: 'iron_ingot',
      count: 3,
    });
    expect(text).toContain('库存不足');
    expect(text).toContain('铁锭');
    expect(text).toContain('还缺 2 件');
    expect(text).toContain('库存 1 件');
  });

  it('explains exceeds-remaining, locked prerequisites and completed nodes', () => {
    const exceeds = describeTechError('exceeds-remaining', {
      view,
      inventory,
      nodeId: GEAR,
      itemId: 'iron_ingot',
      count: 9,
    });
    expect(exceeds).toContain('数量超出剩余需求');
    expect(exceeds).toContain('只需再交 3 件');

    const locked = describeTechError('locked', { view, nodeId: CHUTE });
    expect(locked).toContain('前置未完成');
    expect(locked).toContain('齿轮制造');

    const completed = describeTechError('completed', { view, nodeId: GEAR });
    expect(completed).toContain('齿轮制造');
    expect(completed).toContain('不可重复提交');
  });

  it('explains project-blocked with the endgame blockers and covers remaining codes', () => {
    const blocked = describeTechError('project-blocked', {
      view,
      projectBlocks: ['运行证明未通过：窗口内产出 3/12', '组合内至少 2 条物料连接为 active'],
    });
    expect(blocked).toContain('运行证明未通过');
    expect(blocked).toContain('3/12');
    expect(describeTechError('unknown-node', { nodeId: 'tech:nope' })).toContain('未知科技节点');
    expect(describeTechError('not-required', { view, nodeId: GEAR, itemId: 'iron_ore' })).toContain('不是');
    expect(describeTechError('tech-unavailable')).toContain('科技服务尚未就绪');
    expect(describeTechError('save-unavailable')).toContain('存档服务尚未就绪');
    expect(describeTechError('not-delivered')).toContain('联合工厂');
    expect(describeTechError('command-failed', { message: 'boom' })).toContain('boom');
    expect(describeTechError('made-up-code')).toContain('made-up-code');
  });
});

describe('defensive tech snapshot parsing', () => {
  it('round-trips a real snapshot (JSON boundary)', () => {
    const parsed = parseTechSnapshot(JSON.parse(JSON.stringify(snapshotCache.completed)));
    expect(parsed).not.toBeNull();
    expect(parsed?.nodes).toHaveLength(12);
    expect(parsed?.nodes.find((node) => node.id === GEAR)?.status).toBe('completed');
    const view = buildTechView(parsed, inventoryOf({}));
    expect(view?.unlockedCount).toBe(1);
  });

  it('returns null for malformed payloads instead of guessing', () => {
    const good = JSON.parse(JSON.stringify(snapshotCache.initial));
    expect(parseTechSnapshot(null)).toBeNull();
    expect(parseTechSnapshot({ mode: 'player' })).toBeNull();
    expect(parseTechSnapshot({ ...good, mode: 'cheat' })).toBeNull();
    expect(parseTechSnapshot({ ...good, nodes: [] })).toBeNull();
    expect(parseTechSnapshot({
      ...good,
      nodes: [{ ...good.nodes[0], status: 'unknown' }],
    })).toBeNull();
    expect(parseTechSnapshot({
      ...good,
      nodes: [{ ...good.nodes[0], cost: [{ itemId: 'iron_ingot', count: 0 }] }],
    })).toBeNull();
    // 额外字段不影响解析（E3 可能给节点加可选字段）。
    const withExtra = parseTechSnapshot({
      ...good,
      nodes: good.nodes.map((node: Record<string, unknown>) => ({ ...node, pendingVerification: true })),
    });
    expect(withExtra?.nodes).toHaveLength(12);
  });

  it('handles a legacy-mode snapshot and tracked node ids', () => {
    const legacy = parseTechSnapshot({
      ...JSON.parse(JSON.stringify(snapshotCache.initial)),
      mode: 'legacy',
      trackedId: GEAR,
    });
    expect(legacy?.mode).toBe('legacy');
    const view = buildTechView(legacy, new Map());
    expect(view?.tracked?.id).toBe(GEAR);
  });
});
