import { describe, expect, it } from 'vitest';
import { buildStateMessage, stateSignature } from '../game-ui-bridge/protocol.ts';
import {
  buildGoalView,
  goalViewSignature,
  type UiGoalState,
} from '../game-ui-bridge/goal-view.ts';
import { parseState } from '../frontend/frontend-ui-protocol.ts';
import { HOTBAR_SLOT_COUNT } from '../hotbar/hotbar.ts';
import { itemDefinitions } from '../items/items.ts';
import {
  evaluate,
  factory,
  poweredFactory,
  producedOf,
} from './goal-fixtures.ts';

// M2.0-P1-C 协议/桥接测试：目标数据如何进入 UI 状态消息，以及前端如何解析。
// 不启动引擎：验证纯数据边界与「目标变化会触发新消息」的签名逻辑。

const definitions = itemDefinitions();
const emptySlots = new Array(HOTBAR_SLOT_COUNT).fill(null);

function viewOf(result: { snapshot: Parameters<typeof buildGoalView>[0] }): UiGoalState {
  const view = buildGoalView(result.snapshot);
  if (view === null) throw new Error('expected a goal view');
  return view;
}

const INITIAL_VIEW = viewOf(evaluate(factory()));
const PARTIAL_VIEW = viewOf(evaluate(poweredFactory({ produced: producedOf(1, 0, 0) })));

function bridgeSignature(goal: UiGoalState | null): string {
  // 与 bridge.pack.ts 相同的组合方式：库存/快捷栏签名 + 目标视图签名。
  return stateSignature(definitions, () => 0, 0) + '|' + goalViewSignature(goal);
}

describe('ui state message with goal', () => {
  it('carries goal data next to the existing inventory payload', () => {
    const message = buildStateMessage({
      revision: 7,
      definitions,
      totals: new Map(),
      slots: emptySlots,
      selected: 0,
      goal: PARTIAL_VIEW,
    });
    expect(message.goal).toEqual(PARTIAL_VIEW);
    expect(message.items).toEqual([]);
    expect(message.hotbar.slots).toEqual(emptySlots);
    expect(JSON.parse(JSON.stringify(message))).toEqual(message);
  });

  it('sends goal: null while the mechanical runtime service is not ready', () => {
    const message = buildStateMessage({
      revision: 1,
      definitions,
      totals: new Map(),
      slots: emptySlots,
      selected: 0,
    });
    expect(message.goal).toBeNull();
  });

  it('marks goal changes as a new broadcast opportunity', () => {
    expect(bridgeSignature(INITIAL_VIEW)).not.toBe(bridgeSignature(PARTIAL_VIEW));
    expect(bridgeSignature(INITIAL_VIEW)).toBe(bridgeSignature(INITIAL_VIEW));
    expect(bridgeSignature(null)).not.toBe(bridgeSignature(INITIAL_VIEW));
  });
});

describe('frontend state parsing with goal', () => {
  it('parses the goal view for rendering', () => {
    const message = buildStateMessage({
      revision: 3,
      definitions,
      totals: new Map(),
      slots: emptySlots,
      selected: 0,
      goal: PARTIAL_VIEW,
    });
    const parsed = parseState(JSON.parse(JSON.stringify(message)));
    expect(parsed).toBeDefined();
    expect(parsed?.goal).toEqual(PARTIAL_VIEW);
    expect(parsed?.hotbar.slots).toHaveLength(HOTBAR_SLOT_COUNT);
  });

  it('keeps the panel in initialization mode when goal data is missing or malformed', () => {
    const base = buildStateMessage({
      revision: 1,
      definitions,
      totals: new Map(),
      slots: emptySlots,
      selected: 0,
    });
    const missing = parseState(JSON.parse(JSON.stringify({ ...base, goal: null })));
    expect(missing?.goal).toBeNull();
    const malformed = parseState(JSON.parse(JSON.stringify({ ...base, goal: { title: 1 } })));
    expect(malformed?.goal).toBeNull();
    // 其它字段仍然可用，不因目标数据异常拖垮背包/快捷栏。
    expect(malformed?.hotbar.slots).toHaveLength(HOTBAR_SLOT_COUNT);
  });

  it('rejects state messages from another protocol version', () => {
    const message = buildStateMessage({
      revision: 1,
      definitions,
      totals: new Map(),
      slots: emptySlots,
      selected: 0,
      goal: INITIAL_VIEW,
    });
    expect(parseState({ ...message, v: 99 })).toBeUndefined();
    expect(parseState({ ...message, type: 'error' })).toBeUndefined();
  });
});
