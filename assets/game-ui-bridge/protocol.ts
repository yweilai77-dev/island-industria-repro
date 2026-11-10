import {
  getItemDefinition,
  itemDefinitions,
  type ItemDefinition,
  type ItemId,
} from '../items/items.ts';
import { HOTBAR_SLOT_COUNT, type HotbarSlot } from '../hotbar/hotbar.ts';
import type { UiGoalState } from './goal-view.ts';
import type { TechSnapshot } from '../tech/types.ts';
import type { EndgameSnapshot } from '../endgame/endgame-types.ts';
import type { DiagnosticsSnapshot } from '../diagnostics/diagnostics-types.ts';
import type { PersistenceSnapshot } from '../save/persistence.pack.ts';

/**
 * 前端与 Engine 之间的 UI 协议版本。
 *
 * v2（P2-E2）：状态消息新增 `tech`（E1 已存在，v2 起正式渲染）/ `project` / `diagnostics` /
 * `save` 四个可选只读快照；新增 `project/proof/*` 与 `save/*` 命令。
 * v1 的状态形状是 v2 的子集（四个字段缺省为 null），但版本号不匹配仍拒绝——
 * 双端同版本发布，仓库内所有调用点都使用本常量，不手写版本号。
 */
export const UI_PROTOCOL_VERSION = 2;

export interface CatalogItem {
  readonly id: ItemId;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly maxStack: number;
  /** 库存中的总数（不暴露 999 堆叠结构）。 */
  readonly total: number;
}

export interface UiStateMessage {
  readonly v: typeof UI_PROTOCOL_VERSION;
  readonly type: 'state';
  readonly revision: number;
  readonly items: readonly CatalogItem[];
  readonly hotbar: {
    readonly slots: readonly HotbarSlot[];
    readonly selected: number;
  };
  /** 第一份工业订单的 HUD 数据；机械运行时尚未就绪时为 null。 */
  readonly goal: UiGoalState | null;
  /** P2-E1：科技树只读快照（E2 的正式科技页使用；E1 先随状态一起下发）。 */
  readonly tech?: TechSnapshot | null;
  /** P2-E2/E3：终局联合工厂只读快照（交付进度 + 运行证明）；服务未就绪为 null。 */
  readonly project?: EndgameSnapshot | null;
  /** P2-E2/E3：生产线诊断只读快照（未解锁 T3.2 或服务未就绪为 null）。 */
  readonly diagnostics?: DiagnosticsSnapshot | null;
  /** P2-E2：正式存档只读快照；存档服务未就绪为 null。 */
  readonly save?: PersistenceSnapshot | null;
}

/** 测试/启动标志：由前端页面全局 `__II_TEST_FLAGS__` 提供（只用于验收脚本）。 */
export interface UiHelloFlags {
  /** 'legacy' = 旧 M1/P2 验收脚本的兼容模式（历史原型套件 + 关闭科技门控）。 */
  readonly progression?: 'player' | 'legacy';
  /** 是否允许前端暴露 E1 测试入口（__II_TEST_TECH__）。 */
  readonly techHooks?: boolean;
}

export interface UiErrorMessage {
  readonly v: typeof UI_PROTOCOL_VERSION;
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
}

export type UiCommand =
  | { readonly v: typeof UI_PROTOCOL_VERSION; readonly type: 'hello'; readonly flags?: UiHelloFlags }
  | { readonly v: typeof UI_PROTOCOL_VERSION; readonly type: 'state/request' }
  | { readonly v: typeof UI_PROTOCOL_VERSION; readonly type: 'hotbar/select'; readonly slot: number }
  | { readonly v: typeof UI_PROTOCOL_VERSION; readonly type: 'hotbar/bind'; readonly slot: number; readonly itemId: ItemId }
  | { readonly v: typeof UI_PROTOCOL_VERSION; readonly type: 'hotbar/unbind'; readonly slot: number }
  // P2-E1：科技交付/追踪命令。E1 只有测试入口调用；E2 的科技页复用同一协议。
  | { readonly v: typeof UI_PROTOCOL_VERSION; readonly type: 'tech/submit'; readonly nodeId: string; readonly itemId: string; readonly count: number }
  | { readonly v: typeof UI_PROTOCOL_VERSION; readonly type: 'tech/submit-all'; readonly nodeId: string }
  | { readonly v: typeof UI_PROTOCOL_VERSION; readonly type: 'tech/track'; readonly nodeId: string | null }
  // P2-E2/E3：终局运行证明（调用 endgame 服务；服务缺失由桥接层回 error）。
  | { readonly v: typeof UI_PROTOCOL_VERSION; readonly type: 'project/proof/begin' }
  | { readonly v: typeof UI_PROTOCOL_VERSION; readonly type: 'project/proof/cancel' }
  // P2-E2：正式存档通道命令（save/new 是破坏性操作，必须显式 confirm）。
  | { readonly v: typeof UI_PROTOCOL_VERSION; readonly type: 'save/request' }
  | { readonly v: typeof UI_PROTOCOL_VERSION; readonly type: 'save/restore' }
  | { readonly v: typeof UI_PROTOCOL_VERSION; readonly type: 'save/new'; readonly confirm: true }
  | { readonly v: typeof UI_PROTOCOL_VERSION; readonly type: 'save/data'; readonly found: boolean; readonly data?: string };

export type ParseCommandResult =
  | { readonly ok: true; readonly command: UiCommand }
  | { readonly ok: false; readonly code: string; readonly message: string };

export function isSlotIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < HOTBAR_SLOT_COUNT;
}

function fail(code: string, message: string): ParseCommandResult {
  return { ok: false, code, message };
}

/** 校验并解析前端命令；未知命令/非法参数一律拒绝。 */
export function parseUiCommand(raw: unknown): ParseCommandResult {
  if (typeof raw !== 'object' || raw === null) return fail('invalid-message', 'message must be an object');
  const data = raw as Record<string, unknown>;
  if (data.v !== UI_PROTOCOL_VERSION) return fail('unsupported-version', `unsupported protocol version: ${String(data.v)}`);
  if (typeof data.type !== 'string') return fail('invalid-message', 'missing message type');
  switch (data.type) {
    case 'hello': {
      const flags = parseHelloFlags(data.flags);
      if (flags === undefined) return fail('invalid-flags', 'flags must be an object with known fields');
      return { ok: true, command: { v: UI_PROTOCOL_VERSION, type: 'hello', ...(flags === null ? {} : { flags }) } };
    }
    case 'state/request':
      return { ok: true, command: { v: UI_PROTOCOL_VERSION, type: 'state/request' } };
    case 'tech/submit': {
      if (typeof data.nodeId !== 'string' || data.nodeId.length === 0) return fail('invalid-node', 'nodeId must be a non-empty string');
      if (typeof data.itemId !== 'string' || data.itemId.length === 0) return fail('invalid-item', 'itemId must be a non-empty string');
      if (typeof data.count !== 'number' || !Number.isInteger(data.count) || data.count <= 0) {
        return fail('invalid-count', 'count must be a positive integer');
      }
      return { ok: true, command: { v: UI_PROTOCOL_VERSION, type: 'tech/submit', nodeId: data.nodeId, itemId: data.itemId, count: data.count } };
    }
    case 'tech/submit-all': {
      if (typeof data.nodeId !== 'string' || data.nodeId.length === 0) return fail('invalid-node', 'nodeId must be a non-empty string');
      return { ok: true, command: { v: UI_PROTOCOL_VERSION, type: 'tech/submit-all', nodeId: data.nodeId } };
    }
    case 'tech/track': {
      if (data.nodeId !== null && (typeof data.nodeId !== 'string' || data.nodeId.length === 0)) {
        return fail('invalid-node', 'nodeId must be null or a non-empty string');
      }
      return { ok: true, command: { v: UI_PROTOCOL_VERSION, type: 'tech/track', nodeId: data.nodeId } };
    }
    // P2-E2/E3：运行证明命令。`project/begin-proof` 是 endgame-tech 脚本使用的别名，
    // 规范化后与 `project/proof/begin` 完全相同；两者都只调用 endgame 服务。
    case 'project/proof/begin':
    case 'project/begin-proof':
      return { ok: true, command: { v: UI_PROTOCOL_VERSION, type: 'project/proof/begin' } };
    case 'project/proof/cancel':
    case 'project/cancel-proof':
      return { ok: true, command: { v: UI_PROTOCOL_VERSION, type: 'project/proof/cancel' } };
    // P2-E2：存档通道命令（save/new 破坏性，必须显式 confirm: true）。
    case 'save/request':
      return { ok: true, command: { v: UI_PROTOCOL_VERSION, type: 'save/request' } };
    case 'save/restore':
      return { ok: true, command: { v: UI_PROTOCOL_VERSION, type: 'save/restore' } };
    case 'save/new': {
      if (data.confirm !== true) return fail('invalid-confirm', 'save/new requires confirm: true');
      return { ok: true, command: { v: UI_PROTOCOL_VERSION, type: 'save/new', confirm: true } };
    }
    case 'save/data': {
      if (typeof data.found !== 'boolean') return fail('invalid-save-data', 'found must be a boolean');
      if (data.found) {
        if (typeof data.data !== 'string') return fail('invalid-save-data', 'data must be a string when found is true');
        return { ok: true, command: { v: UI_PROTOCOL_VERSION, type: 'save/data', found: true, data: data.data } };
      }
      return { ok: true, command: { v: UI_PROTOCOL_VERSION, type: 'save/data', found: false } };
    }
    case 'hotbar/select':
      if (!isSlotIndex(data.slot)) return fail('invalid-slot', `invalid hotbar slot: ${String(data.slot)}`);
      return { ok: true, command: { v: UI_PROTOCOL_VERSION, type: 'hotbar/select', slot: data.slot } };
    case 'hotbar/unbind':
      if (!isSlotIndex(data.slot)) return fail('invalid-slot', `invalid hotbar slot: ${String(data.slot)}`);
      return { ok: true, command: { v: UI_PROTOCOL_VERSION, type: 'hotbar/unbind', slot: data.slot } };
    case 'hotbar/bind': {
      if (!isSlotIndex(data.slot)) return fail('invalid-slot', `invalid hotbar slot: ${String(data.slot)}`);
      if (typeof data.itemId !== 'string') return fail('invalid-item', 'itemId must be a string');
      if (getItemDefinition(data.itemId as ItemId) === undefined) {
        return fail('unknown-item', `unknown item id: ${data.itemId}`);
      }
      return {
        ok: true,
        command: { v: UI_PROTOCOL_VERSION, type: 'hotbar/bind', slot: data.slot, itemId: data.itemId as ItemId },
      };
    }
    default:
      return fail('unknown-command', `unknown command: ${String(data.type)}`);
  }
}

/** 解析 hello 携带的启动标志；undefined = 非法，null = 未提供。 */
function parseHelloFlags(raw: unknown): UiHelloFlags | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  const progression = source.progression;
  if (progression !== undefined && progression !== 'player' && progression !== 'legacy') return undefined;
  const techHooks = source.techHooks;
  if (techHooks !== undefined && typeof techHooks !== 'boolean') return undefined;
  return {
    ...(progression === undefined ? {} : { progression }),
    ...(techHooks === undefined ? {} : { techHooks }),
  };
}

/** 由权威数据生成状态快照（只列出库存中实际拥有的物品）。 */
export function buildStateMessage(input: {
  readonly revision: number;
  readonly definitions: readonly ItemDefinition[];
  readonly totals: ReadonlyMap<ItemId, number>;
  readonly slots: readonly HotbarSlot[];
  readonly selected: number;
  /** 工业订单 HUD 数据；缺省 / null 表示服务尚未就绪。 */
  readonly goal?: UiGoalState | null;
  /** P2-E1 科技快照；缺省 / null 表示科技服务尚未就绪。 */
  readonly tech?: TechSnapshot | null;
  /** P2-E2/E3 终局联合工厂快照；缺省 / null 表示服务尚未就绪。 */
  readonly project?: EndgameSnapshot | null;
  /** P2-E2/E3 产线诊断快照；缺省 / null 表示未解锁/服务未就绪。 */
  readonly diagnostics?: DiagnosticsSnapshot | null;
  /** P2-E2 存档快照；缺省 / null 表示存档服务尚未就绪。 */
  readonly save?: PersistenceSnapshot | null;
}): UiStateMessage {
  const items: CatalogItem[] = [];
  for (const definition of input.definitions) {
    const total = input.totals.get(definition.id) ?? 0;
    if (total <= 0) continue;
    items.push({
      id: definition.id,
      name: definition.name,
      description: definition.description,
      icon: definition.icon,
      maxStack: definition.maxStack,
      total,
    });
  }
  return {
    v: UI_PROTOCOL_VERSION,
    type: 'state',
    revision: input.revision,
    items,
    hotbar: { slots: [...input.slots], selected: input.selected },
    goal: input.goal ?? null,
    tech: input.tech ?? null,
    project: input.project ?? null,
    diagnostics: input.diagnostics ?? null,
    save: input.save ?? null,
  };
}

/** 汇总当前库存总数（纯函数，便于测试与桥接复用）。 */
export function collectTotals(
  definitions: readonly ItemDefinition[],
  countOf: (id: ItemId) => number,
): ReadonlyMap<ItemId, number> {
  const totals = new Map<ItemId, number>();
  for (const definition of definitions) totals.set(definition.id, countOf(definition.id));
  return totals;
}

/** 状态是否与上次广播一致（用于避免每帧重复发送）。 */
export function stateSignature(
  definitions: readonly ItemDefinition[],
  countOf: (id: ItemId) => number,
  hotbarRevision: number,
): string {
  return definitions.map((definition) => `${definition.id}:${countOf(definition.id)}`).join('|')
    + `|hotbar:${hotbarRevision}`;
}

export { itemDefinitions };
