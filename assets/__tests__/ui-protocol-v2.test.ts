import { describe, expect, it } from 'vitest';
import { itemDefinitions } from '../items/items.ts';
import { HOTBAR_SLOT_COUNT } from '../hotbar/hotbar.ts';
import {
  buildStateMessage,
  parseUiCommand,
  UI_PROTOCOL_VERSION,
} from '../game-ui-bridge/protocol.ts';
import { PROTOCOL_VERSION, parseState } from '../frontend/frontend-ui-protocol.ts';
import { parseTechSnapshot, buildTechView } from '../frontend/frontend-tech-view.ts';
import {
  buildDiagnosticsView,
  buildProjectView,
  buildSaveView,
  formatSavedAt,
  parseDiagnosticsSnapshot,
  parseEndgameSnapshot,
  parseSaveSnapshot,
} from '../frontend/frontend-service-view.ts';
import {
  attachSaveTransport,
  forwardSaveCommand,
  isSaveCommand,
  readSaveSnapshot,
  type PersistenceServiceLike,
} from '../game-ui-bridge/save-bridge.ts';
import {
  diagnosticsSignature,
  projectSignature,
  saveSignature,
} from '../game-ui-bridge/panel-signatures.ts';
import { createTechState, techSnapshotOf } from '../tech/state.ts';
import type { EndgameSnapshot } from '../endgame/endgame-types.ts';
import type { DiagnosticsSnapshot } from '../diagnostics/diagnostics-types.ts';
import type { PersistenceSnapshot } from '../save/persistence.pack.ts';

// P2-E2 协议 v2 + 服务快照解析 + 存档桥接转发（用 fake service，不启动引擎）。

const definitions = itemDefinitions();
const emptySlots = new Array(HOTBAR_SLOT_COUNT).fill(null);
const techSnapshot = techSnapshotOf(createTechState('player'));

const ENDGAME: EndgameSnapshot = {
  projectId: 'combined-works',
  completed: false,
  unlocked: true,
  delivery: {
    entries: [
      { itemId: 'shaft', name: '传动轴', required: 6, delivered: 2 },
      { itemId: 'structure_frame', name: '结构框架', required: 3, delivered: 0 },
    ],
    totalRequired: 9,
    totalDelivered: 2,
    complete: false,
  },
  proof: {
    state: 'idle',
    elapsedSeconds: 0,
    durationSeconds: 60,
    produced: 0,
    target: 12,
    conditions: [
      { id: 'assembly', label: '存在至少一个组合机械', ok: false, current: '0', required: '≥1' },
      { id: 'powered', label: '组合内至少 2 台核心有动力', ok: true, current: '2', required: '≥2' },
    ],
    failureReason: null,
  },
  blocks: ['交付未完成：还差 7 件'],
};

const DIAGNOSTICS: DiagnosticsSnapshot = {
  unlocked: true,
  machines: [
    {
      partId: 7,
      coreId: 'core.crusher.7',
      label: '破碎机',
      powered: true,
      running: false,
      block: 'no-input',
      recipeId: 'crush-iron-ore',
      recipeLabel: '破碎铁矿',
      progress: 0.25,
      inputItem: null,
      inputCount: 0,
      outputItem: 'crushed_ore',
      outputCount: 1,
      inputPortFull: false,
      outputPortFull: true,
      blockedLinkId: 'link:1->2',
      conditions: [
        { id: 'power', label: '动力', ok: true, detail: '已接动力' },
        { id: 'input', label: '原料', ok: false, detail: '没有铁矿石' },
      ],
      severity: 'warn',
      message: '破碎机缺少原料',
    },
  ],
  links: [
    {
      id: 'link:1->2',
      fromCoreId: 'core.crusher.7',
      toCoreId: 'core.smelter.8',
      state: 'active',
      transferred: 12,
      blocked: true,
      severity: 'warn',
      message: '下游已满',
    },
  ],
  bottleneck: { kind: 'supply', label: '缺料', detail: '破碎机没有铁矿石' },
  summary: { total: 1, running: 0, idle: 1, blocked: 1, powered: 1 },
  hasError: false,
};

const SAVE: PersistenceSnapshot = {
  status: 'saved',
  savedAt: '2026-11-10T14:05:00.000Z',
  message: null,
  version: 1,
  hasSave: true,
};

describe('ui protocol v2', () => {
  it('keeps both endpoints on the same version', () => {
    expect(UI_PROTOCOL_VERSION).toBe(2);
    expect(PROTOCOL_VERSION).toBe(UI_PROTOCOL_VERSION);
  });

  it('carries tech/project/diagnostics/save snapshots in the state message', () => {
    const message = buildStateMessage({
      revision: 9,
      definitions,
      totals: new Map(),
      slots: emptySlots,
      selected: 0,
      tech: techSnapshot,
      project: ENDGAME,
      diagnostics: DIAGNOSTICS,
      save: SAVE,
    });
    expect(message.v).toBe(2);
    expect(message.tech).toEqual(techSnapshot);
    expect(message.project).toEqual(ENDGAME);
    expect(message.diagnostics).toEqual(DIAGNOSTICS);
    expect(message.save).toEqual(SAVE);
    expect(JSON.parse(JSON.stringify(message))).toEqual(message);
  });

  it('defaults every new field to null when services are not ready', () => {
    const message = buildStateMessage({
      revision: 1,
      definitions,
      totals: new Map(),
      slots: emptySlots,
      selected: 0,
    });
    expect(message.tech ?? null).toBeNull();
    expect(message.project ?? null).toBeNull();
    expect(message.diagnostics ?? null).toBeNull();
    expect(message.save ?? null).toBeNull();
  });

  it('normalizes the endgame command aliases and rejects v1 clients', () => {
    expect(parseUiCommand({ v: 2, type: 'project/proof/begin' })).toEqual({
      ok: true,
      command: { v: 2, type: 'project/proof/begin' },
    });
    expect(parseUiCommand({ v: 2, type: 'project/begin-proof' })).toEqual({
      ok: true,
      command: { v: 2, type: 'project/proof/begin' },
    });
    expect(parseUiCommand({ v: 2, type: 'project/cancel-proof' }).ok).toBe(true);
    expect(parseUiCommand({ v: 1, type: 'state/request' }).ok).toBe(false);
    expect(parseUiCommand({ v: 2, type: 'project/unknown' }).ok).toBe(false);
  });

  it('parses save/data with strict found/data coupling', () => {
    expect(parseUiCommand({ v: 2, type: 'save/data', found: true, data: '{"a":1}' })).toEqual({
      ok: true,
      command: { v: 2, type: 'save/data', found: true, data: '{"a":1}' },
    });
    expect(parseUiCommand({ v: 2, type: 'save/data', found: false })).toEqual({
      ok: true,
      command: { v: 2, type: 'save/data', found: false },
    });
    const missingData = parseUiCommand({ v: 2, type: 'save/data', found: true });
    expect(missingData.ok).toBe(false);
    if (!missingData.ok) expect(missingData.code).toBe('invalid-save-data');
    const badFound = parseUiCommand({ v: 2, type: 'save/data', found: 1 });
    expect(badFound.ok).toBe(false);
  });

  it('round-trips the full v2 state through the frontend parser', () => {
    const message = buildStateMessage({
      revision: 4,
      definitions,
      totals: new Map(),
      slots: emptySlots,
      selected: 0,
      tech: techSnapshot,
      project: ENDGAME,
      diagnostics: DIAGNOSTICS,
      save: SAVE,
    });
    const parsed = parseState(JSON.parse(JSON.stringify(message)));
    expect(parsed).toBeDefined();
    expect(parsed?.tech?.nodes).toHaveLength(12);
    expect(parsed?.project?.projectId).toBe('combined-works');
    expect(parsed?.diagnostics?.machines).toHaveLength(1);
    expect(parsed?.save?.status).toBe('saved');
    expect(parsed?.hotbar.slots).toHaveLength(HOTBAR_SLOT_COUNT);
  });

  it('falls back per field on malformed snapshots instead of dropping the whole state', () => {
    const message = buildStateMessage({
      revision: 5,
      definitions,
      totals: new Map(),
      slots: emptySlots,
      selected: 0,
      tech: techSnapshot,
      project: ENDGAME,
      diagnostics: DIAGNOSTICS,
      save: SAVE,
    });
    const parsed = parseState(JSON.parse(JSON.stringify({
      ...message,
      tech: { nodes: 'nope' },
      project: { projectId: 1 },
      diagnostics: { unlocked: false },
      save: { status: 'unknown' },
    })));
    expect(parsed).toBeDefined();
    expect(parsed?.tech).toBeNull();
    expect(parsed?.project).toBeNull();
    expect(parsed?.diagnostics).toBeNull();
    expect(parsed?.save).toBeNull();
    // 其它字段仍然可用（背包/快捷栏不因服务数据异常而失效）。
    expect(parsed?.hotbar.slots).toHaveLength(HOTBAR_SLOT_COUNT);
  });
});

describe('service snapshot views', () => {
  it('renders the combined-works delivery list and proof conditions', () => {
    const view = buildProjectView(ENDGAME, new Map([['shaft', 4]]));
    expect(view).not.toBeNull();
    expect(view?.deliveryRows.map((row) => [row.itemId, row.required, row.delivered, row.have, row.complete])).toEqual([
      ['shaft', 6, 2, 4, false],
      ['structure_frame', 3, 0, 0, false],
    ]);
    expect(view?.proof.stateLabel).toBe('未开始');
    expect(view?.proof.remainingSeconds).toBe(60);
    expect(view?.proof.conditions).toHaveLength(2);
    // 交付未齐，与服务端 beginProof 的 delivery-incomplete 拒绝条件对齐 → 按钮禁用。
    expect(view?.canBegin).toBe(false);
    expect(view?.canCancel).toBe(false);
    expect(view?.banner).toBeNull();
    expect(view?.blocks).toEqual(['交付未完成：还差 7 件']);
  });

  it('shows the通关 banner and disables proof actions once completed', () => {
    const completed: EndgameSnapshot = {
      ...ENDGAME,
      completed: true,
      delivery: { ...ENDGAME.delivery, complete: true, totalDelivered: 9 },
      proof: { ...ENDGAME.proof, state: 'passed', elapsedSeconds: 60, produced: 12 },
    };
    const view = buildProjectView(completed, new Map());
    expect(view?.banner).toContain('Demo 通关');
    expect(view?.banner).toContain('9/9');
    expect(view?.canBegin).toBe(false);
    expect(view?.canCancel).toBe(false);
  });

  it('allows begin only when unlocked and the delivery is complete', () => {
    const ready: EndgameSnapshot = {
      ...ENDGAME,
      delivery: { ...ENDGAME.delivery, complete: true },
    };
    expect(buildProjectView(ready, new Map())?.canBegin).toBe(true);
    const notUnlocked: EndgameSnapshot = { ...ready, unlocked: false };
    expect(buildProjectView(notUnlocked, new Map())?.canBegin).toBe(false);
  });

  it('allows cancel only while the proof window is running', () => {
    const running: EndgameSnapshot = {
      ...ENDGAME,
      delivery: { ...ENDGAME.delivery, complete: true },
      proof: { ...ENDGAME.proof, state: 'running', elapsedSeconds: 15, produced: 4 },
    };
    const view = buildProjectView(running, new Map());
    expect(view?.canBegin).toBe(false);
    expect(view?.canCancel).toBe(true);
    expect(view?.proof.remainingSeconds).toBe(45);
    expect(view?.proof.progressPercent).toBe(33);
  });

  it('shows the T3.2 locked message when diagnostics are null', () => {
    const locked = buildDiagnosticsView(null);
    expect(locked.locked).toBe(true);
    expect(locked.lockedText).toContain('T3.2');
    expect(locked.machines).toEqual([]);
  });

  it('maps machine/link/bottleneck diagnostics without inventing data', () => {
    const view = buildDiagnosticsView(DIAGNOSTICS);
    expect(view.locked).toBe(false);
    expect(view.summary).toMatchObject({ total: 1, running: 0, idle: 1, blocked: 1, powered: 1 });
    expect(view.machines[0]).toMatchObject({
      partId: 7,
      coreId: 'core.crusher.7',
      powered: true,
      running: false,
      block: 'no-input',
      blockLabel: '缺少原料',
      outputText: '碎铁矿 1',
      inputPortFull: false,
      outputPortFull: true,
      blockedLinkId: 'link:1->2',
      severity: 'warn',
    });
    expect(view.machines[0].conditions.map((condition) => [condition.id, condition.ok, condition.detail])).toEqual([
      ['power', true, '已接动力'],
      ['input', false, '没有铁矿石'],
    ]);
    expect(view.links[0]).toMatchObject({ state: 'active', stateLabel: '传输中', transferred: 12, blocked: true });
    expect(view.bottleneck?.label).toBe('缺料');
  });

  it('parses only well-formed snapshots (defensive null fallbacks)', () => {
    expect(parseEndgameSnapshot(null)).toBeNull();
    expect(parseEndgameSnapshot({ projectId: 'x' })).toBeNull();
    expect(parseEndgameSnapshot(JSON.parse(JSON.stringify(ENDGAME)))?.proof.conditions).toHaveLength(2);
    expect(parseDiagnosticsSnapshot(null)).toBeNull();
    expect(parseDiagnosticsSnapshot({ unlocked: true, machines: [], links: [] })).toBeNull();
    expect(parseDiagnosticsSnapshot(JSON.parse(JSON.stringify(DIAGNOSTICS)))?.summary.total).toBe(1);
    expect(parseSaveSnapshot(null)).toBeNull();
    expect(parseSaveSnapshot({ status: 'bogus' })).toBeNull();
    expect(parseSaveSnapshot(JSON.parse(JSON.stringify(SAVE)))?.hasSave).toBe(true);
  });
});

describe('save status footer view', () => {
  it('formats local HH:MM and每个状态的中文文案', () => {
    expect(formatSavedAt(null)).toBeNull();
    expect(formatSavedAt('not-a-date')).toBeNull();
    expect(formatSavedAt('2026-11-10T14:05:00.000Z')).toMatch(/^\d{2}:\d{2}$/);
    expect(buildSaveView(null).available).toBe(false);
    expect(buildSaveView({ ...SAVE, status: 'busy' }).text).toContain('保存中');
    expect(buildSaveView(SAVE).text).toContain('已保存');
    expect(buildSaveView({ ...SAVE, status: 'restored' }).text).toContain('已读取存档');
    expect(buildSaveView({ ...SAVE, status: 'error', message: '磁盘满' }).text).toContain('保存失败');
    expect(buildSaveView({ status: 'idle', savedAt: null, message: null, version: 0, hasSave: false }).text)
      .toContain('未找到存档');
  });
});

describe('save bridge forwarding', () => {
  function fakeService(): PersistenceServiceLike & {
    calls: string[];
    transport: unknown;
    payload: unknown;
  } {
    const fake = {
      calls: [] as string[],
      transport: undefined as unknown,
      payload: undefined as unknown,
      setTransport(transport: unknown) { fake.transport = transport; },
      snapshot: () => SAVE,
      requestSave() { fake.calls.push('save'); },
      requestRestore() { fake.calls.push('restore'); },
      requestNewGame() { fake.calls.push('new'); },
      onStorageData(payload: unknown) { fake.calls.push('data'); fake.payload = payload; },
    };
    return fake;
  }

  it('attaches the port as the save transport and forwards commands', () => {
    const service = fakeService();
    const posted: unknown[] = [];
    expect(attachSaveTransport(service, (message) => posted.push(message))).toBe(true);
    expect(service.calls).toEqual([]);
    expect(forwardSaveCommand(service, { v: 2, type: 'save/request' })).toEqual({ consumed: true, error: null });
    expect(forwardSaveCommand(service, { v: 2, type: 'save/restore' })).toEqual({ consumed: true, error: null });
    expect(forwardSaveCommand(service, { v: 2, type: 'save/new', confirm: true })).toEqual({ consumed: true, error: null });
    expect(forwardSaveCommand(service, { v: 2, type: 'save/data', found: true, data: '{"x":1}' }))
      .toEqual({ consumed: true, error: null });
    expect(service.calls).toEqual(['save', 'restore', 'new', 'data']);
    expect(service.payload).toEqual({ found: true, data: '{"x":1}' });
    expect(readSaveSnapshot(service)).toEqual(SAVE);
    expect(isSaveCommand({ v: 2, type: 'save/request' })).toBe(true);
    expect(isSaveCommand({ v: 2, type: 'state/request' })).toBe(false);
  });

  it('reports save-unavailable when the service/method is missing', () => {
    expect(attachSaveTransport(null, () => {})).toBe(false);
    expect(attachSaveTransport({}, () => {})).toBe(false);
    const broken: PersistenceServiceLike = { snapshot: () => SAVE };
    const outcome = forwardSaveCommand(broken, { v: 2, type: 'save/request' });
    expect(outcome.consumed).toBe(true);
    expect(outcome.error?.code).toBe('save-unavailable');
    const noData = forwardSaveCommand({ requestSave: () => {} }, { v: 2, type: 'save/data', found: false });
    expect(noData.error?.code).toBe('save-unavailable');
    const none = forwardSaveCommand(null, { v: 2, type: 'save/restore' });
    expect(none.error?.code).toBe('save-unavailable');
  });

  it('reads the snapshot through either snapshot() or status()', () => {
    expect(readSaveSnapshot({ status: () => ({ ...SAVE, status: 'restored' }) })?.status).toBe('restored');
    expect(readSaveSnapshot({ snapshot: () => { throw new Error('boom'); } })).toBeNull();
    expect(readSaveSnapshot(null)).toBeNull();
  });
});

describe('service snapshot signatures', () => {
  it('changes only when the rendered content changes', () => {
    expect(projectSignature(null)).toBe('project:none');
    expect(projectSignature(ENDGAME)).not.toBe(projectSignature({ ...ENDGAME, blocks: ['x'] }));
    expect(projectSignature(ENDGAME)).toBe(projectSignature(JSON.parse(JSON.stringify(ENDGAME))));
    const running: EndgameSnapshot = { ...ENDGAME, proof: { ...ENDGAME.proof, state: 'running', elapsedSeconds: 5 } };
    expect(projectSignature(running)).not.toBe(projectSignature(ENDGAME));

    expect(diagnosticsSignature(null)).toBe('diagnostics:none');
    expect(diagnosticsSignature(DIAGNOSTICS)).not.toBe(diagnosticsSignature({
      ...DIAGNOSTICS,
      summary: { ...DIAGNOSTICS.summary, blocked: 0 },
    }));

    expect(saveSignature(null)).toBe('save:none');
    expect(saveSignature(SAVE)).not.toBe(saveSignature({ ...SAVE, status: 'busy' }));
  });

  it('keeps the tech snapshot parseable after JSON serialization (snapshot field)', () => {
    expect(parseTechSnapshot(JSON.parse(JSON.stringify(techSnapshot)))).not.toBeNull();
    expect(buildTechView(techSnapshot, new Map())?.nodes).toHaveLength(12);
  });
});
