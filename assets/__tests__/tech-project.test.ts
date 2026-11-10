import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../items/items.ts';
import { isProjectUnlocked } from '../tech/gates.ts';
import { TECH_NODES, techNodeById } from '../tech/nodes.ts';
import {
  completeProjectNode,
  createTechState,
  deliveredOf,
  missingDeliveryBlockers,
  remainingOf,
  restoreTechState,
  statusOf,
  submit,
  submitAll,
} from '../tech/state.ts';
import type { TechInventoryPort, TechNodeDef, TechState } from '../tech/types.ts';

/**
 * P2-E3 工作包 C · 终局项目完成门控测试（Lead 最终口径）：
 * - 交付与运行证明是**两个独立条件**：交满 16 件照常扣料、写 delivered，但节点永远不因此完成；
 * - `completeProjectNode` 是唯一完成路径（材料已齐 + 完成守卫放行），且幂等；
 * - 证明先过、后交齐时下一次重试可以完成；
 * - 非项目节点完全不受影响（守卫根本不会被查询）。
 */

const COMBINED = 'tech:combined-works';
const GEAR = 'tech:gear-manufacture';

const ALL_NODES = TECH_NODES.map((node) => node.id);
/** 除终局节点外的全部节点：合法前置闭包（终局只差最后一步）。 */
const WITHOUT_FINAL = ALL_NODES.filter((id) => id !== COMBINED);

/** 终局成套设备的 16 件（与节点成本一致，测试按真实条目构造库存）。 */
const FULL_SET: Readonly<Record<string, number>> = {
  [ITEM_IDS.SHAFT]: 6,
  [ITEM_IDS.INTERFACE_BOX]: 3,
  [ITEM_IDS.OUTPUT_INTERFACE_BOX]: 1,
  [ITEM_IDS.SPLITTER_BOX]: 1,
  [ITEM_IDS.MERGER_BOX]: 1,
  [ITEM_IDS.STRUCTURE_FRAME]: 3,
  [ITEM_IDS.VERTICAL_DRIVE]: 1,
};

function nodeOf(id: string): TechNodeDef {
  const node = techNodeById(id);
  if (node === undefined) throw new Error('missing tech node: ' + id);
  return node;
}

interface FakeInventory {
  readonly port: TechInventoryPort;
  count(itemId: string): number;
  readonly removed: { itemId: string; count: number }[];
  readonly added: { itemId: string; count: number }[];
}

function fakeInventory(initial: Readonly<Record<string, number>> = {}): FakeInventory {
  const counts = new Map<string, number>(Object.entries(initial));
  const removed: { itemId: string; count: number }[] = [];
  const added: { itemId: string; count: number }[] = [];
  const port: TechInventoryPort = {
    has: (itemId, count) => (counts.get(itemId) ?? 0) >= count,
    remove: (itemId, count) => {
      const have = counts.get(itemId) ?? 0;
      if (have < count) return false;
      counts.set(itemId, have - count);
      removed.push({ itemId, count });
      return true;
    },
    add: (itemId, count) => {
      counts.set(itemId, (counts.get(itemId) ?? 0) + count);
      added.push({ itemId, count });
    },
  };
  return { port, count: (itemId) => counts.get(itemId) ?? 0, removed, added };
}

/** 前置全部完成、终局节点 available 的状态；delivered 可预置（模拟存档/已交齐）。 */
function stateWithoutFinal(delivered: Record<string, Record<string, number>> = {}): TechState {
  const outcome = restoreTechState({
    version: 1,
    mode: 'player',
    delivered,
    unlocked: [...WITHOUT_FINAL],
    trackedId: null,
  });
  expect(outcome.issues).toEqual([]);
  return outcome.state;
}

/** 材料已全部交齐、但节点尚未完成的状态（用合法存档形态构造）。 */
function fullyDeliveredState(): TechState {
  return stateWithoutFinal({ [COMBINED]: { ...FULL_SET } });
}

describe('交满 16 件：扣料、写 delivered、但项目节点绝不因此完成', () => {
  it('submitAll 一次交齐：pendingVerification=true，节点保持 researching', () => {
    const state = stateWithoutFinal();
    const inventory = fakeInventory(FULL_SET);
    const outcome = submitAll(state, COMBINED, inventory.port);
    expect(outcome.result.ok).toBe(true);
    expect(outcome.result.completed).toBe(false);
    expect(outcome.result.pendingVerification).toBe(true);
    expect(outcome.result.code).toBe('ok');
    // 交付是独立条件：真实扣料、真实写进度。
    expect(outcome.submitted).toHaveLength(7);
    for (const itemId of Object.keys(FULL_SET)) {
      expect(inventory.count(itemId), itemId).toBe(0);
    }
    expect(outcome.state.unlocked).not.toContain(COMBINED);
    expect(statusOf(nodeOf(COMBINED), outcome.state)).toBe('researching');
    expect(remainingOf(nodeOf(COMBINED), outcome.state)).toEqual([]);
    // 项目仍未解锁：交付不能替运行证明开路。
    expect(isProjectUnlocked(outcome.state, new Set(outcome.state.unlocked), 'combined-works')).toBe(false);
  });

  it('逐件 submit：最后一件返回 pendingVerification，unlocked 不追加', () => {
    let state = stateWithoutFinal();
    const inventory = fakeInventory(FULL_SET);
    const node = nodeOf(COMBINED);
    const entries = node.cost;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const outcome = submit(state, COMBINED, entry.itemId, entry.count, inventory.port);
      expect(outcome.result.ok, entry.itemId).toBe(true);
      state = outcome.state;
      const isLast = index === entries.length - 1;
      if (isLast) {
        expect(outcome.result.completed).toBe(false);
        expect(outcome.result.pendingVerification).toBe(true);
      } else {
        expect(state.unlocked).not.toContain(COMBINED);
      }
    }
    expect(state.unlocked).not.toContain(COMBINED);
    expect(statusOf(node, state)).toBe('researching');
    expect(deliveredOf(state, COMBINED, ITEM_IDS.VERTICAL_DRIVE)).toBe(1);
    // 交满后再交同一材料：超出剩余，不再扣料。
    const again = submit(state, COMBINED, ITEM_IDS.SHAFT, 1, inventory.port);
    expect(again.result.ok).toBe(false);
    expect(again.result.code).toBe('exceeds-remaining');
    expect(again.state).toBe(state);
  });
});

describe('completeProjectNode：唯一完成路径', () => {
  it('证明未通过（guard 返回原因）时拒绝，不改状态、不扣任何材料', () => {
    const state = fullyDeliveredState();
    const inventory = fakeInventory(FULL_SET);
    const outcome = completeProjectNode(state, COMBINED, () => '运行证明尚未通过：请先完成 60 秒观察窗口');
    expect(outcome.result.ok).toBe(false);
    expect(outcome.result.code).toBe('project-blocked');
    expect(outcome.result.blockers).toEqual(['运行证明尚未通过：请先完成 60 秒观察窗口']);
    expect(outcome.state).toBe(state);
    expect(outcome.state.unlocked).not.toContain(COMBINED);
    // 完成结算路径没有库存参数：任何一次拒绝都不可能扣料。
    expect(inventory.removed).toEqual([]);
  });

  it('材料未交齐时返回 not-delivered + blockers（不虚构完成）', () => {
    const state = stateWithoutFinal({ [COMBINED]: { [ITEM_IDS.SHAFT]: 5 } });
    const outcome = completeProjectNode(state, COMBINED, () => null);
    expect(outcome.result.ok).toBe(false);
    expect(outcome.result.code).toBe('not-delivered');
    expect(outcome.state).toBe(state);
    expect((outcome.result.blockers ?? []).length).toBeGreaterThan(0);
    expect(missingDeliveryBlockers(nodeOf(COMBINED), state).length).toBeGreaterThan(0);
  });

  it('前置未完成 / 未知节点 / 非项目节点一律拒绝', () => {
    const empty = createTechState();
    expect(completeProjectNode(empty, COMBINED, () => null).result.code).toBe('locked');
    expect(completeProjectNode(empty, 'tech:missing', () => null).result.code).toBe('unknown-node');
    const state = stateWithoutFinal();
    expect(completeProjectNode(state, GEAR, () => null).result.code).toBe('not-required');
  });

  it('证明通过后完成，且只完成一次（幂等、unlocked 不重复）', () => {
    let guardCalls = 0;
    const guard = () => { guardCalls += 1; return null; };
    const state = fullyDeliveredState();
    const done = completeProjectNode(state, COMBINED, guard);
    expect(done.result.ok).toBe(true);
    expect(done.result.completed).toBe(true);
    expect(done.result.code).toBe('ok');
    expect(done.state.unlocked.filter((id) => id === COMBINED)).toHaveLength(1);
    expect(guardCalls).toBe(1);

    const again = completeProjectNode(done.state, COMBINED, guard);
    expect(again.result.ok).toBe(true);
    expect(again.result.completed).toBe(true);
    expect(again.state).toBe(done.state);
    expect(again.state.unlocked.filter((id) => id === COMBINED)).toHaveLength(1);
    // 已完成节点再交付材料：直接按 completed 拒绝，不扣料。
    const inventory = fakeInventory(FULL_SET);
    const submitAfter = submit(again.state, COMBINED, ITEM_IDS.SHAFT, 1, inventory.port);
    expect(submitAfter.result.code).toBe('completed');
    expect(inventory.removed).toEqual([]);
  });

  it('证明先过、后交齐：下一次重试即可完成（覆盖读档恢复顺序）', () => {
    const state = stateWithoutFinal();
    // 证明已达成的 guard：此时材料还没交齐。
    const passedGuard = () => null;
    const tooEarly = completeProjectNode(state, COMBINED, passedGuard);
    expect(tooEarly.result.code).toBe('not-delivered');
    const inventory = fakeInventory(FULL_SET);
    const submitted = submitAll(state, COMBINED, inventory.port);
    expect(submitted.result.pendingVerification).toBe(true);
    const done = completeProjectNode(submitted.state, COMBINED, passedGuard);
    expect(done.result.ok).toBe(true);
    expect(done.result.completed).toBe(true);
  });

  it('完成守卫异常不能放行完成（异常转换为阻塞原因）', () => {
    const state = fullyDeliveredState();
    const outcome = completeProjectNode(state, COMBINED, () => { throw new Error('clock unavailable'); });
    expect(outcome.result.ok).toBe(false);
    expect(outcome.result.code).toBe('project-blocked');
    expect((outcome.result.blockers ?? [])[0]).toContain('clock unavailable');
  });
});

describe('非项目节点不受完成门控影响', () => {
  it('齿轮节点照旧由交付直接完成，守卫从不被查询', () => {
    let guardCalls = 0;
    const guard = () => { guardCalls += 1; return '不应该被调用'; };
    const state = createTechState();
    const inventory = fakeInventory({ iron_ingot: 3, shaft: 2 });
    const outcome = submitAll(state, GEAR, inventory.port);
    expect(outcome.result.ok).toBe(true);
    expect(outcome.result.completed).toBe(true);
    expect(outcome.result.pendingVerification).toBeUndefined();
    expect(outcome.state.unlocked).toContain(GEAR);
    expect(statusOf(nodeOf(GEAR), outcome.state)).toBe('completed');
    // 普通节点的完成与项目守卫无关；completeProjectNode 也不会二次结算它。
    expect(completeProjectNode(outcome.state, GEAR, guard).result.code).toBe('not-required');
    expect(guardCalls).toBe(0);
  });
});
