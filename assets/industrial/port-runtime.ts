import type { ItemId } from '../items/items.ts';
import { portModuleOfId } from './catalog.ts';
import type { PortModuleDef } from './port-module.ts';
import type { PortSlotDef, ProcessingCoreDef } from './processing-core.ts';
import type { PortModuleId, PortSlotId } from './ids.ts';

/**
 * P2-B 接口盒的**运行时状态**（纯逻辑、零引擎依赖、可序列化）。
 *
 * 边界（与 P2-A 的静态定义严格分离）：
 * - 静态定义：`ProcessingCoreDef.portSlots` / `PortModuleDef`（冻结、只读、不存盘）。
 * - 运行时状态（本文件）：哪台机器哪个安装位装了什么盒、盒里还压着多少物料。
 * - 归属：一个 `PortRuntime` 实例由端口插件持有，通过 `ports` 服务暴露只读视图给机械运行时。
 *
 * 三条不变量（测试守着）：
 * 1. 一个安装位最多一个接口盒（重复安装返回 slot-occupied）。
 * 2. 接口盒缓冲是**单物料类型**（与机器输入缓冲同一语义）：不同类型不混装。
 * 3. 物品转移是原子的：先成功插入下游、再从未端扣减；任何失败都不丢物品、不复制物品。
 */

/** 一个已安装的接口盒（含它的运行时缓冲）。 */
export interface InstalledPort {
  readonly partId: number;
  /** 静态安装位定义（同一引用，不复制）。 */
  readonly slot: PortSlotDef;
  /** 静态接口盒定义（同一引用，不复制）。 */
  readonly module: PortModuleDef;
  /** 缓冲里的物料类型；空盒为 null。 */
  itemId: ItemId | null;
  /** 缓冲件数（0..slot.capacity）。 */
  count: number;
}

/** 安装失败原因（供交互层决定是否消耗物品）。 */
export type PortInstallFailure =
  | 'unknown-slot'
  | 'unknown-module'
  | 'slot-occupied'
  | 'module-not-installable'
  | 'module-not-a-real-item';

export interface PortInstallVerdict {
  readonly ok: boolean;
  readonly reason?: PortInstallFailure;
}

/** 拆卸结果：返还的接口盒物品 + 盒里剩余的物料。 */
export interface PortRemoval {
  readonly moduleItemId: ItemId;
  readonly bufferItemId: ItemId | null;
  readonly bufferCount: number;
}

/** 读投影（纯 JSON，给 GameRead 用）。 */
export interface InstalledPortSnapshot {
  readonly partId: number;
  readonly slotId: PortSlotId;
  readonly moduleId: PortModuleId;
  readonly itemId: ItemId | null;
  readonly count: number;
  readonly capacity: number;
}

export class PortRuntime {
  private readonly byPart = new Map<number, Map<PortSlotId, InstalledPort>>();

  /** 该机器上的全部已装接口盒（按安装位 ID 稳定排序）。 */
  installedOf(partId: number): readonly InstalledPort[] {
    const slots = this.byPart.get(partId);
    if (!slots) return [];
    return [...slots.values()].sort((left, right) => left.slot.id.localeCompare(right.slot.id));
  }

  /** 该机器上已装的**输入位**接口盒（自动输入只认输入位）。 */
  inputBoxesOf(partId: number): readonly InstalledPort[] {
    return this.installedOf(partId).filter((port) => port.slot.role === 'input');
  }

  get(partId: number, slotId: PortSlotId): InstalledPort | undefined {
    return this.byPart.get(partId)?.get(slotId);
  }

  /** 该核心上第一个还没装盒的输入安装位（P2-B 的安装目标）。 */
  freeInputSlotOf(core: ProcessingCoreDef, partId: number): PortSlotDef | undefined {
    return core.portSlots.find((slot) => slot.role === 'input' && this.get(partId, slot.id) === undefined);
  }

  /**
   * 安装。只接受「该核心确实有该安装位 + 安装位空闲 + 接口盒能装在该角色 + 接口盒已绑定真实物品」。
   * **不**碰库存：消耗物品由调用方（交互层）在成功后执行，保证不会出现「扣了物品但没装上」。
   */
  install(
    partId: number,
    core: ProcessingCoreDef,
    slotId: PortSlotId,
    moduleId: PortModuleId,
  ): PortInstallVerdict {
    const slot = core.portSlots.find((entry) => entry.id === slotId);
    if (!slot) return { ok: false, reason: 'unknown-slot' };
    const module = portModuleOfId(moduleId);
    if (!module) return { ok: false, reason: 'unknown-module' };
    if (this.get(partId, slotId) !== undefined) return { ok: false, reason: 'slot-occupied' };
    if (!module.fitsSlotRoles.includes(slot.role)) return { ok: false, reason: 'module-not-installable' };
    if (module.itemId === null) return { ok: false, reason: 'module-not-a-real-item' };

    let slots = this.byPart.get(partId);
    if (!slots) {
      slots = new Map<PortSlotId, InstalledPort>();
      this.byPart.set(partId, slots);
    }
    slots.set(slotId, {
      partId,
      slot,
      module,
      itemId: null,
      count: 0,
    });
    return { ok: true };
  }

  /** 拆卸：移除接口盒并把盒里剩下的物料一并交回（永不静默销毁）。 */
  remove(partId: number, slotId: PortSlotId): PortRemoval | undefined {
    const slots = this.byPart.get(partId);
    if (!slots) return undefined;
    const port = slots.get(slotId);
    if (!port || port.module.itemId === null) return undefined;
    slots.delete(slotId);
    if (slots.size === 0) this.byPart.delete(partId);
    return {
      moduleItemId: port.module.itemId,
      bufferItemId: port.itemId,
      bufferCount: port.count,
    };
  }

  /**
   * 往接口盒投料（自动输入的唯一入口）。返回是否接收。
   * 容量满、或缓冲里是另一种物料时拒收 —— 上游必须把物品留在自己那里（不吞、不丢）。
   */
  accept(partId: number, slotId: PortSlotId, itemId: ItemId): boolean {
    const port = this.get(partId, slotId);
    if (!port) return false;
    if (port.count > 0 && port.itemId !== itemId) return false;
    if (port.count >= port.slot.capacity) return false;
    port.itemId = itemId;
    port.count += 1;
    return true;
  }

  /**
   * 把输入接口盒里的物料推进机器输入缓冲。
   * `tryInsert` 返回 true 表示机器真的收了 1 件；只有这一步成功后盒里才扣减，
   * 因此不存在「两端同时拥有」或「转移中消失」。
   * 返回实际转移件数。
   */
  drain(partId: number, tryInsert: (itemId: ItemId) => boolean): number {
    let moved = 0;
    for (const port of this.inputBoxesOf(partId)) {
      while (port.count > 0 && port.itemId !== null) {
        if (!tryInsert(port.itemId)) break;
        port.count -= 1;
        if (port.count === 0) port.itemId = null;
        moved += 1;
      }
    }
    return moved;
  }

  /** 清空某机器的全部接口盒与缓冲，返回需要交回库存的物品（拆机/刷新用）。 */
  flush(partId: number): readonly { readonly itemId: ItemId; readonly count: number }[] {
    const slots = this.byPart.get(partId);
    if (!slots) return [];
    const items: { itemId: ItemId; count: number }[] = [];
    for (const port of [...slots.values()].sort((a, b) => a.slot.id.localeCompare(b.slot.id))) {
      if (port.module.itemId !== null) items.push({ itemId: port.module.itemId, count: 1 });
      if (port.itemId !== null && port.count > 0) items.push({ itemId: port.itemId, count: port.count });
    }
    this.byPart.delete(partId);
    return items;
  }

  /**
   * 与当前世界同步：机器被拆掉时把它的接口盒与缓冲全部交回。
   * 返回 `[{ partId, items }]`，由调用方写入库存（本模块不碰库存服务）。
   */
  sync(alivePartIds: ReadonlySet<number>): readonly {
    readonly partId: number;
    readonly items: readonly { readonly itemId: ItemId; readonly count: number }[];
  }[] {
    const removed: { partId: number; items: readonly { itemId: ItemId; count: number }[] }[] = [];
    for (const partId of [...this.byPart.keys()]) {
      if (alivePartIds.has(partId)) continue;
      const items = this.flush(partId);
      if (items.length > 0) removed.push({ partId, items });
    }
    return removed;
  }

  /** 读投影（纯 JSON）。 */
  snapshot(): readonly InstalledPortSnapshot[] {
    const result: InstalledPortSnapshot[] = [];
    for (const partId of [...this.byPart.keys()].sort((a, b) => a - b)) {
      for (const port of this.installedOf(partId)) {
        result.push({
          partId,
          slotId: port.slot.id,
          moduleId: port.module.id,
          itemId: port.itemId,
          count: port.count,
          capacity: port.slot.capacity,
        });
      }
    }
    return result;
  }

  clear(): void {
    this.byPart.clear();
  }
}
