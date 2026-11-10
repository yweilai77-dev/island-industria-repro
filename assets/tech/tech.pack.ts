/**
 * M2.0-P2-E1 科技树插件：科技状态的唯一权威所有者。
 *
 * 职责（任务书 §二 E1-B/E1-E）：
 * - 校验 12 个节点数据（启动时执行，数据错误立即暴露）；
 * - 持有 TechState（交付进度/已解锁/追踪目标/进度模式）；
 * - 提供 `tech` 服务：交付事务、只读快照、五类门控查询、序列化边界；
 * - 不实现 UI（E2）、不实现终局结算（E3）、不建立第二套库存。
 *
 * 进度模式：`player`（正式流程，门控生效）/ `legacy`（仅旧验收脚本的兼容模式，
 * 由测试脚手架通过前端 flags 设置；正式玩家流程没有任何入口可以切到它）。
 */
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/assets-runtime';
import type {} from '../inventory/inventory.ts';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import {
  hasCapability,
  isPartUnlocked,
  isPortUnlocked,
  isProjectUnlocked,
  isRecipeUnlocked,
  isStructureUnlocked,
} from './gates.ts';
import { createCatalogResolvers } from './resolvers.ts';
import {
  completedSetOf,
  createTechState,
  restoreTechState,
  serializeTechState,
  submit,
  submitAll,
  techSnapshotOf,
  trackNode,
} from './state.ts';
import { TECH_NODES, TECH_NODE_COUNT } from './nodes.ts';
import type {
  TechCapabilityId,
  TechProgressionMode,
  TechSnapshot,
  TechState,
  TechSubmitResult,
} from './types.ts';
import type { TechRestoreResult } from './state.ts';
import type { ItemId } from '../items/items.ts';
import { assertValidTechTree } from './validate.ts';

/** 科技服务契约（其他插件通过 `ctx.tech` 使用）。 */
export interface TechService {
  /** 状态版本号：任何交付/解锁/模式/追踪变化都会 +1。 */
  revision(): number;
  mode(): TechProgressionMode;
  snapshot(): TechSnapshot;
  /** 交付一种材料（原子：先校验再扣库存，失败不改状态）。 */
  submit(nodeId: string, itemId: string, count: number): TechSubmitResult;
  /** 一键交齐（补偿事务；任一步失败回滚已扣材料）。 */
  submitAll(nodeId: string): TechSubmitResult;
  /** 追踪目标（null = 取消追踪）。 */
  track(nodeId: string | null): boolean;
  isRecipeUnlocked(recipeId: string): boolean;
  isPartUnlocked(partId: string): boolean;
  isPortUnlocked(portModuleId: string): boolean;
  isStructureUnlocked(structureId: string): boolean;
  hasCapability(capability: TechCapabilityId): boolean;
  isProjectUnlocked(projectId: string): boolean;
  /** 序列化边界：纯 JSON，供未来存档系统接入。 */
  serialize(): TechState;
  /** 从不可信数据恢复（幂等；被修复时返回修复记录）。 */
  restore(raw: unknown): TechRestoreResult;
  /** 兼容模式切换（只有测试脚手架会调用）。 */
  setMode(mode: TechProgressionMode): void;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    tech: TechService;
  }
}

export const techPlugin: Plugin = {
  name: 'island-industria/tech',
  inject: ['world', 'inventory'],
  apply(ctx) {
    const inventory = ctx.inventory;
    // 数据校验在装配时执行：节点/前置/成本/解锁目标任何不一致都立即抛错。
    assertValidTechTree(TECH_NODES, createCatalogResolvers(), TECH_NODE_COUNT);

    let state: TechState = createTechState('player');
    let revision = 0;

    const commit = (next: TechState): void => {
      state = next;
      revision += 1;
    };
    const completed = (): ReadonlySet<string> => completedSetOf(state);

    const inventoryPort = {
      has: (itemId: ItemId, count: number) => inventory.has(itemId, count),
      remove: (itemId: ItemId, count: number) => inventory.remove(itemId, count),
      add: (itemId: ItemId, count: number) => { inventory.add(itemId, count); },
    };

    const service: TechService = {
      revision: () => revision,
      mode: () => state.mode,
      snapshot: () => techSnapshotOf(state),
      submit: (nodeId, itemId, count) => {
        const outcome = submit(state, nodeId, itemId, count, inventoryPort);
        if (outcome.state !== state) commit(outcome.state);
        return outcome.result;
      },
      submitAll: (nodeId) => {
        const outcome = submitAll(state, nodeId, inventoryPort);
        if (outcome.state !== state) commit(outcome.state);
        return outcome.result;
      },
      track: (nodeId) => {
        const outcome = trackNode(state, nodeId);
        if (outcome.ok && outcome.state !== state) commit(outcome.state);
        return outcome.ok;
      },
      isRecipeUnlocked: (recipeId) => isRecipeUnlocked(state, completed(), recipeId),
      isPartUnlocked: (partId) => isPartUnlocked(state, completed(), partId),
      isPortUnlocked: (portModuleId) => isPortUnlocked(state, completed(), portModuleId),
      isStructureUnlocked: (structureId) => isStructureUnlocked(state, completed(), structureId),
      hasCapability: (capability) => hasCapability(state, completed(), capability),
      isProjectUnlocked: (projectId) => isProjectUnlocked(state, completed(), projectId),
      serialize: () => serializeTechState(state),
      restore: (raw) => {
        const outcome = restoreTechState(raw);
        commit(outcome.state);
        return outcome;
      },
      setMode: (mode) => {
        if (state.mode === mode) return;
        commit({ ...state, mode });
      },
    };

    ctx.provide('tech', service);
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.tech,
  name: 'ISLAND INDUSTRIA / Technology Tree',
  plugins: true,
  build: () =>
    ok({
      'plugin/tech': {
        kind: 'plugin',
        module: { specifier: './tech.pack.ts', export: 'techPlugin' },
      },
    }),
});
