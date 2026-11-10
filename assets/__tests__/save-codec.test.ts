import { describe, expect, it } from 'vitest';
import { decodeSnapshot, encodeSnapshot, migrateSnapshot, emptySnapshot } from '../save/save-codec.ts';
import { SAVE_MAX_CHARS, SAVE_VERSION, type SaveSnapshot } from '../save/save-schema.ts';

/**
 * 正式存档 codec：往返相等、防御性拷贝、未知字段丢弃、非法值钳制、
 * 缺失字段补默认、版本迁移（缺失/旧/未来）、损坏 JSON 不崩溃。
 */

function fixture(): SaveSnapshot {
  return {
    version: SAVE_VERSION,
    savedAt: '2026-11-10T12:00:00.000Z',
    engine: '0.4.19',
    player: { x: -1.5, z: 2.5, level: 1, yaw: 0.5 },
    inventory: {
      stacks: [
        { itemId: 'iron_ore', count: 5 },
        { itemId: 'shaft', count: 2 },
      ],
    },
    hotbar: {
      slots: ['shaft', null, 'crusher', null, null, null, null, null, null, null, null, null],
      selected: 2,
    },
    kitGranted: true,
    counters: { nextBuildingId: 3, nextPartId: 8, nextFloorId: 4 },
    floors: [
      { id: 1, kind: 'pillar', gx: 0, gz: 0, rotation: 0, level: 0 },
      { id: 2, kind: 'deck', gx: 0, gz: 0, rotation: 0, level: 0 },
    ],
    buildings: [{ id: 1, kind: 'shed', gx: 2, gz: 3, rotation: 90, level: 0 }],
    parts: [
      { id: 3, kind: 'shaft', gx: -6, gz: 7, rotation: 0, level: 0 },
      { id: 5, kind: 'crusher', gx: -5, gz: 7, rotation: 90, level: 0 },
    ],
    sources: [{ partId: 6, enabled: true }],
    resources: [{ id: 1, amount: 17, depleted: false }],
    ports: [
      { partId: 5, slotId: 'slot.crusher.in.nz', moduleId: 'port.through', itemId: 'iron_ore', count: 2 },
    ],
    links: [],
    production: {
      machines: [{
        partId: 5,
        recipeId: 'crush-iron-ore',
        progress: 0.25,
        inputItem: 'iron_ore',
        inputCount: 3,
        outputItem: 'crushed_ore',
        outputCount: 1,
        producedTotal: 4,
      }],
      chutes: [],
    },
    tech: {
      version: 1,
      mode: 'player',
      delivered: { 'tech:gear-manufacture': { iron_ingot: 3 } },
      unlocked: [],
      trackedId: null,
    },
    goal: { baseline: { crushedOre: 2, ironIngot: 1, shaft: 0 }, completed: ['gather-ore'] },
  };
}

function decodeOk(raw: string | unknown) {
  const decoded = decodeSnapshot(raw);
  if (!decoded.ok) throw new Error('expected decode ok, got: ' + decoded.reason);
  return decoded;
}

describe('快照往返', () => {
  it('encode -> JSON -> decode 得到相同快照', () => {
    const original = fixture();
    const decoded = decodeOk(encodeSnapshot(original));
    expect(decoded.snapshot).toEqual(original);
    expect(decoded.snapshot.version).toBe(SAVE_VERSION);
    expect(decoded.repaired).toBe(false);
    expect(decoded.issues).toEqual([]);
  });

  it('解码结果与输入对象不共享引用（防御性拷贝）', () => {
    const original = fixture();
    const decoded = decodeOk(original);
    (original.inventory.stacks as unknown as { count: number }[])[0]!.count = 999;
    (original.parts as unknown as { gx: number }[])[0]!.gx = 123;
    (original.tech as { unlocked: string[] }).unlocked.push('hacked');
    expect(decoded.snapshot.inventory.stacks[0]).toEqual({ itemId: 'iron_ore', count: 5 });
    expect(decoded.snapshot.parts[0]!.gx).toBe(-6);
    expect((decoded.snapshot.tech as { unlocked: string[] }).unlocked).toEqual([]);
  });

  it('编码时丢弃未知字段（不会把额外 JSON 写进存档）', () => {
    const original = fixture() as unknown as Record<string, unknown>;
    original.hacked = { secret: true };
    (original.inventory as Record<string, unknown>).hacked = 1;
    const json = encodeSnapshot(original as unknown as SaveSnapshot);
    expect(json).not.toContain('hacked');
    expect(json).not.toContain('secret');
  });
});

describe('未知/非法数据修复', () => {
  it('未知物品/未知系统/未知字段逐条丢弃并记录 issues', () => {
    const raw = {
      ...fixture(),
      inventory: { stacks: [{ itemId: 'stone', count: 3 }, { itemId: 'iron_ore', count: 2 }] },
      parts: [{ id: 1, kind: 'dragon', gx: 0, gz: 0, rotation: 0, level: 0 }],
      mysterySystem: { a: 1 },
    };
    const decoded = decodeOk(raw);
    expect(decoded.repaired).toBe(true);
    expect(decoded.snapshot.inventory.stacks).toEqual([{ itemId: 'iron_ore', count: 2 }]);
    expect(decoded.snapshot.parts).toEqual([]);
    expect(Object.keys(decoded.snapshot)).not.toContain('mysterySystem');
    expect(decoded.issues.join(' ')).toMatch(/unknown item/);
    expect(decoded.issues.join(' ')).toMatch(/unknown kind/);
  });

  it('非法值钳制/丢弃：数量、槽位、坐标、旋转、层数、进度', () => {
    const raw = {
      ...fixture(),
      player: { x: 9999, z: -9999, level: -3, yaw: 'north' },
      inventory: { stacks: [{ itemId: 'iron_ore', count: 999999 }, { itemId: 'shaft', count: -4 }] },
      hotbar: { slots: ['shaft', 'unknown_item', 'shaft'], selected: 99 },
      resources: [{ id: 1, amount: 99999, depleted: false }],
      buildings: [{ id: 1, kind: 'shed', gx: 1, gz: 2, rotation: 45, level: -1 }],
      production: {
        machines: [{ partId: 5, recipeId: null, progress: 3, inputItem: 'iron_ore', inputCount: 999, outputItem: null, outputCount: 2, producedTotal: -1 }],
        chutes: [{ partId: 7, itemId: 'crushed_ore', t: 9, blocked: false, delivered: -1 }],
      },
    };
    const decoded = decodeOk(raw);
    expect(decoded.repaired).toBe(true);
    expect(decoded.snapshot.player.x).toBeLessThanOrEqual(15.5);
    expect(decoded.snapshot.player.level).toBe(0);
    expect(decoded.snapshot.inventory.stacks[0]!.count).toBe(999);
    expect(decoded.snapshot.inventory.stacks).toHaveLength(1);
    expect(decoded.snapshot.hotbar.selected).toBe(11);
    expect(decoded.snapshot.hotbar.slots[1]).toBeNull();
    expect(decoded.snapshot.hotbar.slots[2]).toBeNull();
    expect(decoded.snapshot.resources[0]!.amount).toBe(60);
    expect(decoded.snapshot.buildings[0]!.rotation).toBe(0);
    expect(decoded.snapshot.buildings[0]!.level).toBe(0);
    expect(decoded.snapshot.production.machines[0]!.progress).toBe(1);
    expect(decoded.snapshot.production.machines[0]!.inputCount).toBeLessThanOrEqual(64);
    expect(decoded.snapshot.production.machines[0]!.outputCount).toBeLessThanOrEqual(64);
    expect(decoded.snapshot.production.machines[0]!.producedTotal).toBe(0);
    expect(decoded.snapshot.production.chutes[0]!.t).toBe(1);
    expect(decoded.snapshot.production.chutes[0]!.delivered).toBe(0);
  });

  it('计数器小于已恢复最大 id 时自动抬高（防止读档后 id 冲突）', () => {
    const raw = {
      ...fixture(),
      counters: { nextBuildingId: 1, nextPartId: 1, nextFloorId: 1 },
    };
    const decoded = decodeOk(raw);
    expect(decoded.snapshot.counters.nextPartId).toBeGreaterThan(5);
    expect(decoded.snapshot.counters.nextBuildingId).toBeGreaterThan(1);
    expect(decoded.snapshot.counters.nextFloorId).toBeGreaterThan(2);
  });
});

describe('缺失字段补默认', () => {
  it('只有版号时也用安全默认值，不抛异常', () => {
    const decoded = decodeOk({ version: SAVE_VERSION });
    expect(decoded.repaired).toBe(true);
    expect(decoded.snapshot.inventory.stacks).toEqual([]);
    expect(decoded.snapshot.parts).toEqual([]);
    expect(decoded.snapshot.floors).toEqual([]);
    expect(decoded.snapshot.resources).toEqual([]);
    expect(decoded.snapshot.hotbar.slots).toHaveLength(12);
    expect(decoded.snapshot.counters).toEqual({ nextBuildingId: 1, nextPartId: 1, nextFloorId: 1 });
    expect(decoded.snapshot.player.level).toBe(0);
    expect(decoded.snapshot.savedAt).toBe(new Date(0).toISOString());
  });
});

describe('版本迁移', () => {
  it('缺失版本号按 v0 迁移到当前版本', () => {
    const migrated = migrateSnapshot({ player: { x: 1, z: 2, level: 0, yaw: 0 } });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.fromVersion).toBe(0);
    expect(migrated.data.version).toBe(SAVE_VERSION);
    expect(migrated.issues.join(' ')).toMatch(/version missing/);
  });

  it('v0 存档可解码且补齐字段', () => {
    const decoded = decodeOk({ version: 0, inventory: { stacks: [{ itemId: 'iron_ore', count: 2 }] } });
    expect(decoded.snapshot.inventory.stacks).toEqual([{ itemId: 'iron_ore', count: 2 }]);
    expect(decoded.issues.join(' ')).toMatch(/migrated snapshot v0/);
  });

  it('未来版本被拒绝并给出原因（不破坏当前世界）', () => {
    const result = decodeSnapshot({ version: SAVE_VERSION + 1, player: {} });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/高于当前支持/);
    expect(result.issues.join(' ')).toMatch(/future snapshot version/);
  });
});

describe('损坏数据不崩溃', () => {
  it('非法 JSON 字符串返回失败而不是抛异常', () => {
    const result = decodeSnapshot('{ this is not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/无法解析/);
  });

  it('null / 数组 / 数字 / 超大字符串都安全失败', () => {
    for (const raw of [null, undefined, [], 42, true]) {
      const result = decodeSnapshot(raw);
      expect(result.ok).toBe(false);
    }
    const huge = decodeSnapshot('x'.repeat(SAVE_MAX_CHARS + 1));
    expect(huge.ok).toBe(false);
  });

  it('空快照可编码解码', () => {
    const decoded = decodeOk(encodeSnapshot(emptySnapshot()));
    expect(decoded.snapshot).toEqual(emptySnapshot());
  });
});
