import type { ItemId } from '../items/items.ts';
import type { MechanicalPart } from '../mechanical/parts.ts';
import { coreForPart } from './catalog.ts';
import { portInstanceKey, type MaterialLinkId, type PortSlotId } from './ids.ts';
import type { PortModuleDef } from './port-module.ts';
import { slotWorldOf, type SlotWorld } from './port-slot-world.ts';
import { materialLinkBetween, type MaterialLink, type PortEndpoint } from './runtime-model.ts';

/**
 * M2.0-P2-C `MaterialLink` 的运行时（纯逻辑、零引擎依赖、可序列化）。
 *
 * 数据边界：
 * - 连接数据用 P2-A 的 `MaterialLink { id, from, to }`（`from` 必须是输出位、`to` 必须是输入位）；
 * - 本文件只补 P2-C 需要的**传输容量**与**实时状态**（是否可传、为什么不可传）；
 * - 物料**从不进入连接本身**：连接只做「源接口缓冲 → 目标接口缓冲」的 1 件原子转移，
 *   因此拆连接、拆接口、旋转核心时都不会有「在途物料」丢失（料永远停在某个接口盒缓冲里）。
 *
 * 连接合法性（任务书 P2-C-2）：
 * 1) 两端必须是真实存在的加工核心，且各装了对应角色的接口盒；
 * 2) from 必须是输出位、to 必须是输入位、两端不同机器；
 * 3) 空间关系：
 *    - 直通类接口（1 进 1 出）→ 必须**端口对接**：锚点重合、法线相反（相邻核心面对面）；
 *    - 多口接口（分流/合流）→ 允许**近距定向对接**：锚点距离 ≤ 2m，且两端端口都朝向对方
 *      （点积 ≥ 0.5）。原因见 docs/m20/P2-C-DESIGN.md：一个安装位只有唯一世界锚点，
 *      2 个下游/上游端口不可能同时与它锚点重合，所以多口模块用「短距定向」表达扇出/扇入。
 * 4) 连接数量上限由接口盒定义：输出侧 ≤ `module.outputs`，输入侧 ≤ `module.inputs`。
 *
 * 传递规则（任务书 P2-C-3/4/5）：
 * - 每条连接每次物流推进最多 1 件（`MATERIAL_LINK_CAPACITY`）；
 * - 同一个接口每次推进最多参与 1 次转移 → 分流/合流天然按轮询游标公平分配；
 * - 目标满 / 类型不符 / 连接失效 → 不转移，物料留在源接口缓冲（不吞、不丢、不复制）。
 */

/** 每条物料连接每次物流推进最多传递件数。 */
export const MATERIAL_LINK_CAPACITY = 1;
/** 多口模块（分流/合流）的近距定向对接半径（米）。 */
export const MULTI_PORT_LINK_REACH = 2;
/** 端口朝向与连线方向的点积下限（约 60°）。 */
export const LINK_FACING_DOT = 0.5;
const EPS = 1e-4;

/** 连接运行状态：`ok` 才允许传递物料。 */
export type LinkStatus =
  | 'ok'
  | 'inactive-missing-part'
  | 'inactive-missing-port'
  | 'inactive-port-limit'
  | 'inactive-geometry';

/** 建立连接失败的原因（供交互层/测试断言）。 */
export type LinkCreateFailure =
  | 'self-link'
  | 'missing-part'
  | 'not-a-core'
  | 'unknown-slot'
  | 'wrong-role'
  | 'missing-port'
  | 'duplicate-link'
  | 'from-port-full'
  | 'to-port-full'
  | 'not-adjacent'
  | 'out-of-reach'
  | 'wrong-facing';

/** 连接建立所需的最小场景只读视图（插件与测试共用）。 */
export interface LinkScene {
  partOf(partId: number): MechanicalPart | undefined;
  /** 该机器某安装位上装的接口盒定义；没装返回 undefined。 */
  portOf(partId: number, slotId: PortSlotId): { readonly module: PortModuleDef } | undefined;
}

/** 传递所需的接口缓冲访问（由 `PortRuntime` 实现）。 */
export interface LinkBufferAccess {
  bufferOf(
    partId: number,
    slotId: PortSlotId,
  ): { readonly itemId: ItemId | null; readonly count: number } | undefined;
  moveOne(fromPartId: number, fromSlotId: PortSlotId, toPartId: number, toSlotId: PortSlotId): boolean;
}

/** 一条运行中的物料连接。 */
export interface MaterialLinkState {
  readonly link: MaterialLink;
  readonly capacity: number;
}

/** 读档恢复用的一条连接记录（纯 JSON；moved 是累计传递件数）。 */
export interface RestorableMaterialLink {
  readonly id: string;
  readonly from: PortEndpoint;
  readonly to: PortEndpoint;
  readonly moved?: number;
}

/** 读投影（纯 JSON，进唯一 GameRead）。 */
export interface MaterialLinkSnapshot {
  readonly id: MaterialLinkId;
  readonly from: PortEndpoint;
  readonly to: PortEndpoint;
  readonly capacity: number;
  readonly active: boolean;
  readonly status: LinkStatus;
  /** 该连接累计传递件数（读投影用，证明物料真的走过这条连接）。 */
  readonly moved: number;
}

export type LinkCreateResult =
  | { readonly ok: true; readonly link: MaterialLink }
  | { readonly ok: false; readonly reason: LinkCreateFailure };

interface EndpointInfo {
  readonly part: MechanicalPart;
  readonly slotId: PortSlotId;
  readonly role: 'input' | 'output';
  readonly module: PortModuleDef;
  readonly world: SlotWorld;
}

function dotted(a: readonly number[], b: readonly number[]): number {
  return (a[0] as number) * (b[0] as number)
    + (a[1] as number) * (b[1] as number)
    + (a[2] as number) * (b[2] as number);
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot((a[0] as number) - (b[0] as number), (a[1] as number) - (b[1] as number), (a[2] as number) - (b[2] as number));
}

/**
 * 端口几何检查。`allowProximity` 只在任一端是多口模块时为 true。
 * 返回 null 表示合法，否则返回失败原因。
 */
function checkPortGeometry(from: SlotWorld, to: SlotWorld, allowProximity: boolean): LinkCreateFailure | null {
  const gap = distance(from.anchor, to.anchor);
  const opposite = dotted(from.outward, to.outward) <= -1 + EPS;
  if (gap <= EPS) {
    // 锚点重合 = 端口对接：还要求两面正对（法线相反）。
    return opposite ? null : 'wrong-facing';
  }
  if (!allowProximity) return 'not-adjacent';
  if (gap > MULTI_PORT_LINK_REACH + EPS) return 'out-of-reach';
  const dx = ((to.anchor[0] as number) - (from.anchor[0] as number)) / gap;
  const dy = ((to.anchor[1] as number) - (from.anchor[1] as number)) / gap;
  const dz = ((to.anchor[2] as number) - (from.anchor[2] as number)) / gap;
  const towardsTarget = dotted(from.outward, [dx, dy, dz]);
  const towardsSource = dotted(to.outward, [-dx, -dy, -dz]);
  if (towardsTarget < LINK_FACING_DOT || towardsSource < LINK_FACING_DOT) return 'wrong-facing';
  return null;
}

function endpointOf(partId: number, slotId: PortSlotId, scene: LinkScene): EndpointInfo | LinkCreateFailure {
  const part = scene.partOf(partId);
  if (!part) return 'missing-part';
  const core = coreForPart(part.def.id);
  if (!core) return 'not-a-core';
  const slot = core.portSlots.find((entry) => entry.id === slotId);
  if (!slot) return 'unknown-slot';
  const installed = scene.portOf(partId, slotId);
  if (!installed) return 'missing-port';
  if (!installed.module.fitsSlotRoles.includes(slot.role)) return 'missing-port';
  const world = slotWorldOf(part, slot);
  return { part, slotId, role: slot.role, module: installed.module, world };
}

export class MaterialLinkRuntime {
  private readonly byId = new Map<MaterialLinkId, MaterialLinkState>();
  private readonly movedById = new Map<MaterialLinkId, number>();
  /** 每个输出端口自己的轮询游标：保证分流按连接轮流分配。 */
  private readonly fromCursor = new Map<string, number>();
  /** 端口组之间的轮询游标：保证合流时多路上游不会永远抢不到。 */
  private cursor = 0;

  /** 全部连接（按 ID 稳定排序）。 */
  all(): readonly MaterialLinkState[] {
    return [...this.byId.values()].sort((left, right) => left.link.id.localeCompare(right.link.id));
  }

  get(id: MaterialLinkId): MaterialLinkState | undefined {
    return this.byId.get(id);
  }

  countFrom(partId: number, slotId: PortSlotId): number {
    return this.linksFrom(partId, slotId).length;
  }

  countTo(partId: number, slotId: PortSlotId): number {
    return this.linksTo(partId, slotId).length;
  }

  linksFrom(partId: number, slotId: PortSlotId): readonly MaterialLinkState[] {
    return this.all().filter((state) => state.link.from.entityId === partId && state.link.from.slotId === slotId);
  }

  linksTo(partId: number, slotId: PortSlotId): readonly MaterialLinkState[] {
    return this.all().filter((state) => state.link.to.entityId === partId && state.link.to.slotId === slotId);
  }

  /** 某台机器任意端口上的连接（拆机/解链交互用）。 */
  linksOfMachine(partId: number): readonly MaterialLinkState[] {
    return this.all().filter(
      (state) => state.link.from.entityId === partId || state.link.to.entityId === partId,
    );
  }

  /** 建立连接：先完整校验，再写入（失败不产生任何状态变化）。 */
  create(from: PortEndpoint, to: PortEndpoint, scene: LinkScene): LinkCreateResult {
    if (from.entityId === to.entityId) return { ok: false, reason: 'self-link' };
    const fromInfo = endpointOf(from.entityId, from.slotId, scene);
    if (typeof fromInfo === 'string') return { ok: false, reason: fromInfo };
    const toInfo = endpointOf(to.entityId, to.slotId, scene);
    if (typeof toInfo === 'string') return { ok: false, reason: toInfo };
    if (fromInfo.role !== 'output') return { ok: false, reason: 'wrong-role' };
    if (toInfo.role !== 'input') return { ok: false, reason: 'wrong-role' };

    const link = materialLinkBetween(from, to);
    if (this.byId.has(link.id)) return { ok: false, reason: 'duplicate-link' };
    if (this.countFrom(from.entityId, from.slotId) >= fromInfo.module.outputs) {
      return { ok: false, reason: 'from-port-full' };
    }
    if (this.countTo(to.entityId, to.slotId) >= toInfo.module.inputs) {
      return { ok: false, reason: 'to-port-full' };
    }
    const allowProximity = fromInfo.module.outputs > 1 || toInfo.module.inputs > 1;
    const geometry = checkPortGeometry(fromInfo.world, toInfo.world, allowProximity);
    if (geometry !== null) return { ok: false, reason: geometry };

    this.byId.set(link.id, { link, capacity: MATERIAL_LINK_CAPACITY });
    return { ok: true, link };
  }

  remove(id: MaterialLinkId): boolean {
    this.movedById.delete(id);
    return this.byId.delete(id);
  }

  /** 解开某端口上的全部连接；返回解除条数。 */
  removeAt(partId: number, slotId: PortSlotId): number {
    let removed = 0;
    for (const state of [...this.byId.values()]) {
      const touches = (state.link.from.entityId === partId && state.link.from.slotId === slotId)
        || (state.link.to.entityId === partId && state.link.to.slotId === slotId);
      if (!touches) continue;
      this.byId.delete(state.link.id);
      this.movedById.delete(state.link.id);
      removed += 1;
    }
    return removed;
  }

  /**
   * 清理整机已消失的连接（拆机时调用）。接口盒拆卸**不**删连接：
   * 连接保留为失效状态，重新装回同角色接口盒后会自动恢复（任务书 P2-C-7「重连恢复」）。
   */
  sync(alivePartIds: ReadonlySet<number>): number {
    let removed = 0;
    for (const state of [...this.byId.values()]) {
      if (alivePartIds.has(state.link.from.entityId) && alivePartIds.has(state.link.to.entityId)) continue;
      this.byId.delete(state.link.id);
      this.movedById.delete(state.link.id);
      removed += 1;
    }
    return removed;
  }

  /**
   * 读档恢复连接：只校验两端零件/安装位/方向（几何状态由 statusOf 在运行时重算），
   * 不重复执行建链时的空间检查——存档世界在保存时已经合法，且读档时几何已由零件位置重建。
   */
  restore(
    entries: readonly RestorableMaterialLink[],
    scene: LinkScene,
  ): { readonly restored: number; readonly issues: readonly string[] } {
    const issues: string[] = [];
    let restored = 0;
    for (const entry of entries) {
      if (entry.from.entityId === entry.to.entityId) {
        issues.push('link restore skipped: self link ' + entry.id);
        continue;
      }
      const fromInfo = endpointOf(entry.from.entityId, entry.from.slotId, scene);
      if (typeof fromInfo === 'string') {
        issues.push('link restore skipped: ' + entry.id + ' (' + fromInfo + ')');
        continue;
      }
      const toInfo = endpointOf(entry.to.entityId, entry.to.slotId, scene);
      if (typeof toInfo === 'string') {
        issues.push('link restore skipped: ' + entry.id + ' (' + toInfo + ')');
        continue;
      }
      if (fromInfo.role !== 'output' || toInfo.role !== 'input') {
        issues.push('link restore skipped: wrong role ' + entry.id);
        continue;
      }
      const link = materialLinkBetween(entry.from, entry.to);
      if (this.byId.has(link.id)) {
        issues.push('link restore skipped: duplicate ' + link.id);
        continue;
      }
      this.byId.set(link.id, { link, capacity: MATERIAL_LINK_CAPACITY });
      const moved = typeof entry.moved === 'number' && Number.isFinite(entry.moved)
        ? Math.max(0, Math.floor(entry.moved))
        : 0;
      if (moved > 0) this.movedById.set(link.id, moved);
      restored += 1;
    }
    return { restored, issues };
  }

  /** 连接当前是否可传递（两端存在、接口盒在位、数量不超限、几何仍然成立）。 */
  statusOf(state: MaterialLinkState, scene: LinkScene): LinkStatus {
    const fromInfo = endpointOf(state.link.from.entityId, state.link.from.slotId, scene);
    if (fromInfo === 'missing-part') return 'inactive-missing-part';
    if (typeof fromInfo === 'string') return 'inactive-missing-port';
    const toInfo = endpointOf(state.link.to.entityId, state.link.to.slotId, scene);
    if (toInfo === 'missing-part') return 'inactive-missing-part';
    if (typeof toInfo === 'string') return 'inactive-missing-port';
    if (fromInfo.role !== 'output' || toInfo.role !== 'input') return 'inactive-missing-port';
    if (this.countFrom(state.link.from.entityId, state.link.from.slotId) > fromInfo.module.outputs) {
      return 'inactive-port-limit';
    }
    if (this.countTo(state.link.to.entityId, state.link.to.slotId) > toInfo.module.inputs) {
      return 'inactive-port-limit';
    }
    const allowProximity = fromInfo.module.outputs > 1 || toInfo.module.inputs > 1;
    if (checkPortGeometry(fromInfo.world, toInfo.world, allowProximity) !== null) return 'inactive-geometry';
    return 'ok';
  }

  /** 推进一次物流：每条连接最多 1 件，同一接口每步最多参与 1 次转移（轮询公平）。 */
  step(scene: LinkScene, access: LinkBufferAccess): number {
    const ordered = this.all();
    if (ordered.length === 0) return 0;

    // 按「源接口」分组，组内按各自游标轮转 → 分流的两路按**成功件数**严格交替。
    // 注意：游标只在成功转移后前进，不能按帧前进 —— 否则物料到达的帧与游标步调无关，
    // 连续几件会全部落到同一路（真实游戏里曾复现 3/1 的偏斜）。
    const groups = new Map<string, MaterialLinkState[]>();
    for (const state of ordered) {
      const key = portInstanceKey(state.link.from.entityId, state.link.from.slotId);
      const list = groups.get(key);
      if (list) list.push(state); else groups.set(key, [state]);
    }
    const groupKeys = [...groups.keys()].sort();
    const rotated: { state: MaterialLinkState; groupKey: string; index: number }[] = [];
    for (let index = 0; index < groupKeys.length; index += 1) {
      const key = groupKeys[(this.cursor + index) % groupKeys.length] as string;
      const list = groups.get(key) as MaterialLinkState[];
      const start = (this.fromCursor.get(key) ?? 0) % list.length;
      for (let offset = 0; offset < list.length; offset += 1) {
        const position = (start + offset) % list.length;
        rotated.push({ state: list[position] as MaterialLinkState, groupKey: key, index: position });
      }
    }
    this.cursor = (this.cursor + 1) % groupKeys.length;

    // 同一接口每步最多参与 1 次转移 → 分流不会一次抽干源缓冲，合流不会重复写目标。
    const busy = new Set<string>();
    let moved = 0;
    for (const entry of rotated) {
      const state = entry.state;
      const fromKey = portInstanceKey(state.link.from.entityId, state.link.from.slotId);
      const toKey = portInstanceKey(state.link.to.entityId, state.link.to.slotId);
      if (busy.has(fromKey) || busy.has(toKey)) continue;
      if (this.statusOf(state, scene) !== 'ok') continue;
      const transferred = state.capacity > 0
        && access.moveOne(
          state.link.from.entityId,
          state.link.from.slotId,
          state.link.to.entityId,
          state.link.to.slotId,
        );
      if (!transferred) continue;
      busy.add(fromKey);
      busy.add(toKey);
      moved += 1;
      this.movedById.set(state.link.id, (this.movedById.get(state.link.id) ?? 0) + 1);
      // 只有真的送出一件，才把该源接口的「下一个优先连接」前移。
      const list = groups.get(entry.groupKey) as MaterialLinkState[];
      this.fromCursor.set(entry.groupKey, (entry.index + 1) % list.length);
    }
    return moved;
  }

  snapshot(scene: LinkScene): readonly MaterialLinkSnapshot[] {
    return this.all().map((state) => {
      const status = this.statusOf(state, scene);
      return {
        id: state.link.id,
        from: { entityId: state.link.from.entityId, slotId: state.link.from.slotId },
        to: { entityId: state.link.to.entityId, slotId: state.link.to.slotId },
        capacity: state.capacity,
        active: status === 'ok',
        status,
        moved: this.movedById.get(state.link.id) ?? 0,
      };
    });
  }

  clear(): void {
    this.byId.clear();
    this.movedById.clear();
    this.fromCursor.clear();
    this.cursor = 0;
  }
}
