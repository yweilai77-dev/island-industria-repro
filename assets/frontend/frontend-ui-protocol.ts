// 前端 UI 与 Engine 侧之间的消息协议：状态形状、常量，以及把 port 消息解析成 UI 状态的纯函数。
// 这里不碰 DOM，便于单独测试。
import { HOTBAR_SLOT_COUNT } from '../hotbar/hotbar.ts';
import { parseGoalView, type UiGoalState } from '../game-ui-bridge/goal-view.ts';

export const PROTOCOL_VERSION = 1;
// 槽位数量以快捷栏服务为唯一来源，避免前端与 Engine 侧槽数各写一份而悄悄失配。
export const SLOT_COUNT = HOTBAR_SLOT_COUNT;

export interface CatalogItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly maxStack: number;
  readonly total: number;
}

export interface HotbarState {
  readonly slots: readonly (string | null)[];
  readonly selected: number;
}

export interface UiState {
  open: boolean;
  paused: boolean;
  revision: number;
  items: CatalogItem[];
  hotbar: HotbarState;
  selectedItemId: string | null;
  /** 工业订单 HUD 数据；null 表示引擎侧尚未就绪（显示初始化状态）。 */
  goal: UiGoalState | null;
}

export interface AppControl {
  pause?: () => unknown;
  resume?: () => unknown;
  input?: { clear?: () => void };
}

export interface HostLike {
  readonly uiRoot?: HTMLElement;
  readonly port?: MessagePort;
  readonly app?: AppControl;
  /** Presentation canvas; only used to suppress the browser context menu locally. */
  readonly canvas?: HTMLCanvasElement;
}

export interface StateMessage {
  readonly v?: number;
  readonly type?: string;
  readonly revision?: number;
  readonly items?: unknown;
  readonly hotbar?: unknown;
  readonly goal?: unknown;
  readonly code?: string;
  readonly message?: string;
}

export function isOkResult(result: unknown): boolean {
  return typeof result === 'object' && result !== null
    && (result as { ok?: unknown }).ok === true;
}

export function parseState(
  message: StateMessage,
): { items: CatalogItem[]; hotbar: HotbarState; goal: UiGoalState | null } | undefined {
  if (message.type !== 'state' || message.v !== PROTOCOL_VERSION) return undefined;
  if (!Array.isArray(message.items)) return undefined;
  const hotbarRaw = message.hotbar as { slots?: unknown; selected?: unknown } | undefined;
  if (!hotbarRaw || !Array.isArray(hotbarRaw.slots) || hotbarRaw.slots.length !== SLOT_COUNT) return undefined;
  const slots = hotbarRaw.slots.map((slot) => (typeof slot === 'string' ? slot : null));
  const selected = typeof hotbarRaw.selected === 'number' ? hotbarRaw.selected : 0;
  const items: CatalogItem[] = [];
  for (const raw of message.items) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.name !== 'string') continue;
    items.push({
      id: item.id,
      name: item.name,
      description: typeof item.description === 'string' ? item.description : '',
      icon: typeof item.icon === 'string' ? item.icon : 'unknown',
      maxStack: typeof item.maxStack === 'number' ? item.maxStack : 0,
      total: typeof item.total === 'number' ? item.total : 0,
    });
  }
  return {
    items,
    hotbar: { slots, selected: Math.min(SLOT_COUNT - 1, Math.max(0, Math.floor(selected))) },
    goal: parseGoalView(message.goal),
  };
}