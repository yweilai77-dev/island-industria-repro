import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../items/items.ts';
import { techNodeById } from '../tech/nodes.ts';
import {
  completedSetOf,
  createTechState,
  deliveredOf,
  deliveredTotalOf,
  nodeSnapshotOf,
  remainingOf,
  restoreTechState,
  statusOf,
  submit,
  submitAll,
  techSnapshotOf,
  trackNode,
} from '../tech/state.ts';
import type { TechInventoryPort, TechNodeDef, TechState } from '../tech/types.ts';

/**
 * P2-E1 科技状态机与交付事务测试（任务书 §六）：
 * 四态派生、前置完成推进、部分交付、重复/超额/非法提交、库存原子性、
 * submitAll 补偿事务、unlocked 追加与追踪。
 */

interface FakeInventory {
  readonly port: TechInventoryPort;
  count(itemId: string): number;
  readonly removed: { itemId: string; count: number }[];
  readonly added: { itemId: string; count: number }[];
}

function fakeInventory(
  initial: Record<string, number> = {},
  options: { failRemoveFor?: readonly string[] } = {},
): FakeInventory {
  const counts = new Map<string, number>(Object.entries(initial));
  const removed: { itemId: string; count: number }[] = [];
  const added: { itemId: string; count: number }[] = [];
  const failRemoveFor = new Set(options.failRemoveFor ?? []);
  const port: TechInventoryPort = {
    has: (itemId, count) => (counts.get(itemId) ?? 0) >= count,
    remove: (itemId, count) => {
      if (failRemoveFor.has(itemId)) return false;
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

/** 用合法前置闭包造一个「这些节点已完成」的初始状态。 */
function stateWithUnlocked(ids: readonly string[]): TechState {
  const outcome = restoreTechState({
    version: 1,
    mode: 'player',
    delivered: {},
    unlocked: [...ids],
    trackedId: null,
  });
  expect(outcome.issues).toEqual([]);
  return outcome.state;
}

const GEAR = 'tech:gear-manufacture';
const CHUTE = 'tech:chute-logistics';
const INPUT = 'tech:input-interface';
const OUTPUT = 'tech:output-interface';

function nodeOf(id: string): TechNodeDef {
  const node = techNodeById(id);
  if (node === undefined) throw new Error(`missing tech node: ${id}`);
  return node;
}

describe('四态派生：locked → available → researching → completed', () => {
  it('前置未完成时 locked，逐项交付后 researching，集齐后 completed', () => {
    const output = nodeOf(OUTPUT);
    const empty = createTechState();

    // locked：前置（输入接口盒）未完成，交付被拒绝。
    expect(statusOf(output, empty)).toBe('locked');
    const lockedInventory = fakeInventory({ interface_box: 2, iron_ingot: 4 });
    const lockedSubmit = submit(empty, OUTPUT, ITEM_IDS.INTERFACE_BOX, 2, lockedInventory.port);
    expect(lockedSubmit.result.code).toBe('locked');
    expect(lockedSubmit.state).toBe(empty);
    expect(lockedInventory.count(ITEM_IDS.INTERFACE_BOX)).toBe(2);

    // available：前置全部完成。
    const available = stateWithUnlocked([GEAR, CHUTE, INPUT]);
    expect(statusOf(output, available)).toBe('available');
    expect(remainingOf(output, available)).toEqual(output.cost);
    expect(deliveredTotalOf(output, available)).toBe(0);

    // researching：部分交付，库存真实扣减。
    const inventory = fakeInventory({ interface_box: 2, iron_ingot: 4 });
    const partial = submit(available, OUTPUT, ITEM_IDS.INTERFACE_BOX, 2, inventory.port);
    expect(partial.result).toEqual({
      ok: true,
      code: 'ok',
      nodeId: OUTPUT,
      itemId: ITEM_IDS.INTERFACE_BOX,
      count: 2,
      completed: false,
    });
    expect(statusOf(output, partial.state)).toBe('researching');
    expect(deliveredOf(partial.state, OUTPUT, ITEM_IDS.INTERFACE_BOX)).toBe(2);
    expect(deliveredOf(partial.state, OUTPUT, ITEM_IDS.IRON_INGOT)).toBe(0);
    expect(deliveredTotalOf(output, partial.state)).toBe(2);
    expect(remainingOf(output, partial.state)).toEqual([{ itemId: ITEM_IDS.IRON_INGOT, count: 4 }]);
    expect(inventory.count(ITEM_IDS.INTERFACE_BOX)).toBe(0);

    // completed：最后一件的提交同一事务内完成。
    const final = submit(partial.state, OUTPUT, ITEM_IDS.IRON_INGOT, 4, inventory.port);
    expect(final.result.ok).toBe(true);
    expect(final.result.completed).toBe(true);
    expect(statusOf(output, final.state)).toBe('completed');
    expect(final.state.unlocked).toContain(OUTPUT);
    expect(remainingOf(output, final.state)).toEqual([]);
    expect(deliveredTotalOf(output, final.state)).toBe(6);
    expect(inventory.count(ITEM_IDS.IRON_INGOT)).toBe(0);
  });

  it('前置完成后后继自动变为 available（无显式写入）', () => {
    const chute = nodeOf(CHUTE);
    expect(statusOf(chute, createTechState())).toBe('locked');
    const afterGear = stateWithUnlocked([GEAR]);
    expect(statusOf(chute, afterGear)).toBe('available');
    expect(statusOf(nodeOf('tech:cross-level-drive'), afterGear)).toBe('available');
    // 阶段 2 节点仍然 locked：前置链还没全部完成。
    expect(statusOf(nodeOf(OUTPUT), afterGear)).toBe('locked');
  });

  it('nodeSnapshotOf / techSnapshotOf 输出派生状态与已交付计数', () => {
    const output = nodeOf(OUTPUT);
    const available = stateWithUnlocked([GEAR, CHUTE, INPUT]);
    const snapshot = nodeSnapshotOf(output, available);
    expect(snapshot.id).toBe(OUTPUT);
    expect(snapshot.stage).toBe(2);
    expect(snapshot.route).toBe('industry');
    expect(snapshot.status).toBe('available');
    expect(snapshot.delivered).toEqual({ interface_box: 0, iron_ingot: 0 });
    expect(completedSetOf(available)).toEqual(new Set([GEAR, CHUTE, INPUT]));

    const system = techSnapshotOf(available);
    expect(system.mode).toBe('player');
    expect(system.nodes).toHaveLength(12);
    expect(system.unlocked).toEqual([GEAR, CHUTE, INPUT]);
    expect(system.trackedId).toBeNull();
    expect(system.nodes.find((entry) => entry.id === OUTPUT)?.status).toBe('available');
    expect(system.nodes.find((entry) => entry.id === 'tech:combined-works')?.status).toBe('locked');
  });
});

describe('submit 校验与错误码', () => {
  it('未知节点 / 未知物品 / 非要求物品 / 非法数量', () => {
    const state = createTechState();
    const inventory = fakeInventory({ iron_ingot: 99, iron_ore: 99 });
    expect(submit(state, 'tech:missing', ITEM_IDS.IRON_INGOT, 1, inventory.port).result.code).toBe('unknown-node');
    expect(submit(state, GEAR, 'unobtainium', 1, inventory.port).result.code).toBe('unknown-item');
    expect(submit(state, GEAR, ITEM_IDS.IRON_ORE, 1, inventory.port).result.code).toBe('not-required');
    for (const count of [0, -1, 1.5, Number.NaN]) {
      const outcome = submit(state, GEAR, ITEM_IDS.IRON_INGOT, count, inventory.port);
      expect(outcome.result.code).toBe('invalid-count');
      expect(outcome.state).toBe(state);
    }
    // 失败请求绝不扣库存。
    expect(inventory.removed).toEqual([]);
  });

  it('超出剩余数量被拒；已交满同一材料后继续交也按超出处理', () => {
    const state = createTechState();
    const inventory = fakeInventory({ iron_ingot: 10 });
    const first = submit(state, GEAR, ITEM_IDS.IRON_INGOT, 2, inventory.port);
    expect(first.result.ok).toBe(true);
    expect(remainingOf(nodeOf(GEAR), first.state)).toEqual([
      { itemId: ITEM_IDS.IRON_INGOT, count: 1 },
      { itemId: ITEM_IDS.SHAFT, count: 2 },
    ]);
    const over = submit(first.state, GEAR, ITEM_IDS.IRON_INGOT, 2, inventory.port);
    expect(over.result.code).toBe('exceeds-remaining');
    expect(over.state).toBe(first.state);
    expect(inventory.count(ITEM_IDS.IRON_INGOT)).toBe(8);

    const full = submit(first.state, GEAR, ITEM_IDS.IRON_INGOT, 1, inventory.port);
    expect(full.result.ok).toBe(true);
    const alreadyFull = submit(full.state, GEAR, ITEM_IDS.IRON_INGOT, 1, inventory.port);
    expect(alreadyFull.result.code).toBe('exceeds-remaining');
  });

  it('库存在 has 通过但 remove 失败时：库存不变、状态不变、返回 insufficient-items', () => {
    const state = createTechState();
    const calls = { removed: 0, added: 0 };
    const port: TechInventoryPort = {
      has: () => true,
      remove: () => { calls.removed += 1; return false; },
      add: () => { calls.added += 1; },
    };
    const outcome = submit(state, GEAR, ITEM_IDS.IRON_INGOT, 3, port);
    expect(outcome.result.code).toBe('insufficient-items');
    expect(outcome.result.nodeId).toBe(GEAR);
    expect(outcome.result.itemId).toBe(ITEM_IDS.IRON_INGOT);
    expect(outcome.state).toBe(state);
    expect(calls.removed).toBe(1);
    expect(calls.added).toBe(0);
  });

  it('成功提交才扣库存；库存不足时不扣任何材料', () => {
    const state = createTechState();
    const inventory = fakeInventory({ iron_ingot: 3, shaft: 2 });
    const insufficient = submit(state, GEAR, ITEM_IDS.SHAFT, 2, fakeInventory({ shaft: 1 }).port);
    expect(insufficient.result.code).toBe('insufficient-items');
    expect(insufficient.state).toBe(state);

    const first = submit(state, GEAR, ITEM_IDS.IRON_INGOT, 3, inventory.port);
    expect(first.result.ok).toBe(true);
    expect(inventory.count(ITEM_IDS.IRON_INGOT)).toBe(0);
    expect(inventory.removed).toEqual([{ itemId: ITEM_IDS.IRON_INGOT, count: 3 }]);
    const final = submit(first.state, GEAR, ITEM_IDS.SHAFT, 2, inventory.port);
    expect(final.result.completed).toBe(true);
    expect(inventory.count(ITEM_IDS.SHAFT)).toBe(0);
  });

  it('完成节点拒绝再次提交', () => {
    const state = createTechState();
    const inventory = fakeInventory({ iron_ingot: 3, shaft: 2, iron_ore: 1 });
    const done = submitAll(state, GEAR, inventory.port);
    expect(done.result.ok).toBe(true);
    expect(done.result.completed).toBe(true);
    expect(done.state.unlocked).toEqual([GEAR]);
    for (const itemId of [ITEM_IDS.IRON_INGOT, ITEM_IDS.SHAFT]) {
      const again = submit(done.state, GEAR, itemId, 1, inventory.port);
      expect(again.result.code).toBe('completed');
      expect(again.state).toBe(done.state);
    }
  });
});

describe('submitAll 补偿事务', () => {
  it('一次交齐全部剩余材料并完成节点', () => {
    const state = createTechState();
    const inventory = fakeInventory({ iron_ingot: 3, shaft: 2 });
    const outcome = submitAll(state, GEAR, inventory.port);
    expect(outcome.result).toEqual({ ok: true, code: 'ok', nodeId: GEAR, completed: true });
    expect(outcome.submitted).toEqual(nodeOf(GEAR).cost);
    expect(inventory.removed).toEqual([
      { itemId: ITEM_IDS.IRON_INGOT, count: 3 },
      { itemId: ITEM_IDS.SHAFT, count: 2 },
    ]);
    expect(inventory.count(ITEM_IDS.IRON_INGOT)).toBe(0);
    expect(inventory.count(ITEM_IDS.SHAFT)).toBe(0);
    expect(statusOf(nodeOf(GEAR), outcome.state)).toBe('completed');
  });

  it('部分交付后只交剩余材料', () => {
    const inventoryFull = fakeInventory({ iron_ingot: 3, shaft: 2 });
    const partial = submit(createTechState(), GEAR, ITEM_IDS.IRON_INGOT, 2, inventoryFull.port);
    const outcome = submitAll(partial.state, GEAR, inventoryFull.port);
    expect(outcome.result.ok).toBe(true);
    expect(outcome.submitted).toEqual([
      { itemId: ITEM_IDS.IRON_INGOT, count: 1 },
      { itemId: ITEM_IDS.SHAFT, count: 2 },
    ]);
    expect(inventoryFull.count(ITEM_IDS.IRON_INGOT)).toBe(0);
    expect(inventoryFull.count(ITEM_IDS.SHAFT)).toBe(0);
  });

  it('第二件扣料失败：第一件逆序返还、状态不变', () => {
    const state = stateWithUnlocked([GEAR]);
    const inventory = fakeInventory(
      { shaft: 2, gear_12: 2, crushed_ore: 3 },
      { failRemoveFor: [ITEM_IDS.GEAR_12] },
    );
    const outcome = submitAll(state, CHUTE, inventory.port);
    expect(outcome.result.code).toBe('insufficient-items');
    expect(outcome.result.nodeId).toBe(CHUTE);
    expect(outcome.submitted).toEqual([]);
    expect(outcome.state).toBe(state);
    // 只剩第一件真正扣过料，随后被 add 原样返还。
    expect(inventory.removed).toEqual([{ itemId: ITEM_IDS.SHAFT, count: 2 }]);
    expect(inventory.added).toEqual([{ itemId: ITEM_IDS.SHAFT, count: 2 }]);
    expect(inventory.count(ITEM_IDS.SHAFT)).toBe(2);
    expect(inventory.count(ITEM_IDS.GEAR_12)).toBe(2);
    expect(inventory.count(ITEM_IDS.CRUSHED_ORE)).toBe(3);
    expect(statusOf(nodeOf(CHUTE), outcome.state)).toBe('available');
  });

  it('预检库存不足时一件都不扣', () => {
    const state = createTechState();
    const inventory = fakeInventory({ iron_ingot: 3, shaft: 1 });
    const outcome = submitAll(state, GEAR, inventory.port);
    expect(outcome.result.code).toBe('insufficient-items');
    expect(outcome.state).toBe(state);
    expect(inventory.removed).toEqual([]);
    expect(inventory.added).toEqual([]);
    expect(inventory.count(ITEM_IDS.IRON_INGOT)).toBe(3);
  });

  it('locked / completed / 未知节点返回对应 code', () => {
    const empty = createTechState();
    const inventory = fakeInventory({ shaft: 99, gear_12: 99, crushed_ore: 99, iron_ingot: 99 });
    expect(submitAll(empty, CHUTE, inventory.port).result.code).toBe('locked');
    expect(submitAll(empty, 'tech:missing', inventory.port).result.code).toBe('unknown-node');
    const completeInventory = fakeInventory({ iron_ingot: 3, shaft: 2 });
    const done = submitAll(empty, GEAR, completeInventory.port);
    expect(submitAll(done.state, GEAR, inventory.port).result.code).toBe('completed');
  });

  it('已完成节点但 remaining 为空时 submitAll 也报 completed（防重复结算）', () => {
    // 手工构造：delivered 已满足全部成本但 unlocked 缺失（异常存档形态）。
    const corrupt = restoreTechState({
      version: 1,
      mode: 'player',
      delivered: { [GEAR]: { iron_ingot: 3, shaft: 2 } },
      unlocked: [],
      trackedId: null,
    }).state;
    const outcome = submitAll(corrupt, GEAR, fakeInventory({ iron_ingot: 3, shaft: 2 }).port);
    expect(outcome.result.code).toBe('completed');
    expect(outcome.state).toBe(corrupt);
  });
});

describe('交付后的 unlocked 与追踪', () => {
  it('完成节点时 unlocked 追加且不重复；后续节点继续追加', () => {
    const gearInventory = fakeInventory({ iron_ingot: 3, shaft: 2 });
    const afterGear = submitAll(createTechState(), GEAR, gearInventory.port);
    expect(afterGear.state.unlocked).toEqual([GEAR]);

    const chuteInventory = fakeInventory({ shaft: 2, gear_12: 2, crushed_ore: 3 });
    const afterChute = submitAll(afterGear.state, CHUTE, chuteInventory.port);
    expect(afterChute.result.completed).toBe(true);
    expect(afterChute.state.unlocked).toEqual([GEAR, CHUTE]);

    // 再次提交被 completed 拒绝，集合不重复。
    const again = submitAll(afterChute.state, CHUTE, fakeInventory({ shaft: 2, gear_12: 2, crushed_ore: 3 }).port);
    expect(again.result.code).toBe('completed');
    expect(again.state.unlocked).toEqual([GEAR, CHUTE]);
    expect(new Set(again.state.unlocked).size).toBe(again.state.unlocked.length);
  });

  it('trackNode 设置、清除、未知目标', () => {
    const state = createTechState();
    const tracked = trackNode(state, CHUTE);
    expect(tracked.ok).toBe(true);
    expect(tracked.state.trackedId).toBe(CHUTE);
    expect(tracked.state).not.toBe(state);
    const cleared = trackNode(tracked.state, null);
    expect(cleared.ok).toBe(true);
    expect(cleared.state.trackedId).toBeNull();
    const unknown = trackNode(state, 'tech:missing');
    expect(unknown.ok).toBe(false);
    expect(unknown.state).toBe(state);
    expect(unknown.state.trackedId).toBeNull();
    // 追踪不改变交付与解锁数据。
    expect(cleared.state.delivered).toEqual(state.delivered);
    expect(cleared.state.unlocked).toEqual(state.unlocked);
  });
});
