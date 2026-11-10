import type { Placement } from '../grid/grid.ts';
import type { Connection } from './ports.ts';
import { buildConnections } from './ports.ts';
import type { MechanicalPart } from './parts.ts';

/**
 * 机械逻辑数据唯一所有者：
 * - 只存 part（id/def/placement）与派生连接；
 * - 不存 Entity、不建格占用表；空间占用查询由 pack 用 SpatialIndex 完成；
 * - add/remove/updatePlacement 不增加 topologyRevision；
 * - 只有 pack 完成 Registry/SpatialIndex/Entity/Inventory 事务后调用 commitTopology()。
 */
export class MechanicalRegistry {
  private readonly parts = new Map<number, MechanicalPart>();
  private connectionsCache: readonly Connection[] = [];
  private nextId = 1;
  private committedRevision = 0;

  allocateId(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  /** 下一个可用零件 id（存档必须持久化，否则 sources/接口盒/连接引用会断）。 */
  get nextPartId(): number {
    return this.nextId;
  }

  /** 读档恢复计数器；调用方保证 value >= 已恢复最大 id + 1。 */
  setNextPartId(value: number): void {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(`nextPartId must be a positive integer, received ${String(value)}`);
    }
    this.nextId = value;
  }

  add(part: MechanicalPart): boolean {
    if (this.parts.has(part.id)) return false;
    this.parts.set(part.id, part);
    return true;
  }

  remove(partId: number): MechanicalPart | undefined {
    const part = this.parts.get(partId);
    if (!part) return undefined;
    this.parts.delete(partId);
    return part;
  }

  get(partId: number): MechanicalPart | undefined {
    return this.parts.get(partId);
  }

  all(): readonly MechanicalPart[] {
    return [...this.parts.values()];
  }

  get size(): number {
    return this.parts.size;
  }

  /** 纯数据更新；调用方负责验证与 SpatialIndex 同步。 */
  updatePlacement(partId: number, placement: Placement): boolean {
    const part = this.parts.get(partId);
    if (!part) return false;
    this.parts.set(partId, { ...part, placement });
    return true;
  }

  /** 从当前 part 端口重建连接；不增加 revision。 */
  rebuildConnections(): readonly Connection[] {
    this.connectionsCache = buildConnections(this.all());
    return this.connectionsCache;
  }

  connections(): readonly Connection[] {
    return this.connectionsCache;
  }

  /** 仅在事务完整成功后调用。 */
  commitTopology(): number {
    this.committedRevision += 1;
    return this.committedRevision;
  }

  get revision(): number {
    return this.committedRevision;
  }

  clear(): void {
    this.parts.clear();
    this.connectionsCache = [];
    this.committedRevision = 0;
    this.nextId = 1;
  }
}
