import { describe, expect, it } from 'vitest';
import { ITEM_IDS, IRON_ORE_DEFINITION, itemDefinitions } from '../items/items.ts';
import {
  buildStateMessage,
  collectTotals,
  isSlotIndex,
  parseUiCommand,
  stateSignature,
  UI_PROTOCOL_VERSION,
} from '../game-ui-bridge/protocol.ts';

const IRON = ITEM_IDS.IRON_ORE;

describe('ui command validation', () => {
  it('accepts the supported commands', () => {
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'hello' }).ok).toBe(true);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'state/request' }).ok).toBe(true);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'hotbar/select', slot: 3 })).toEqual({
      ok: true,
      command: { v: UI_PROTOCOL_VERSION, type: 'hotbar/select', slot: 3 },
    });
    // v2 新增命令（P2-E2）：科技页/联合工厂页/存档页脚使用。
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'project/proof/begin' }).ok).toBe(true);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'project/proof/cancel' }).ok).toBe(true);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'save/request' }).ok).toBe(true);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'save/restore' }).ok).toBe(true);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'save/new', confirm: true }).ok).toBe(true);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'save/data', found: false }).ok).toBe(true);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'save/data', found: true, data: '{}' }).ok).toBe(true);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'hotbar/bind', slot: 2, itemId: IRON }).ok).toBe(true);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'hotbar/unbind', slot: 7 }).ok).toBe(true);
  });

  it('rejects malformed messages', () => {
    expect(parseUiCommand(null).ok).toBe(false);
    expect(parseUiCommand('hello').ok).toBe(false);
    expect(parseUiCommand({ v: 99, type: 'hello' }).ok).toBe(false);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'unknown' }).ok).toBe(false);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'hotbar/select', slot: 12 }).ok).toBe(false);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'hotbar/select', slot: -1 }).ok).toBe(false);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'hotbar/select', slot: 1.5 }).ok).toBe(false);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'hotbar/bind', slot: 0, itemId: 'stone' }).ok).toBe(false);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'hotbar/bind', slot: 0 }).ok).toBe(false);
    // v2 新命令的非法参数（协议解析层拒绝，不进入引擎）。
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'save/new' }).ok).toBe(false);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'save/new', confirm: 'yes' }).ok).toBe(false);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'save/data' }).ok).toBe(false);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'save/data', found: true }).ok).toBe(false);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'save/data', found: 'no' }).ok).toBe(false);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'tech/submit', nodeId: '', itemId: IRON, count: 1 }).ok).toBe(false);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'tech/submit', nodeId: 'tech:gear-manufacture', itemId: IRON, count: 0 }).ok).toBe(false);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'tech/track', nodeId: 42 }).ok).toBe(false);
    expect(parseUiCommand({ v: UI_PROTOCOL_VERSION, type: 'project/proof/begin', extra: 1 }).ok).toBe(true);
  });

  it('checks slot indexes', () => {
    expect(isSlotIndex(0)).toBe(true);
    expect(isSlotIndex(7)).toBe(true);
    expect(isSlotIndex(11)).toBe(true);
    expect(isSlotIndex(12)).toBe(false);
    expect(isSlotIndex(1.2)).toBe(false);
    expect(isSlotIndex('1')).toBe(false);
  });
});

describe('ui state serialization', () => {
  const totals = new Map([[IRON, 3]]);

  it('lists only items with a positive inventory total', () => {
    const message = buildStateMessage({
      revision: 4,
      definitions: itemDefinitions(),
      totals,
      slots: [IRON, null, null, null, null, null, null, null],
      selected: 0,
    });
    expect(message.v).toBe(UI_PROTOCOL_VERSION);
    expect(message.type).toBe('state');
    expect(message.revision).toBe(4);
    expect(message.items).toHaveLength(1);
    expect(message.items[0]).toMatchObject({
      id: IRON,
      name: IRON_ORE_DEFINITION.name,
      description: IRON_ORE_DEFINITION.description,
      icon: IRON_ORE_DEFINITION.icon,
      maxStack: 999,
      total: 3,
    });
    expect(message.hotbar.slots).toEqual([IRON, null, null, null, null, null, null, null]);
    expect(message.hotbar.selected).toBe(0);
  });

  it('hides items with zero count', () => {
    const message = buildStateMessage({
      revision: 1,
      definitions: itemDefinitions(),
      totals: new Map(),
      slots: new Array(8).fill(null),
      selected: 0,
    });
    expect(message.items).toEqual([]);
  });

  it('collects totals and builds a stable signature', () => {
    const definitions = itemDefinitions();
    const collected = collectTotals(definitions, () => 5);
    expect(collected.get(IRON)).toBe(5);
    const first = stateSignature(definitions, () => 5, 1);
    const second = stateSignature(definitions, () => 5, 1);
    const third = stateSignature(definitions, () => 6, 1);
    expect(first).toBe(second);
    expect(third).not.toBe(first);
  });
});
