/**
 * M2.0-P2-E3 正式存档 v1：编码/解码与版本迁移（纯函数、可单测）。
 *
 * 不变量：
 * - 解码永不抛异常：损坏 JSON / 非对象 / 未来版本都返回 ok:false + 人话原因，
 *   调用方据此保持当前世界不变；
 * - 未知字段/未知系统一律丢弃（按 save-schema.ts 的显式字段表重建）；
 * - 每个切片独立修复，任一切片损坏不拖垮其它切片（逐条 issues）；
 * - 迁移只在版本低于当前时发生；未来版本拒绝读取，避免把新存档写坏。
 */
import {
  SAVE_MAX_CHARS,
  SAVE_VERSION,
  normalizeBuildingsSlice,
  normalizeCounters,
  normalizeEngine,
  normalizeFloorsSlice,
  normalizeGoalSlice,
  normalizeHotbarSlice,
  normalizeInventorySlice,
  normalizeKitGranted,
  normalizeLinksSlice,
  normalizePartsSlice,
  normalizePlayerSlice,
  normalizePortsSlice,
  normalizeProductionSlice,
  normalizeResourceSlice,
  normalizeSavedAt,
  normalizeSourcesSlice,
  normalizeTechSlice,
  type SaveSnapshot,
} from './save-schema.ts';

export interface SnapshotDecodeSuccess {
  readonly ok: true;
  readonly snapshot: SaveSnapshot;
  readonly repaired: boolean;
  readonly issues: readonly string[];
}

export interface SnapshotDecodeFailure {
  readonly ok: false;
  readonly reason: string;
  readonly issues: readonly string[];
}

export type SnapshotDecodeResult = SnapshotDecodeSuccess | SnapshotDecodeFailure;

type PlainRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 当前版本之前的迁移函数：键 = 源版本，值 = 源版本数据 → 下一版数据。
 * v0（无版本号/雏形数据）→ v1 只补版本号；所有缺失字段由各切片规整函数补默认，
 * 因此迁移函数本身保持无状态、可重复执行（幂等）。
 */
const MIGRATIONS: Readonly<Record<number, (source: PlainRecord) => PlainRecord>> = Object.freeze({
  0: (source) => ({ ...source, version: 1 }),
});

export interface MigrationResult {
  readonly ok: true;
  /** 迁移后的数据（version 已是 SAVE_VERSION）。 */
  readonly data: PlainRecord;
  /** 源版本号（缺失按 0 计）。 */
  readonly fromVersion: number;
  readonly issues: readonly string[];
}

export interface MigrationFailure {
  readonly ok: false;
  readonly reason: string;
  readonly issues: readonly string[];
}

/**
 * 版本迁移入口（导出供测试与未来迁移复用）。
 * - version 缺失/非整数/负数 → 按 v0 处理；
 * - version === SAVE_VERSION → 原样通过；
 * - version > SAVE_VERSION → 拒绝（不破坏当前世界）。
 */
export function migrateSnapshot(raw: unknown): MigrationResult | MigrationFailure {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: '存档数据不是 JSON 对象', issues: ['snapshot is not a JSON object'] };
  }
  const rawVersion = raw.version;
  let fromVersion: number;
  const issues: string[] = [];
  if (rawVersion === undefined) {
    fromVersion = 0;
    issues.push('snapshot version missing; treated as v0');
  } else if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion) || rawVersion < 0) {
    fromVersion = 0;
    issues.push('snapshot version invalid (' + String(rawVersion) + '); treated as v0');
  } else {
    fromVersion = rawVersion;
  }
  if (fromVersion > SAVE_VERSION) {
    return {
      ok: false,
      reason: '存档版本 ' + fromVersion + ' 高于当前支持的 v' + SAVE_VERSION + '，已拒绝读取以保护当前世界',
      issues: ['future snapshot version rejected: ' + fromVersion],
    };
  }
  let data: PlainRecord = { ...raw };
  for (let version = fromVersion; version < SAVE_VERSION; version += 1) {
    const migrate = MIGRATIONS[version];
    if (migrate === undefined) {
      return {
        ok: false,
        reason: '缺少 v' + version + ' 到 v' + (version + 1) + ' 的迁移函数',
        issues: ['migration missing for version ' + version],
      };
    }
    try {
      data = migrate(data);
    } catch (error) {
      return {
        ok: false,
        reason: '存档迁移失败：' + (error instanceof Error ? error.message : String(error)),
        issues: ['migration threw at version ' + version],
      };
    }
    issues.push('migrated snapshot v' + version + ' -> v' + (version + 1));
  }
  data = { ...data, version: SAVE_VERSION };
  return { ok: true, data, fromVersion, issues };
}

/** 把快照编码成纯 JSON 字符串（显式字段拷贝 = 防御性拷贝 + 未知字段绝不泄漏）。 */
export function encodeSnapshot(snapshot: SaveSnapshot): string {
  const plain = {
    version: SAVE_VERSION,
    savedAt: snapshot.savedAt,
    engine: snapshot.engine,
    player: {
      x: snapshot.player.x,
      z: snapshot.player.z,
      level: snapshot.player.level,
      yaw: snapshot.player.yaw,
    },
    inventory: {
      stacks: snapshot.inventory.stacks.map((stack) => ({ itemId: stack.itemId, count: stack.count })),
    },
    hotbar: {
      slots: snapshot.hotbar.slots.map((slot) => slot),
      selected: snapshot.hotbar.selected,
    },
    kitGranted: snapshot.kitGranted,
    counters: {
      nextBuildingId: snapshot.counters.nextBuildingId,
      nextPartId: snapshot.counters.nextPartId,
      nextFloorId: snapshot.counters.nextFloorId,
    },
    floors: snapshot.floors.map((record) => ({ ...record })),
    buildings: snapshot.buildings.map((record) => ({ ...record })),
    parts: snapshot.parts.map((record) => ({ ...record })),
    sources: snapshot.sources.map((record) => ({ ...record })),
    resources: snapshot.resources.map((record) => ({ ...record })),
    ports: snapshot.ports.map((record) => ({ ...record })),
    links: snapshot.links.map((record) => ({
      id: record.id,
      from: { entityId: record.from.entityId, slotId: record.from.slotId },
      to: { entityId: record.to.entityId, slotId: record.to.slotId },
      moved: record.moved,
    })),
    production: {
      machines: snapshot.production.machines.map((record) => ({ ...record })),
      chutes: snapshot.production.chutes.map((record) => ({ ...record })),
    },
    ...(snapshot.tech === undefined ? {} : { tech: snapshot.tech }),
    ...(snapshot.goal === undefined
      ? {}
      : { goal: { baseline: { ...snapshot.goal.baseline }, completed: [...snapshot.goal.completed] } }),
  };
  try {
    return JSON.stringify(plain);
  } catch (error) {
    throw new Error('save snapshot is not JSON serializable: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * 解码入口：
 * - raw 允许是 JSON 字符串（存储通道原样返回）或已解析对象（测试/未来通道）；
 * - 任何损坏都返回 ok:false，绝不抛异常；
 * - 逐切片修复，issues 逐条列出，repaired = issues.length > 0。
 */
export function decodeSnapshot(raw: unknown): SnapshotDecodeResult {
  try {
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      if (raw.length > SAVE_MAX_CHARS) {
        return { ok: false, reason: '存档数据超过 ' + SAVE_MAX_CHARS + ' 字符上限', issues: ['snapshot too large'] };
      }
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch (error) {
        return {
          ok: false,
          reason: '存档 JSON 无法解析：' + (error instanceof Error ? error.message : String(error)),
          issues: ['invalid snapshot JSON'],
        };
      }
    } else if (typeof raw === 'object' && raw !== null) {
      // 直接传对象时也做体积守卫，避免测试/未来通道绕过字符串分支。
      try {
        if (JSON.stringify(raw).length > SAVE_MAX_CHARS) {
          return { ok: false, reason: '存档数据超过 ' + SAVE_MAX_CHARS + ' 字符上限', issues: ['snapshot too large'] };
        }
      } catch {
        return { ok: false, reason: '存档数据不是可序列化的 JSON', issues: ['snapshot is not serializable'] };
      }
    }
    if (!isPlainObject(parsed)) {
      return { ok: false, reason: '存档数据不是 JSON 对象', issues: ['snapshot is not a JSON object'] };
    }
    const migrated = migrateSnapshot(parsed);
    if (!migrated.ok) return { ok: false, reason: migrated.reason, issues: migrated.issues };
    const data = migrated.data;

    const issues: string[] = [...migrated.issues];
    const collect = <T>(result: { readonly value: T; readonly issues: readonly string[] }): T => {
      issues.push(...result.issues);
      return result.value;
    };

    const player = collect(normalizePlayerSlice(data.player));
    const inventory = collect(normalizeInventorySlice(data.inventory));
    const hotbar = collect(normalizeHotbarSlice(data.hotbar));
    const kitGranted = collect(normalizeKitGranted(data.kitGranted));
    const counters = collect(normalizeCounters(data.counters));
    const floors = collect(normalizeFloorsSlice(data.floors, counters.nextFloorId));
    const buildings = collect(normalizeBuildingsSlice(data.buildings, counters.nextBuildingId));
    const parts = collect(normalizePartsSlice(data.parts, counters.nextPartId));
    const sources = collect(normalizeSourcesSlice(data.sources));
    const resources = collect(normalizeResourceSlice(data.resources));
    const ports = collect(normalizePortsSlice(data.ports));
    const links = collect(normalizeLinksSlice(data.links));
    const production = collect(normalizeProductionSlice(data.production));
    const tech = collect(normalizeTechSlice(data.tech));
    const goal = collect(normalizeGoalSlice(data.goal));
    const savedAt = collect(normalizeSavedAt(data.savedAt));
    const engine = collect(normalizeEngine(data.engine));

    // 计数器必须大于等于已恢复实体的最大 id + 1，否则读档后新建实体可能撞 id。
    const maxId = (records: readonly { readonly id: number }[]): number =>
      records.reduce((max, record) => Math.max(max, record.id), 0);
    const nextBuildingId = Math.max(buildings.nextBuildingId, maxId(buildings.buildings) + 1);
    const nextPartId = Math.max(parts.nextPartId, maxId(parts.parts) + 1);
    const nextFloorId = Math.max(floors.nextFloorId, maxId(floors.floors) + 1);
    if (nextBuildingId !== counters.nextBuildingId) issues.push('nextBuildingId raised above restored building ids');
    if (nextPartId !== counters.nextPartId) issues.push('nextPartId raised above restored part ids');
    if (nextFloorId !== counters.nextFloorId) issues.push('nextFloorId raised above restored floor ids');

    const snapshot: SaveSnapshot = {
      version: SAVE_VERSION,
      savedAt,
      engine,
      player,
      inventory,
      hotbar,
      kitGranted,
      counters: { nextBuildingId, nextPartId, nextFloorId },
      floors: floors.floors,
      buildings: buildings.buildings,
      parts: parts.parts,
      sources,
      resources,
      ports,
      links,
      production,
      ...(tech === undefined ? {} : { tech }),
      ...(goal === undefined ? {} : { goal }),
    };
    return { ok: true, snapshot, repaired: issues.length > 0, issues };
  } catch (error) {
    return {
      ok: false,
      reason: '存档解码异常：' + (error instanceof Error ? error.message : String(error)),
      issues: ['decode threw'],
    };
  }
}

/** 空快照（新世界/单测基线；不写存档，仅用于构造与比较）。 */
export function emptySnapshot(now: string = new Date(0).toISOString()): SaveSnapshot {
  return {
    version: SAVE_VERSION,
    savedAt: now,
    engine: '0.4.19',
    player: { x: -1.5, z: 2.5, level: 0, yaw: 0 },
    inventory: { stacks: [] },
    hotbar: { slots: Array.from({ length: 12 }, () => null), selected: 0 },
    kitGranted: false,
    counters: { nextBuildingId: 1, nextPartId: 1, nextFloorId: 1 },
    floors: [],
    buildings: [],
    parts: [],
    sources: [],
    resources: [],
    ports: [],
    links: [],
    production: { machines: [], chutes: [] },
  };
}
