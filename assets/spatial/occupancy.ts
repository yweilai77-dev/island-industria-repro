import { cellsOf, type Cell, type Placement } from '../grid/grid.ts';
import {
  aabbIntersects,
  cellKey3,
  cellsInAabb2D,
  levelsForSpan,
  placementAabb,
  placementBaseY,
  type Aabb,
  type Level,
} from './space.ts';

/**
 * M1.5 三维空间索引（宽相位）。
 * - building 与 structure 共用同一索引；
 * - 索引键为 gx,gz,level，仅用于筛选候选；
 * - 最终是否碰撞由精确三维 AABB 判定。
 */

export type SpatialKind = 'building' | 'structure';

export interface SpatialRecord {
  readonly id: string;
  readonly kind: SpatialKind;
  readonly aabb: Aabb;
  readonly keys: readonly string[];
  readonly buildingId?: number;
  readonly placement?: Placement;
  readonly height?: number;
}

export interface SpatialOverlap {
  readonly id: string;
  readonly kind: SpatialKind;
  readonly buildingId?: number;
  readonly aabb: Aabb;
}

export class SpatialIndex {
  private readonly cells = new Map<string, Set<string>>();
  private readonly records = new Map<string, SpatialRecord>();

  registerBuilding(buildingId: number, placement: Placement, height: number): SpatialRecord {
    const id = buildingRecordId(buildingId);
    if (this.records.has(id)) throw new Error(`building already registered: ${buildingId}`);
    const aabb = placementAabb(placement, height);
    const baseY = placementBaseY(placement);
    return this.registerRecord({
      id,
      kind: 'building',
      aabb,
      keys: this.keysForPlacement(placement, height, baseY),
      buildingId,
      placement,
      height,
    });
  }

  registerStructure(id: string, aabb: Aabb): SpatialRecord {
    const recordId = `structure:${id}`;
    if (this.records.has(recordId)) throw new Error(`structure already registered: ${id}`);
    const height = (aabb.max[1] as number) - (aabb.min[1] as number);
    const baseY = aabb.min[1] as number;
    const keys = this.keysForAabb(aabb, height, baseY);
    return this.registerRecord({ id: recordId, kind: 'structure', aabb, keys });
  }

  unregisterBuilding(buildingId: number): void {
    this.unregisterRecord(buildingRecordId(buildingId));
  }

  unregisterStructure(id: string): void {
    this.unregisterRecord(`structure:${id}`);
  }

  unregister(id: string): void {
    this.unregisterRecord(id);
  }

  clear(): void {
    this.cells.clear();
    this.records.clear();
  }

  get(id: string): SpatialRecord | undefined {
    return this.records.get(id);
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  get size(): number {
    return this.records.size;
  }

  all(): readonly SpatialRecord[] {
    return [...this.records.values()];
  }

  /** 精确三维 AABB 相交查询（宽相位候选 + 窄相位）。 */
  overlapsAabb(aabb: Aabb, excludeBuildingId?: number): SpatialOverlap[] {
    const candidates = this.candidatesForAabb(aabb);
    const result: SpatialOverlap[] = [];
    for (const record of candidates) {
      if (excludeBuildingId !== undefined && record.buildingId === excludeBuildingId) continue;
      if (!aabbIntersects(aabb, record.aabb)) continue;
      result.push({
        id: record.id,
        kind: record.kind,
        buildingId: record.buildingId,
        aabb: record.aabb,
      });
    }
    return result;
  }

  /** 建筑放置候选查询：用 Placement 的 footprint + 高度。 */
  overlapsPlacement(placement: Placement, height: number, excludeBuildingId?: number): SpatialOverlap[] {
    return this.overlapsAabb(placementAabb(placement, height), excludeBuildingId);
  }

  /** 宽相位候选（不保证 AABB 相交），用于测试/调试。 */
  candidatesForAabb(aabb: Aabb): SpatialRecord[] {
    const height = (aabb.max[1] as number) - (aabb.min[1] as number);
    const keys = this.keysForAabb(aabb, height, aabb.min[1] as number);
    return this.candidatesForKeys(keys);
  }

  private registerRecord(record: SpatialRecord): SpatialRecord {
    this.records.set(record.id, record);
    for (const key of record.keys) {
      let ids = this.cells.get(key);
      if (!ids) {
        ids = new Set();
        this.cells.set(key, ids);
      }
      ids.add(record.id);
    }
    return record;
  }

  private unregisterRecord(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    this.records.delete(id);
    for (const key of record.keys) {
      const ids = this.cells.get(key);
      if (!ids) continue;
      ids.delete(id);
      if (ids.size === 0) this.cells.delete(key);
    }
  }

  private candidatesForKeys(keys: readonly string[]): SpatialRecord[] {
    const ids = new Set<string>();
    for (const key of keys) {
      const set = this.cells.get(key);
      if (!set) continue;
      for (const id of set) ids.add(id);
    }
    const result: SpatialRecord[] = [];
    for (const id of ids) {
      const record = this.records.get(id);
      if (record) result.push(record);
    }
    return result;
  }

  private keysForPlacement(placement: Placement, height: number, baseY: number): string[] {
    const levels = levelsForSpan(baseY, height);
    const keys: string[] = [];
    for (const cell of cellsOf(placement)) {
      for (const level of levels) keys.push(cellKey3(cell, level));
    }
    return keys;
  }

  private keysForAabb(aabb: Aabb, height: number, baseY: number): string[] {
    const levels = levelsForSpan(baseY, height);
    const keys: string[] = [];
    for (const cell of cellsInAabb2D(aabb)) {
      for (const level of levels) keys.push(cellKey3(cell, level));
    }
    return keys;
  }

  /** 调试：某三维键上的对象 id。 */
  idsAt(cell: Cell, level: Level): readonly string[] {
    const ids = this.cells.get(cellKey3(cell, level));
    return ids ? [...ids] : [];
  }
}

function buildingRecordId(buildingId: number): string {
  return `building:${buildingId}`;
}
