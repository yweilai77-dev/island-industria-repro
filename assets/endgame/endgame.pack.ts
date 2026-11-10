/**
 * M2.0-P2-E3 终局联合工厂服务（交付进度 + 运行证明）。
 *
 * 契约：`endgame-types.ts`。只读派生 + 观察窗口累积，不写入任何完成标记；
 * 项目节点完成由 tech 服务在「全部材料已交付 + 运行证明通过」后正式提交。
 *
 * 本文件由 Lead 建立契约骨架，P2-E3 实施者填充实现。
 */
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import type {} from '../tech/tech.pack.ts';
import type {} from '../industrial/ports.ts';
import type {} from '../industrial/assembly-service.ts';
import type {} from '../goal/goal-service.ts';
import type { EndgameSnapshot } from './endgame-types.ts';

export interface BeginProofResult {
  readonly ok: boolean;
  readonly code: 'ok' | 'not-unlocked' | 'already-running' | 'already-completed' | 'delivery-incomplete' | 'unavailable';
}

export interface EndgameService {
  revision(): number;
  snapshot(): EndgameSnapshot;
  /** 开始运行证明观察窗口（例如 60 秒）；不扣任何材料。 */
  beginProof(): BeginProofResult;
  cancelProof(): void;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    endgame: EndgameService;
  }
}

const EMPTY: EndgameSnapshot = {
  projectId: 'combined-works',
  completed: false,
  unlocked: false,
  delivery: { entries: [], totalRequired: 0, totalDelivered: 0, complete: false },
  proof: {
    state: 'idle',
    elapsedSeconds: 0,
    durationSeconds: 60,
    produced: 0,
    target: 12,
    conditions: [],
    failureReason: null,
  },
  blocks: [],
};

export const endgamePlugin: Plugin = {
  name: 'island-industria/endgame',
  inject: ['world', 'tech'],
  apply(ctx) {
    let revision = 0;
    const service: EndgameService = {
      revision: () => revision,
      snapshot: () => EMPTY,
      beginProof: () => ({ ok: false, code: 'unavailable' }),
      cancelProof: () => {},
    };
    ctx.provide('endgame', service);
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.endgame,
  name: 'ISLAND INDUSTRIA / Combined Works',
  plugins: true,
  build: () =>
    ok({
      'plugin/endgame': {
        kind: 'plugin',
        module: { specifier: './endgame.pack.ts', export: 'endgamePlugin' },
      },
    }),
});
