/**
 * M2.0-P2-E3 存档端口：每个系统对存档层暴露的**窄接口**。
 *
 * 为什么需要这层：持久化插件（persistence.pack.ts）是最后挂载的编排者，它只应该
 * 知道「这个系统能给我一份纯 JSON、能收回去」这两件事，绝不直接摸各系统的内部结构。
 * 各系统在自己的服务接口里实现这些方法；本文件只给类型与 TODO 清单：
 *
 * 已接入（本轮）：
 *   player  restorePosition      （assets/player/player.pack.ts）
 *   inventory snapshot/restore   （assets/inventory/inventory.ts）
 *   hotbar  snapshot/restore     （assets/hotbar/hotbar.ts）
 *   resourceNodes snapshot/restore（assets/resource/resource.pack.ts）
 *   floors  snapshotSave/restoreSave（assets/build/floors.pack.ts）
 *   buildings snapshot/restore   （assets/build/build.pack.ts）
 *   mechanical snapshotSave/restoreSave（assets/mechanical/mechanical.pack.ts）
 *   ports   saveSnapshot/restoreSave（assets/industrial/port.pack.ts）
 *   mechanicalRuntimeSave 动力源启停 + 加工运行时（assets/mechanical/runtime.ts）
 *   tech    serialize/restore    （assets/tech/tech.pack.ts，E1 已就绪，直接复用）
 *
 * 待接入（本轮不能改这些目录，见 docs/m20/P2-E3-SAVE-DESIGN.md 的剩余集成清单）：
 *   goal    订单 baseline/completed：goalProgress 目前只读；需要 goal-service 增加 restoreState。
 *   endgame 运行证明窗口是瞬时状态，终局完成标记在 TechState（无需单独切片），
 *           只需确认读档后窗口回到 idle（当前由插件重建即满足，无需接口）。
 *   diagnostics 纯派生量，不进存档。
 *   assembly    组合关系由结构相邻关系派生，不进存档。
 */

import type {
  SaveFloorsData,
  SaveHotbarSlice,
  SaveInventorySlice,
  SaveMechanicalData,
  SavePlayerRecord,
  SavePortsData,
  SaveProductionSlice,
  SaveResourceRecord,
  SaveSourceRecord,
  SaveBuildingsData,
} from './save-schema.ts';

/** 下行通道：由 game-ui-bridge 注入（post = MessagePort.postMessage）。 */
export interface SaveTransport {
  post(message: unknown): void;
}

/** 各系统 restore 的统一返回：成功恢复多少条 + 逐条问题（人话）。 */
export interface SaveRestoreReport {
  readonly restored: number;
  readonly issues: readonly string[];
}

/** 存档层持有的最小服务形状（引擎各服务在自己的文件里声明，供持久化层按需读取）。 */
export interface PlayerSavePort {
  restorePosition(raw: unknown): SaveRestoreReport;
}

export interface InventorySavePort {
  snapshot(): SaveInventorySlice;
  restore(raw: unknown): SaveRestoreReport;
}

export interface HotbarSavePort {
  snapshot(): SaveHotbarSlice;
  restore(raw: unknown): SaveRestoreReport;
}

export interface ResourceSavePort {
  snapshot(): readonly SaveResourceRecord[];
  restore(raw: unknown): SaveRestoreReport;
}

export interface FloorsSavePort {
  snapshotSave(): SaveFloorsData;
  restoreSave(rawFloors: unknown, rawNextFloorId: unknown): SaveRestoreReport;
}

export interface BuildingsSavePort {
  snapshotSave(): SaveBuildingsData;
  restoreSave(rawBuildings: unknown, rawNextBuildingId: unknown): SaveRestoreReport;
}

export interface MechanicalSavePort {
  snapshotSave(): SaveMechanicalData;
  restoreSave(rawParts: unknown, rawNextPartId: unknown, rawKitGranted: unknown): SaveRestoreReport;
}

export interface PortsSavePort {
  saveSnapshot(): SavePortsData;
  restoreSave(rawPorts: unknown, rawLinks: unknown): SaveRestoreReport;
}

export interface MechanicalRuntimeSavePort {
  snapshotSources(): readonly SaveSourceRecord[];
  restoreSources(raw: unknown): SaveRestoreReport;
  snapshotProduction(): SaveProductionSlice;
  restoreProduction(raw: unknown): SaveRestoreReport;
}

/** 科技端口：E1 已具备，直接复用（不新建第二套科技存档）。 */
export interface TechSavePort {
  serialize(): unknown;
  restore(raw: unknown): { readonly state: unknown; readonly repaired: boolean; readonly issues: readonly string[] };
}

/** TODO(P2-E3 第二轮)：订单状态恢复端口；goal-service 只需增加 restoreState。 */
export interface GoalSavePort {
  state(): { readonly baseline: { readonly crushedOre: number; readonly ironIngot: number; readonly shaft: number }; readonly completed: readonly string[] };
  restoreState?(raw: unknown): { readonly repaired: boolean; readonly issues: readonly string[] };
}

/** 供编排层记录一条问题文本的小工具（纯函数）。 */
export function describeIssue(system: string, error: unknown): string {
  return system + ': ' + (error instanceof Error ? error.message : String(error));
}
