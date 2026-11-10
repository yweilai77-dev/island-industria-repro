/**
 * 正式存档服务（M2.0-P2-E3）：唯一权威快照的收集、写入、读取与恢复编排。
 *
 * 职责边界：
 * - 存储通道（前端 realm 的平台存储/devStub）由 game-ui-bridge 注入 transport，本服务不碰 DOM；
 * - 各系统只通过窄接口（save-ports.ts）收发纯 JSON，本文件不摸系统内部结构；
 * - 科技复用 E1 的 tech.serialize()/restore()，不建立第二套科技存档；
 * - 恢复一次性收集整包、按固定顺序应用；任一切片失败只记录 issue 并继续，
 *   整包不可解析时保持当前世界不变并回报错误。
 *
 * 触发时机（保存）由前端/桥接负责：visibilitychange / 面板关闭 / 每 15 s / 科技提交后；
 * 本服务只保证 requestSave 幂等，同一 JS 回合内的多次请求合并成一次写入。
 */
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import { decodeSnapshot, encodeSnapshot } from './save-codec.ts';
import {
  SAVE_ENGINE_VERSION,
  SAVE_VERSION,
  type SaveGoalSlice,
  type SaveSnapshot,
} from './save-schema.ts';
import type { SaveRestoreReport, SaveTransport } from './save-ports.ts';
import type {} from '../player/player.ts';
import type {} from '../inventory/inventory.ts';
import type {} from '../hotbar/hotbar.ts';
import type {} from '../resource/resource.ts';
import type {} from '../build/build.pack.ts';
import type {} from '../build/floors.pack.ts';
import type {} from '../mechanical/mechanical.pack.ts';
import type {} from '../mechanical/runtime.ts';
import type {} from '../industrial/port.pack.ts';
import type {} from '../tech/tech.pack.ts';
import type {} from '../goal/goal-service.ts';

export type PersistenceStatus = 'idle' | 'busy' | 'saved' | 'restored' | 'error';

export interface PersistenceSnapshot {
  readonly status: PersistenceStatus;
  /** 最近一次成功保存/读取的 ISO 时间；从未发生为 null。 */
  readonly savedAt: string | null;
  /** 人话状态（错误原因 / 修复记录摘要）。 */
  readonly message: string | null;
  /** 快照版本。 */
  readonly version: number;
  /** 本会话是否已确认存在可读取的存档。 */
  readonly hasSave: boolean;
}

export interface PersistenceStoragePayload {
  readonly found: boolean;
  readonly data?: string;
}

export interface PersistenceStorageResult {
  readonly ok: boolean;
  readonly repaired: boolean;
  readonly issues: readonly string[];
}

export interface PersistenceService {
  revision(): number;
  /** bridge 注入下行通道：post = port.postMessage。重复注入以最新为准。 */
  setTransport(transport: SaveTransport): void;
  snapshot(): PersistenceSnapshot;
  /** 立即保存（同一 JS 回合内多次请求合并；无 transport 时等注入后补发）。 */
  requestSave(): void;
  /** 从存档恢复（没有存档时保持初始世界并上报）。 */
  requestRestore(): void;
  /** 丢弃存档并从头开始（新游戏）：清存储 + 本次会话不再自动恢复。 */
  requestNewGame(): void;
  /** 前端存储读取结果回灌（桥接 save/data 命令）。 */
  onStorageData(payload: PersistenceStoragePayload): PersistenceStorageResult;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    persistence: PersistenceService;
  }
}

interface GoalServiceLike {
  state(): { readonly baseline: unknown; readonly completed: readonly string[] };
  restoreState?(raw: unknown): { readonly repaired: boolean; readonly issues: readonly string[] };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const persistencePlugin: Plugin = {
  name: 'island-industria/persistence',
  inject: ['world'],
  apply(ctx) {
    // 不把各系统放进 inject：存档是最后挂载的编排者，服务缺失时只影响对应切片，
    // 而不是整个插件起不来（单测/裁剪配置也能工作）。
    let revision = 0;
    let status: PersistenceStatus = 'idle';
    let savedAt: string | null = null;
    let message: string | null = null;
    let hasSave = false;
    let transport: SaveTransport | null = null;
    let pendingSave = false;
    let pendingRead = false;
    let saveScheduled = false;
    let saveDirty = false;
    let readInFlight = false;
    let restoreRequested = false;
    let autoRestoreAvailable = true;
    let restoring = false;

    const bump = (): void => { revision += 1; };
    const fail = (text: string): void => {
      status = 'error';
      message = text;
      bump();
    };

    /** 按当前真实世界收集快照；返回 null 表示必需服务缺失（不写坏存档）。 */
    const collectSnapshot = (): { readonly snapshot: SaveSnapshot | null; readonly issues: readonly string[] } => {
      const issues: string[] = [];
      const player = ctx.get('player');
      const inventory = ctx.get('inventory');
      const hotbar = ctx.get('hotbar');
      const resourceNodes = ctx.get('resourceNodes');
      if (!player || !inventory || !hotbar || !resourceNodes) {
        return {
          snapshot: null,
          issues: ['required service missing: player/inventory/hotbar/resourceNodes'],
        };
      }
      const safe = <T>(label: string, fn: () => T, fallback: T): T => {
        try {
          return fn();
        } catch (error) {
          issues.push(label + ': ' + errorText(error));
          return fallback;
        }
      };
      const floors = ctx.get('floors');
      const buildings = ctx.get('buildings');
      const mechanical = ctx.get('mechanical');
      const ports = ctx.get('ports');
      const runtimeSave = ctx.get('mechanicalRuntimeSave');
      const tech = ctx.get('tech');
      const goal = ctx.get('goalProgress') as GoalServiceLike | undefined;

      const floorsData = floors === undefined
        ? { nextFloorId: 1, floors: [] as const }
        : safe('floors', () => floors.snapshotSave(), { nextFloorId: 1, floors: [] as const });
      const buildingsData = buildings === undefined
        ? { nextBuildingId: 1, buildings: [] as const }
        : safe('buildings', () => buildings.snapshotSave(), { nextBuildingId: 1, buildings: [] as const });
      const mechanicalData = mechanical === undefined
        ? { nextPartId: 1, kitGranted: false, parts: [] as const }
        : safe('mechanical', () => mechanical.saveSnapshot(), { nextPartId: 1, kitGranted: false, parts: [] as const });
      const portsData = ports === undefined
        ? { ports: [] as const, links: [] as const }
        : safe('ports', () => ports.saveSnapshot(), { ports: [] as const, links: [] as const });
      const sources = runtimeSave === undefined ? [] : safe('sources', () => runtimeSave.snapshotSources(), []);
      const production = runtimeSave === undefined
        ? { machines: [] as const, chutes: [] as const }
        : safe('production', () => runtimeSave.snapshotProduction(), { machines: [] as const, chutes: [] as const });
      const techState = tech === undefined ? undefined : safe('tech', () => tech.serialize(), undefined);
      let goalSlice: SaveGoalSlice | undefined;
      if (goal !== undefined) {
        goalSlice = safe('goal', () => {
          const state = goal.state();
          const baseline = state.baseline as { crushedOre?: number; ironIngot?: number; shaft?: number };
          return {
            baseline: {
              crushedOre: baseline.crushedOre ?? 0,
              ironIngot: baseline.ironIngot ?? 0,
              shaft: baseline.shaft ?? 0,
            },
            completed: [...state.completed],
          };
        }, undefined);
      }
      const playerState = player.state;
      const snapshot: SaveSnapshot = {
        version: SAVE_VERSION,
        savedAt: new Date().toISOString(),
        engine: SAVE_ENGINE_VERSION,
        player: {
          x: playerState.position[0],
          z: playerState.position[2],
          level: playerState.level,
          yaw: playerState.facingYaw,
        },
        inventory: safe('inventory', () => inventory.snapshot(), { stacks: [] }),
        hotbar: safe('hotbar', () => hotbar.snapshot(), {
          slots: Array.from({ length: 12 }, () => null),
          selected: 0,
        }),
        kitGranted: mechanicalData.kitGranted,
        counters: {
          nextBuildingId: buildingsData.nextBuildingId,
          nextPartId: mechanicalData.nextPartId,
          nextFloorId: floorsData.nextFloorId,
        },
        floors: floorsData.floors,
        buildings: buildingsData.buildings,
        parts: mechanicalData.parts,
        sources,
        resources: safe('resources', () => resourceNodes.snapshot(), []),
        ports: portsData.ports,
        links: portsData.links,
        production,
        ...(techState === undefined ? {} : { tech: techState }),
        ...(goalSlice === undefined ? {} : { goal: goalSlice }),
      };
      return { snapshot, issues };
    };

    const flushSave = (): void => {
      if (transport === null) {
        pendingSave = true;
        return;
      }
      const collected = collectSnapshot();
      if (collected.snapshot === null) {
        fail('保存失败：' + collected.issues.join('; '));
        return;
      }
      let json: string;
      try {
        json = encodeSnapshot(collected.snapshot);
      } catch (error) {
        fail('保存失败（快照无法序列化）：' + errorText(error));
        return;
      }
      try {
        transport.post({ type: 'save/write', data: json });
      } catch (error) {
        fail('保存失败（通道异常）：' + errorText(error));
        return;
      }
      savedAt = collected.snapshot.savedAt;
      hasSave = true;
      status = 'saved';
      message = collected.issues.length > 0
        ? '已保存（' + collected.issues.length + ' 项修复：' + collected.issues.slice(0, 3).join('; ') + '）'
        : null;
      bump();
    };

    const scheduleSave = (): void => {
      saveDirty = true;
      if (saveScheduled) return;
      saveScheduled = true;
      queueMicrotask(() => {
        saveScheduled = false;
        if (!saveDirty) return;
        saveDirty = false;
        flushSave();
      });
    };

    const postRead = (): void => {
      if (transport === null) {
        pendingRead = true;
        return;
      }
      pendingRead = false;
      readInFlight = true;
      status = 'busy';
      message = '正在读取存档…';
      bump();
      try {
        transport.post({ type: 'save/read' });
      } catch (error) {
        readInFlight = false;
        fail('读取失败（通道异常）：' + errorText(error));
      }
    };

    const requestRestore = (): void => {
      restoreRequested = true;
      if (readInFlight) return;
      postRead();
    };

    /** 按固定顺序把解码后的快照应用到真实世界；返回逐条 issue（不抛异常）。 */
    const applySnapshot = (snapshot: SaveSnapshot): readonly string[] => {
      const issues: string[] = [];
      const apply = (label: string, fn: () => SaveRestoreReport | undefined): void => {
        try {
          const report = fn();
          if (report !== undefined) {
            for (const issue of report.issues) issues.push(label + ': ' + issue);
          }
        } catch (error) {
          issues.push(label + ': ' + errorText(error));
        }
      };
      const missing = (label: string): void => {
        issues.push(label + ': service missing; slice skipped');
      };

      // 1) 楼层（为玩家/建筑/机械提供支撑面）
      const floors = ctx.get('floors');
      if (floors === undefined) {
        if (snapshot.floors.length > 0) missing('floors');
      } else {
        apply('floors', () => floors.restoreSave(snapshot.floors, snapshot.counters.nextFloorId));
      }
      // 2) 玩家位置（在恢复后的支撑面上做一次垂直解算）
      const player = ctx.get('player');
      if (player === undefined) missing('player');
      else apply('player', () => player.restorePosition(snapshot.player));
      // 3) 库存 / 4) 快捷栏
      const inventory = ctx.get('inventory');
      if (inventory === undefined) missing('inventory');
      else apply('inventory', () => inventory.restore(snapshot.inventory));
      const hotbar = ctx.get('hotbar');
      if (hotbar === undefined) missing('hotbar');
      else apply('hotbar', () => hotbar.restore(snapshot.hotbar));
      // 5) 资源节点（先于建筑：建筑读档会检查资源格）
      const resourceNodes = ctx.get('resourceNodes');
      if (resourceNodes === undefined) missing('resourceNodes');
      else apply('resources', () => resourceNodes.restore(snapshot.resources));
      // 6) 建筑
      const buildings = ctx.get('buildings');
      if (buildings === undefined) {
        if (snapshot.buildings.length > 0) missing('buildings');
      } else {
        apply('buildings', () => buildings.restoreSave(snapshot.buildings, snapshot.counters.nextBuildingId));
      }
      // 7) 机械零件（抑制开场套件发放，nextPartId 一并恢复）
      const mechanical = ctx.get('mechanical');
      if (mechanical === undefined) {
        if (snapshot.parts.length > 0) missing('mechanical');
      } else {
        apply('mechanical', () => mechanical.restoreSave(snapshot.parts, snapshot.counters.nextPartId, snapshot.kitGranted));
      }
      // 8) 动力源启停 / 9) 接口盒与物料连接 / 10) 加工运行时
      const runtimeSave = ctx.get('mechanicalRuntimeSave');
      if (runtimeSave === undefined) {
        if (snapshot.sources.length > 0 || snapshot.production.machines.length > 0) missing('mechanicalRuntimeSave');
      } else {
        apply('sources', () => runtimeSave.restoreSources(snapshot.sources));
      }
      const ports = ctx.get('ports');
      if (ports === undefined) {
        if (snapshot.ports.length > 0 || snapshot.links.length > 0) missing('ports');
      } else {
        apply('ports', () => ports.restoreSave(snapshot.ports, snapshot.links));
      }
      if (runtimeSave !== undefined) {
        apply('production', () => runtimeSave.restoreProduction(snapshot.production));
      }
      // 11) 科技（直接复用 E1 的 tech.restore；未知节点/物品逐条修复）
      const tech = ctx.get('tech');
      if (snapshot.tech !== undefined) {
        if (tech === undefined) missing('tech');
        else {
          try {
            const restored = tech.restore(snapshot.tech);
            if (restored.repaired) {
              for (const issue of restored.issues) issues.push('tech: ' + issue);
            }
          } catch (error) {
            issues.push('tech: ' + errorText(error));
          }
        }
      }
      // 12) 订单（本轮到 goal-service 只读为止：保留 issue，明确告诉玩家进度未恢复）
      if (snapshot.goal !== undefined) {
        const goal = ctx.get('goalProgress') as GoalServiceLike | undefined;
        if (goal?.restoreState === undefined) {
          issues.push('goal: order progress not restored yet (goal service is read-only this round)');
        } else {
          try {
            const restored = goal.restoreState(snapshot.goal);
            for (const issue of restored.issues) issues.push('goal: ' + issue);
          } catch (error) {
            issues.push('goal: ' + errorText(error));
          }
        }
      }
      return issues;
    };

    const onStorageData = (payload: PersistenceStoragePayload): PersistenceStorageResult => {
      readInFlight = false;
      if (restoring) return { ok: false, repaired: false, issues: ['restore already in progress'] };
      if (payload.found !== true || typeof payload.data !== 'string') {
        hasSave = false;
        savedAt = null;
        status = 'idle';
        message = '没有可读取的存档';
        bump();
        return { ok: false, repaired: false, issues: ['no save data'] };
      }
      const decoded = decodeSnapshot(payload.data);
      if (!decoded.ok) {
        hasSave = true;
        fail('存档损坏，已保持当前世界：' + decoded.reason);
        return { ok: false, repaired: false, issues: decoded.issues };
      }
      restoring = true;
      let issues: readonly string[];
      try {
        issues = [...decoded.issues, ...applySnapshot(decoded.snapshot)];
      } catch (error) {
        issues = [...decoded.issues, 'restore: ' + errorText(error)];
      } finally {
        restoring = false;
      }
      hasSave = true;
      savedAt = decoded.snapshot.savedAt;
      status = 'restored';
      message = issues.length > 0
        ? '存档已恢复（' + issues.length + ' 项修复/跳过）：' + issues.slice(0, 3).join('; ')
        : '存档已恢复';
      bump();
      return { ok: true, repaired: issues.length > 0, issues };
    };

    const service: PersistenceService = {
      revision: () => revision,
      setTransport: (next: SaveTransport) => {
        transport = next;
        if (pendingSave) {
          pendingSave = false;
          scheduleSave();
        }
        if (pendingRead) {
          pendingRead = false;
          postRead();
          return;
        }
        // 首次接上通道时自动尝试恢复一次；请求过恢复/新游戏的会话不再自动恢复。
        if (autoRestoreAvailable && !restoreRequested && !readInFlight) {
          autoRestoreAvailable = false;
          requestRestore();
        }
      },
      snapshot: () => ({ status, savedAt, message, version: SAVE_VERSION, hasSave }),
      requestSave: () => {
        if (transport === null) {
          pendingSave = true;
          return;
        }
        scheduleSave();
      },
      requestRestore: () => {
        requestRestore();
      },
      requestNewGame: () => {
        autoRestoreAvailable = false;
        restoreRequested = true;
        pendingRead = false;
        hasSave = false;
        savedAt = null;
        status = 'idle';
        message = '存档已清除，下次进入将从头开始';
        bump();
        if (transport !== null) {
          try {
            transport.post({ type: 'save/clear' });
          } catch (error) {
            fail('清除存档失败（通道异常）：' + errorText(error));
          }
        }
      },
      onStorageData: (payload) => onStorageData(payload),
    };
    ctx.provide('persistence', service);
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.save,
  name: 'ISLAND INDUSTRIA / Persistence',
  plugins: true,
  build: () =>
    ok({
      'plugin/persistence': {
        kind: 'plugin',
        module: { specifier: './persistence.pack.ts', export: 'persistencePlugin' },
      },
    }),
});
