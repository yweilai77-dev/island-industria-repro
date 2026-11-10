import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../items/items.ts';
import { restoreTechState, serializeTechState, submit, submitAll, trackNode, createTechState } from '../tech/state.ts';
import type { TechInventoryPort, TechState } from '../tech/types.ts';

/**
 * P2-E1 科技持久化边界测试（任务书 §六）：
 * serialize→restore 往返、版本不符、未知节点/物品、负数/超额 clamp、
 * 「前置未完成却已解锁」的闭包修复、重复 restore 幂等。
 */

const GEAR = 'tech:gear-manufacture';
const CHUTE = 'tech:chute-logistics';
const INPUT = 'tech:input-interface';
const ASSEMBLY = 'tech:structure-assembly';

function fakeInventory(initial: Record<string, number>): TechInventoryPort {
  const counts = new Map<string, number>(Object.entries(initial));
  return {
    has: (itemId, count) => (counts.get(itemId) ?? 0) >= count,
    remove: (itemId, count) => {
      const have = counts.get(itemId) ?? 0;
      if (have < count) return false;
      counts.set(itemId, have - count);
      return true;
    },
    add: (itemId, count) => counts.set(itemId, (counts.get(itemId) ?? 0) + count),
  };
}

/** 造一个有「已完成 + 部分交付 + 追踪目标」的真实状态。 */
function sampleState(): TechState {
  const inventory = fakeInventory({ iron_ingot: 3, shaft: 3, gear_12: 2, crushed_ore: 3 });
  const afterGear = submitAll(createTechState(), GEAR, inventory);
  expect(afterGear.result.ok).toBe(true);
  const partial = submit(afterGear.state, CHUTE, ITEM_IDS.SHAFT, 1, inventory);
  expect(partial.result.ok).toBe(true);
  const tracked = trackNode(partial.state, CHUTE);
  expect(tracked.ok).toBe(true);
  return tracked.state;
}

function roundTripJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('serialize → restore 往返', () => {
  it('真实状态往返后完全相等且无修复记录', () => {
    const state = sampleState();
    expect(state.unlocked).toEqual([GEAR]);
    expect(state.delivered[CHUTE]).toEqual({ shaft: 1 });
    expect(state.trackedId).toBe(CHUTE);

    const serialized = serializeTechState(state);
    const outcome = restoreTechState(roundTripJson(serialized));
    expect(outcome.repaired).toBe(false);
    expect(outcome.issues).toEqual([]);
    expect(outcome.state).toEqual(serialized);
    expect(outcome.state).not.toBe(serialized);
    expect(outcome.state.version).toBe(1);
    expect(outcome.state.mode).toBe('player');
    expect(outcome.state.unlocked).toEqual([GEAR]);
    expect(outcome.state.delivered).toEqual(serialized.delivered);
    expect(outcome.state.trackedId).toBe(CHUTE);
    // JSON 可序列化：不允许 undefined / 函数 / 循环引用。
    expect(roundTripJson(serialized)).toEqual(serialized);
  });

  it('serialize 返回防御性拷贝，外部改动不影响内部状态', () => {
    const state = sampleState();
    const original = serializeTechState(state);
    const copy = serializeTechState(state) as unknown as {
      delivered: Record<string, Record<string, number>>;
      unlocked: string[];
    };
    copy.delivered[CHUTE]!.shaft = 999;
    copy.delivered[GEAR] = {};
    copy.unlocked.push('tech:combined-works');
    expect(serializeTechState(state)).toEqual(original);
    expect(serializeTechState(state).unlocked).toEqual([GEAR]);
    expect(serializeTechState(state).delivered[CHUTE]).toEqual({ shaft: 1 });
  });

  it('新会话默认状态也可往返', () => {
    const state = createTechState('legacy');
    const outcome = restoreTechState(roundTripJson(serializeTechState(state)));
    expect(outcome.repaired).toBe(false);
    expect(outcome.state).toEqual(state);
    expect(outcome.state.mode).toBe('legacy');
  });
});

describe('不可信数据：版本 / 未知节点 / 未知物品 / clamp', () => {
  it('版本不符：记录 issue、只保留可识别字段', () => {
    const outcome = restoreTechState({
      version: 2,
      mode: 'legacy',
      delivered: { [GEAR]: { iron_ingot: 1 } },
      unlocked: [GEAR],
      trackedId: GEAR,
    });
    expect(outcome.repaired).toBe(true);
    expect(outcome.issues).toEqual(['unsupported state version: 2']);
    expect(outcome.state.version).toBe(1);
    expect(outcome.state.mode).toBe('legacy');
    expect(outcome.state.delivered).toEqual({ [GEAR]: { iron_ingot: 1 } });
    expect(outcome.state.unlocked).toEqual([GEAR]);
    expect(outcome.state.trackedId).toBe(GEAR);
  });

  it('非对象/空对象输入回退到默认 player 空状态并记录版本 issue', () => {
    for (const raw of [null, undefined, 42, 'boom', []]) {
      const outcome = restoreTechState(raw);
      expect(outcome.repaired).toBe(true);
      expect(outcome.issues.some((issue) => issue.startsWith('unsupported state version:'))).toBe(true);
      expect(outcome.state).toEqual(createTechState('player'));
    }
  });

  it('未知节点与非法 delivered 条目逐条丢弃并记录', () => {
    const outcome = restoreTechState({
      version: 1,
      mode: 'player',
      delivered: { 'tech:ghost': { iron_ingot: 1 }, [GEAR]: 5 },
      unlocked: [],
      trackedId: null,
    });
    expect(outcome.issues).toContain('unknown node in save: tech:ghost');
    expect(outcome.issues).toContain(`invalid delivered entry: ${GEAR}`);
    expect(outcome.state.delivered).toEqual({});
    expect(outcome.repaired).toBe(true);
  });

  it('节点成本表里不存在的物品整条丢弃', () => {
    const outcome = restoreTechState({
      version: 1,
      mode: 'player',
      delivered: { [GEAR]: { unobtainium: 2, iron_ingot: 1 } },
      unlocked: [],
      trackedId: null,
    });
    expect(outcome.issues).toEqual([`unknown cost item unobtainium in ${GEAR}`]);
    expect(outcome.state.delivered).toEqual({ [GEAR]: { iron_ingot: 1 } });
  });

  it('负数与超额计数被 clamp 到 [0, 需求]，只保留正数条目', () => {
    const outcome = restoreTechState({
      version: 1,
      mode: 'player',
      delivered: { [GEAR]: { iron_ingot: -2, shaft: 99 } },
      unlocked: [],
      trackedId: null,
    });
    expect(outcome.issues).toEqual([
      `clamped ${GEAR}/iron_ingot: -2 -> 0`,
      `clamped ${GEAR}/shaft: 99 -> 2`,
    ]);
    expect(outcome.state.delivered).toEqual({ [GEAR]: { shaft: 2 } });
    expect(outcome.repaired).toBe(true);
  });

  it('小数计数向下取整（只保留整数进度，不产生修复记录）', () => {
    const outcome = restoreTechState({
      version: 1,
      mode: 'player',
      delivered: { [GEAR]: { iron_ingot: 1.7 } },
      unlocked: [],
      trackedId: null,
    });
    expect(outcome.repaired).toBe(false);
    expect(outcome.issues).toEqual([]);
    expect(outcome.state.delivered).toEqual({ [GEAR]: { iron_ingot: 1 } });
  });

  it('合法范围内的计数不产生 issue', () => {
    const outcome = restoreTechState({
      version: 1,
      mode: 'player',
      delivered: { [GEAR]: { iron_ingot: 3, shaft: 2 } },
      unlocked: [],
      trackedId: null,
    });
    expect(outcome.repaired).toBe(false);
    expect(outcome.issues).toEqual([]);
    expect(outcome.state.delivered).toEqual({ [GEAR]: { iron_ingot: 3, shaft: 2 } });
  });
});

describe('前置闭包修复', () => {
  it('前置未完成却已解锁的节点会被剔除并记录', () => {
    const outcome = restoreTechState({
      version: 1,
      mode: 'player',
      delivered: {},
      unlocked: [CHUTE],
      trackedId: null,
    });
    expect(outcome.repaired).toBe(true);
    expect(outcome.issues).toEqual([`locked node without prerequisites removed: ${CHUTE}`]);
    expect(outcome.state.unlocked).toEqual([]);
  });

  it('多级无效闭包按拓扑逐层剔除', () => {
    const outcome = restoreTechState({
      version: 1,
      mode: 'player',
      delivered: {},
      unlocked: [CHUTE, INPUT],
      trackedId: null,
    });
    expect(outcome.issues).toEqual([
      `locked node without prerequisites removed: ${CHUTE}`,
      `locked node without prerequisites removed: ${INPUT}`,
    ]);
    expect(outcome.state.unlocked).toEqual([]);
  });

  it('只剔除缺前置的节点，前置完整的前缀保留', () => {
    const outcome = restoreTechState({
      version: 1,
      mode: 'player',
      delivered: {},
      unlocked: [GEAR, ASSEMBLY],
      trackedId: null,
    });
    expect(outcome.issues).toEqual([`locked node without prerequisites removed: ${ASSEMBLY}`]);
    expect(outcome.state.unlocked).toEqual([GEAR]);
  });

  it('合法前置闭包原样保留', () => {
    const outcome = restoreTechState({
      version: 1,
      mode: 'player',
      delivered: {},
      unlocked: [GEAR, CHUTE, INPUT],
      trackedId: null,
    });
    expect(outcome.repaired).toBe(false);
    expect(outcome.issues).toEqual([]);
    expect(outcome.state.unlocked).toEqual([GEAR, CHUTE, INPUT]);
  });
});

describe('unlocked / trackedId 容错', () => {
  it('未知已解锁节点被丢弃，重复项幂等去重', () => {
    const unknown = restoreTechState({
      version: 1,
      mode: 'player',
      delivered: {},
      unlocked: [42, 'tech:ghost', GEAR],
      trackedId: null,
    });
    expect(unknown.issues).toEqual([
      'unknown unlocked node: 42',
      'unknown unlocked node: tech:ghost',
    ]);
    expect(unknown.state.unlocked).toEqual([GEAR]);

    const duplicate = restoreTechState({
      version: 1,
      mode: 'player',
      delivered: {},
      unlocked: [GEAR, GEAR],
      trackedId: null,
    });
    expect(duplicate.issues).toEqual([]);
    expect(duplicate.state.unlocked).toEqual([GEAR]);
  });

  it('trackedId：未知被清空并记录；null/缺失/合法值保持', () => {
    const unknown = restoreTechState({ version: 1, mode: 'player', delivered: {}, unlocked: [], trackedId: 'tech:ghost' });
    expect(unknown.issues).toEqual(['unknown tracked node: tech:ghost']);
    expect(unknown.state.trackedId).toBeNull();

    for (const trackedId of [null, undefined]) {
      const outcome = restoreTechState({ version: 1, mode: 'player', delivered: {}, unlocked: [], trackedId });
      expect(outcome.issues).toEqual([]);
      expect(outcome.state.trackedId).toBeNull();
    }

    const valid = restoreTechState({ version: 1, mode: 'player', delivered: {}, unlocked: [], trackedId: GEAR });
    expect(valid.repaired).toBe(false);
    expect(valid.state.trackedId).toBe(GEAR);
  });

  it('mode 只接受 legacy，其余回退 player', () => {
    expect(restoreTechState({ version: 1, mode: 'legacy', delivered: {}, unlocked: [], trackedId: null }).state.mode)
      .toBe('legacy');
    expect(restoreTechState({ version: 1, mode: 'bogus', delivered: {}, unlocked: [], trackedId: null }).state.mode)
      .toBe('player');
    expect(restoreTechState({ version: 1, delivered: {}, unlocked: [], trackedId: null }).state.mode).toBe('player');
  });
});

describe('重复 restore 幂等', () => {
  it('脏数据修复一次后再恢复是干净的，且状态不再变化', () => {
    const dirty = {
      version: 2,
      mode: 'player',
      delivered: { 'tech:ghost': { iron_ingot: 1 }, [GEAR]: { shaft: 99 } },
      unlocked: [CHUTE],
      trackedId: 'tech:ghost',
    };
    const first = restoreTechState(dirty);
    expect(first.repaired).toBe(true);
    const second = restoreTechState(roundTripJson(serializeTechState(first.state)));
    expect(second.repaired).toBe(false);
    expect(second.issues).toEqual([]);
    expect(second.state).toEqual(first.state);
    const third = restoreTechState(roundTripJson(serializeTechState(second.state)));
    expect(third.state).toEqual(second.state);
    expect(third.issues).toEqual([]);
  });

  it('同一份原始数据重复 restore 结果确定且相等', () => {
    const raw = {
      version: 1,
      mode: 'player',
      delivered: { [GEAR]: { iron_ingot: 99 } },
      unlocked: [GEAR, CHUTE, INPUT],
      trackedId: INPUT,
    };
    const a = restoreTechState(raw);
    const b = restoreTechState(raw);
    expect(a.state).toEqual(b.state);
    expect(a.issues).toEqual(b.issues);
    expect(a.repaired).toBe(b.repaired);
  });
});
