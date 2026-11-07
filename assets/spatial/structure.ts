import type { SpatialIndex } from './occupancy.ts';
import type { Aabb } from './space.ts';

/**
 * 固定结构碰撞体：薄封装，委托现有 SpatialIndex。
 * - blocksBuild=true 的记录进入 SpatialIndex，参与建筑放置的 3D AABB 判定；
 * - blocksPlayer 只保存，当前 M1.5-B 没有玩家实体碰撞消费者。
 */
export interface StructureCollider {
  readonly id: string;
  readonly aabb: Aabb;
  readonly blocksBuild: boolean;
  readonly blocksPlayer: boolean;
}

export class StructureRegistry {
  private readonly byId = new Map<string, StructureCollider>();

  constructor(private readonly index: SpatialIndex) {}

  register(collider: StructureCollider): void {
    if (this.byId.has(collider.id)) throw new Error(`duplicate structure collider: ${collider.id}`);
    this.byId.set(collider.id, collider);
    if (collider.blocksBuild) this.index.registerStructure(collider.id, collider.aabb);
  }

  unregister(id: string): void {
    const collider = this.byId.get(id);
    if (!collider) return;
    this.byId.delete(id);
    if (collider.blocksBuild) this.index.unregisterStructure(id);
  }

  get(id: string): StructureCollider | undefined {
    return this.byId.get(id);
  }

  all(): readonly StructureCollider[] {
    return [...this.byId.values()];
  }

  clear(): void {
    for (const collider of this.byId.values()) {
      if (collider.blocksBuild) this.index.unregisterStructure(collider.id);
    }
    this.byId.clear();
  }

  get size(): number {
    return this.byId.size;
  }
}
