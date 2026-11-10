/**
 * 正式存档服务（P2 存档 P0/P1 范围内，科技进度与全部世界状态同一个快照）。
 *
 * 契约：持久化报告与 `docs/design/SAVE-ARCHITECTURE.md`。唯一权威快照，
 * 不建立第二套科技存档；失败/损坏逐条修复并上报，不进入半坏状态。
 *
 * 本文件由 Lead 建立契约骨架，P2-E3 持久化实施者填充实现。
 */
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';

export type PersistenceStatus = 'idle' | 'busy' | 'saved' | 'restored' | 'error';

export interface PersistenceSnapshot {
  readonly status: PersistenceStatus;
  /** 最近一次成功保存/读取的 ISO 时间；从未发生为 null。 */
  readonly savedAt: string | null;
  /** 人话状态（错误原因 / 修复记录摘要）。 */
  readonly message: string | null;
  /** 快照版本。 */
  readonly version: number;
  /** 是否存在可读取的存档。 */
  readonly hasSave: boolean;
}

export interface PersistenceService {
  revision(): number;
  snapshot(): PersistenceSnapshot;
  /** 立即保存（异步通道；回调式状态，不阻塞帧循环）。 */
  requestSave(): void;
  /** 从存档恢复（没有存档时保持初始状态并上报）。 */
  requestRestore(): void;
  /** 丢弃存档并从头开始（新游戏）。 */
  requestNewGame(): void;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    persistence: PersistenceService;
  }
}

const EMPTY: PersistenceSnapshot = {
  status: 'idle',
  savedAt: null,
  message: null,
  version: 0,
  hasSave: false,
};

export const persistencePlugin: Plugin = {
  name: 'island-industria/persistence',
  inject: ['world'],
  apply(ctx) {
    let revision = 0;
    const service: PersistenceService = {
      revision: () => revision,
      snapshot: () => EMPTY,
      requestSave: () => {},
      requestRestore: () => {},
      requestNewGame: () => {},
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
