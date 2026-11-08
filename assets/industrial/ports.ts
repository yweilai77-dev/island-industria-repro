import type { ItemId } from '../items/items.ts';
import type { PortSlotId } from './ids.ts';
import type { LinkCreateResult, MaterialLinkSnapshot } from './link-runtime.ts';
import type { InstalledPort, InstalledPortSnapshot } from './port-runtime.ts';
import type { PortEndpoint } from './runtime-model.ts';

/**
 * P2-B/P2-C `ports` 服务契约（只有类型 + 模块声明，没有实现）。
 *
 * 实现放在 `port.pack.ts`（插件持有接口盒运行时与物料连接运行时）；加工运行时只通过这个
 * 窄接口读写接口盒与推进连接，因此它**不认识**接口盒/连接的内部结构，也不会重复维护状态。
 */
export interface PortService {
  /** 该机器上的全部已装接口盒（按安装位 ID 排序；只读视图）。 */
  installedOf(partId: number): readonly InstalledPort[];
  /** 该机器上已装的输入位接口盒（自动输入的合法目标）。 */
  inputBoxesOf(partId: number): readonly InstalledPort[];
  /** 该机器上已装的输出位接口盒（自动输出的合法来源）。 */
  outputBoxesOf(partId: number): readonly InstalledPort[];
  /** 往某安装位的接口盒投 1 件物料；容量满/物料类型不符时返回 false。 */
  accept(partId: number, slotId: PortSlotId, itemId: ItemId): boolean;
  /** 把输入接口盒里的物料推进机器输入缓冲；返回转移件数。 */
  drain(partId: number, tryInsert: (itemId: ItemId) => boolean): number;
  /** 某安装位接口盒缓冲的只读视图（没装盒返回 undefined）。 */
  bufferOf(
    partId: number,
    slotId: PortSlotId,
  ): { readonly itemId: ItemId | null; readonly count: number; readonly capacity: number } | undefined;
  /** 推进所有物料连接（每次物流推进调用一次）；返回实际传递件数。 */
  stepLinks(): number;
  /** 全部物料连接的读投影（纯 JSON）。 */
  links(): readonly MaterialLinkSnapshot[];
  /** 建立物料连接：先校验后写入，失败不产生状态变化。 */
  createLink(from: PortEndpoint, to: PortEndpoint): LinkCreateResult;
  /** 解开某机器某端口上的全部连接；返回解除条数。 */
  removeLinksAt(partId: number, slotId: PortSlotId): number;
  /** 读投影（纯 JSON，给唯一 GameRead 用）。 */
  snapshot(): readonly InstalledPortSnapshot[];
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    /** 工业接口盒与物料连接运行时（由 port 插件提供）。 */
    ports: PortService;
  }
}
