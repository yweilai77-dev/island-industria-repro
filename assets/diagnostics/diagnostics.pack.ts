/**
 * M2.0-P2-E3 生产线诊断服务（T3.2 `line-diagnostics` 解锁的只读诊断）。
 *
 * 数据来源只有真实运行时快照：goalProgress 观测（机械动力/加工状态机/缓冲）、
 * `ports` 服务的接口盒与物料连接快照、`assembly` 服务的组合机械。
 * 不缓存第二份状态、不生成虚假运行状态；未解锁时返回 null。
 *
 * 本文件由 Lead 建立契约骨架，P2-E3 实施者填充实现。
 */
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import type {} from '../industrial/ports.ts';
import type {} from '../industrial/assembly-service.ts';
import type {} from '../goal/goal-service.ts';
import type {} from '../tech/tech.pack.ts';
import type { DiagnosticsSnapshot } from './diagnostics-types.ts';

export interface DiagnosticsService {
  revision(): number;
  /** 只读诊断快照；未解锁 `line-diagnostics` 或服务未就绪时返回 null。 */
  snapshot(): DiagnosticsSnapshot | null;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    diagnostics: DiagnosticsService;
  }
}

export const diagnosticsPlugin: Plugin = {
  name: 'island-industria/diagnostics',
  inject: ['world', 'tech'],
  apply(ctx) {
    let revision = 0;
    const service: DiagnosticsService = {
      revision: () => revision,
      snapshot: () => null,
    };
    revision += 0;
    ctx.provide('diagnostics', service);
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.diagnostics,
  name: 'ISLAND INDUSTRIA / Line Diagnostics',
  plugins: true,
  build: () =>
    ok({
      'plugin/diagnostics': {
        kind: 'plugin',
        module: { specifier: './diagnostics.pack.ts', export: 'diagnosticsPlugin' },
      },
    }),
});
