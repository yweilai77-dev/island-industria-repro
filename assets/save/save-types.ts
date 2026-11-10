/**
 * 正式存档 v1：快照类型与版本常量（由 save-schema.ts 聚合 re-export，调用方只 import save-schema.ts）。
 * 纯类型/常量，零引擎依赖。
 */
import type { ItemId } from '../items/items.ts';
import type { HotbarSlot } from '../hotbar/hotbar.ts';

export const SAVE_VERSION = 1;
/** 引擎版本记录，仅用于排障与迁移决策，不参与校验。 */
export const SAVE_ENGINE_VERSION = '0.4.19';
/** 单份存档 JSON 的最大字符数；超过直接拒绝，避免恶意/损坏数据撑爆内存。 */
export const SAVE_MAX_CHARS = 512 * 1024;

export interface SavePlayerRecord {
  readonly x: number;
  readonly z: number;
  readonly level: number;
  readonly yaw: number;
}

export interface SaveInventoryStack {
  readonly itemId: ItemId;
  readonly count: number;
}

export interface SaveInventorySlice {
  readonly stacks: readonly SaveInventoryStack[];
}

export interface SaveHotbarSlice {
  readonly slots: readonly HotbarSlot[];
  readonly selected: number;
}

export interface SaveCounters {
  readonly nextBuildingId: number;
  readonly nextPartId: number;
  readonly nextFloorId: number;
}

/** 楼层/建筑/机械零件共用的逻辑放置记录：kind 是稳定定义 ID。 */
export interface SavePlacementRecord {
  readonly id: number;
  readonly kind: string;
  readonly gx: number;
  readonly gz: number;
  readonly rotation: number;
  readonly level: number;
}

export type SaveFloorRecord = SavePlacementRecord;
export type SaveBuildingRecord = SavePlacementRecord;
export type SavePartRecord = SavePlacementRecord;

export interface SaveSourceRecord {
  readonly partId: number;
  readonly enabled: boolean;
}

export interface SaveResourceRecord {
  readonly id: number;
  readonly amount: number;
  /** 由 amount 派生，存档里存一份便于人工排查；恢复时以 amount 为准。 */
  readonly depleted: boolean;
}

export interface SavePortRecord {
  readonly partId: number;
  readonly slotId: string;
  readonly moduleId: string;
  readonly itemId: ItemId | null;
  readonly count: number;
}

export interface SavePortEndpoint {
  readonly entityId: number;
  readonly slotId: string;
}

export interface SaveLinkRecord {
  readonly id: string;
  readonly from: SavePortEndpoint;
  readonly to: SavePortEndpoint;
  readonly moved: number;
}

export interface SaveMachineRecord {
  readonly partId: number;
  readonly recipeId: string | null;
  readonly progress: number;
  readonly inputItem: ItemId | null;
  readonly inputCount: number;
  readonly outputItem: ItemId | null;
  readonly outputCount: number;
  readonly producedTotal: number;
}

export interface SaveChuteRecord {
  readonly partId: number;
  readonly itemId: ItemId | null;
  readonly t: number;
  readonly blocked: boolean;
  readonly delivered: number;
}

export interface SaveProductionSlice {
  readonly machines: readonly SaveMachineRecord[];
  readonly chutes: readonly SaveChuteRecord[];
}

export interface SaveGoalSlice {
  readonly baseline: {
    readonly crushedOre: number;
    readonly ironIngot: number;
    readonly shaft: number;
  };
  readonly completed: readonly string[];
}

export interface SavePortsData {
  readonly ports: readonly SavePortRecord[];
  readonly links: readonly SaveLinkRecord[];
}

export interface SaveBuildingsData {
  readonly nextBuildingId: number;
  readonly buildings: readonly SaveBuildingRecord[];
}

export interface SaveFloorsData {
  readonly nextFloorId: number;
  readonly floors: readonly SaveFloorRecord[];
}

export interface SaveMechanicalData {
  readonly nextPartId: number;
  readonly kitGranted: boolean;
  readonly parts: readonly SavePartRecord[];
}

export interface SaveSnapshot {
  readonly version: number;
  readonly savedAt: string;
  readonly engine: string;
  readonly player: SavePlayerRecord;
  readonly inventory: SaveInventorySlice;
  readonly hotbar: SaveHotbarSlice;
  readonly kitGranted: boolean;
  readonly counters: SaveCounters;
  readonly floors: readonly SaveFloorRecord[];
  readonly buildings: readonly SaveBuildingRecord[];
  readonly parts: readonly SavePartRecord[];
  readonly sources: readonly SaveSourceRecord[];
  readonly resources: readonly SaveResourceRecord[];
  readonly ports: readonly SavePortRecord[];
  readonly links: readonly SaveLinkRecord[];
  readonly production: SaveProductionSlice;
  /** 科技状态：tech.serialize() 的原样 JSON（版本由 TECH_STATE_VERSION 管理）。 */
  readonly tech?: unknown;
  /** 终局运行证明：endgame.serialize() 的原样 JSON（窗口状态/基线/上次结论；完成标记在 tech）。 */
  readonly endgame?: unknown;
  /** 工业订单状态（预留：goal-service 目前只读，本题先存不恢复）。 */
  readonly goal?: SaveGoalSlice;
}

