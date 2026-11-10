import { describe, expect, it } from 'vitest';
import { persistencePlugin, type PersistenceService, type PersistenceSnapshot } from '../save/persistence.pack.ts';
import { decodeSnapshot, emptySnapshot, encodeSnapshot } from '../save/save-codec.ts';

/**
 * persistence 编排层测试（不启动引擎）：用 fake EngineContext 注入最小服务，
 * 验证保存消息、同回合合并、读取回灌、损坏数据保护、新游戏标记。
 * 需要引擎实例的切片恢复（建筑/楼层/机械/接口盒/加工）由真实游戏脚本覆盖。
 */

interface FakePlayer {
  readonly state: {
    readonly position: [number, number, number];
    readonly level: number;
    readonly facingYaw: number;
  };
  restorePosition(raw: unknown): { restored: number; issues: readonly string[] };
}

interface Harness {
  readonly service: PersistenceService;
  readonly messages: { type?: string; data?: string }[];
  readonly calls: string[];
  setTransport(): void;
}

function createHarness(): Harness {
  const messages: { type?: string; data?: string }[] = [];
  const calls: string[] = [];
  const player: FakePlayer = {
    state: { position: [-1.5, 0, 2.5], level: 0, facingYaw: 0 },
    restorePosition: (raw) => {
      calls.push('player');
      return { restored: 1, issues: [] };
    },
  };
  const services: Record<string, unknown> = {
    player,
    inventory: {
      snapshot: () => ({ stacks: [] }),
      restore: () => { calls.push('inventory'); return { restored: 0, issues: [] }; },
    },
    hotbar: {
      snapshot: () => ({ slots: Array.from({ length: 12 }, () => null), selected: 0 }),
      restore: () => { calls.push('hotbar'); return { restored: 0, issues: [] }; },
    },
    resourceNodes: {
      snapshot: () => [],
      restore: () => { calls.push('resources'); return { restored: 0, issues: [] }; },
    },
  };
  const fakeCtx = {
    get: (name: string) => services[name],
    provide: (_name: string, value: unknown) => {
      services.persistence = value;
      return () => {};
    },
  };
  const apply = (persistencePlugin as unknown as { apply: (ctx: unknown) => void }).apply;
  apply.call(persistencePlugin, fakeCtx);
  const service = services.persistence as PersistenceService;
  return {
    service,
    messages,
    calls,
    setTransport: () => service.setTransport({ post: (message: unknown) => { messages.push(message as { type?: string; data?: string }); } }),
  };
};

const flushMicrotasks = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

describe('persistence 保存编排', () => {
  it('transport 注入前 requestSave 挂起，注入后补发一次 save/write', async () => {
    const harness = createHarness();
    harness.service.requestSave();
    expect(harness.messages).toEqual([]);
    harness.setTransport();
    // setTransport 会先兜底自动读档：先收到 save/read。
    expect(harness.messages[0]).toEqual({ type: 'save/read' });
    await flushMicrotasks();
    const write = harness.messages.find((message) => message.type === 'save/write');
    expect(write).toBeDefined();
    const decoded = decodeSnapshot(write!.data);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.snapshot.version).toBe(1);
    const snapshot = harness.service.snapshot();
    expect(snapshot.status).toBe('saved');
    expect(snapshot.hasSave).toBe(true);
    expect(typeof snapshot.savedAt).toBe('string');
  });

  it('同一 JS 回合多次 requestSave 合并成一次写入', async () => {
    const harness = createHarness();
    harness.setTransport();
    const before = harness.messages.filter((message) => message.type === 'save/write').length;
    harness.service.requestSave();
    harness.service.requestSave();
    harness.service.requestSave();
    await flushMicrotasks();
    const writes = harness.messages.filter((message) => message.type === 'save/write');
    expect(writes.length).toBe(before + 1);
    expect(harness.service.snapshot().status).toBe('saved');
  });

  it('新游戏发出 save/clear 并把 hasSave 归 false', () => {
    const harness = createHarness();
    harness.setTransport();
    harness.service.requestNewGame();
    expect(harness.messages.some((message) => message.type === 'save/clear')).toBe(true);
    const snapshot = harness.service.snapshot();
    expect(snapshot.hasSave).toBe(false);
    expect(snapshot.savedAt).toBeNull();
    expect(snapshot.status).toBe('idle');
  });
});

describe('persistence 读取与恢复编排', () => {
  it('没有存档时保持初始世界并返回 ok:false', () => {
    const harness = createHarness();
    harness.setTransport();
    const result = harness.service.onStorageData({ found: false });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('no save data');
    expect(harness.service.snapshot().hasSave).toBe(false);
    expect(harness.calls).toEqual([]);
  });

  it('损坏 JSON 保持世界不变并上报 error', () => {
    const harness = createHarness();
    harness.setTransport();
    const result = harness.service.onStorageData({ found: true, data: '{broken' });
    expect(result.ok).toBe(false);
    expect(harness.service.snapshot().status).toBe('error');
    expect(harness.calls).toEqual([]);
  });

  it('可解析的存档逐切片恢复；缺失服务只记录 issue 不中断', () => {
    const harness = createHarness();
    harness.setTransport();
    const saved = {
      ...emptySnapshot('2026-11-10T01:02:03.000Z'),
      buildings: [{ id: 1, kind: 'shed', gx: 2, gz: 3, rotation: 0 as const, level: 0 }],
      parts: [{ id: 1, kind: 'shaft', gx: 0, gz: 0, rotation: 0 as const, level: 0 }],
      goal: { baseline: { crushedOre: 0, ironIngot: 0, shaft: 0 }, completed: [] },
    };
    const result = harness.service.onStorageData({ found: true, data: encodeSnapshot(saved) });
    expect(result.ok).toBe(true);
    // fake 世界只提供 player/inventory/hotbar/resourceNodes 四个切片。
    expect(harness.calls).toEqual(['player', 'inventory', 'hotbar', 'resources']);
    const snapshot = harness.service.snapshot();
    expect(snapshot.status).toBe('restored');
    expect(snapshot.savedAt).toBe('2026-11-10T01:02:03.000Z');
    expect(snapshot.hasSave).toBe(true);
    // 建筑/机械/接口盒等切片在 fake 世界缺失：只要存档里有内容就必须报 issue。
    expect(result.repaired).toBe(true);
    expect(result.issues.join(' ')).toMatch(/buildings|mechanical|goal/);
  });
});

describe('persistence 状态快照', () => {
  it('初始状态是 idle + version=1 + 无存档', () => {
    const harness = createHarness();
    const snapshot: PersistenceSnapshot = harness.service.snapshot();
    expect(snapshot.status).toBe('idle');
    expect(snapshot.version).toBe(1);
    expect(snapshot.hasSave).toBe(false);
    expect(snapshot.savedAt).toBeNull();
    expect(harness.service.revision()).toBe(0);
  });
});
