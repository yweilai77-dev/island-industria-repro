import type { ItemId } from '../items/items.ts';
import type { PortSlotId } from './ids.ts';
import type {
  InstalledPort,
  InstalledPortSnapshot,
} from './port-runtime.ts';

/**
 * P2-B `ports` 服务契约（只有类型 + 模块声明，没有实现）。
 *
 * 实现放在 `port.pack.ts`（插件持有运行时状态与视图）；加工运行时只通过这个窄接口
 * 读接口盒、投料与取料，因此它**不认识**接口盒的内部结构，也不会重复维护一份状态。
 */
export interface PortService {
  /** 该机器上的全部已装接口盒（按安装位 ID 排序；只读视图）。 */
  installedOf(partId: number): readonly InstalledPort[];
  /** 该机器上已装的输入位接口盒（自动输入的合法目标）。 */
  inputBoxesOf(partId: number): readonly InstalledPort[];
  /** 往某安装位的接口盒投 1 件物料；容量满/物料类型不符时返回 false。 */
  accept(partId: number, slotId: PortSlotId, itemId: ItemId): boolean;
  /** 把输入接口盒里的物料推进机器输入缓冲；返回转移件数。 */
  drain(partId: number, tryInsert: (itemId: ItemId) => boolean): number;
  /** 读投影（纯 JSON，给唯一 GameRead 用）。 */
  snapshot(): readonly InstalledPortSnapshot[];
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    /** 工业接口盒运行时（由 port 插件提供）。 */
    ports: PortService;
  }
}
