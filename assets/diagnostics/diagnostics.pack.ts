/**
 * M2.0-P2-E2 生产线诊断服务（T3.2 `line-diagnostics` 解锁的只读诊断）。
 *
 * 数据来源只有真实运行时快照：`goalProgress` 观测（动力/加工状态机/缓冲/产出）、
 * `ports` 服务的接口盒缓冲与物料连接、`assembly` 的组合成员。
 * 不缓存第二份状态、不生成虚假运行状态；未解锁时 snapshot() 返回 **null**。
 *
 * 契约：`diagnostics-types.ts`；纯逻辑：`diagnostics.ts`（零引擎依赖、可单测）。
 */
import { Update } from '@forgeax/engine/ecs';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import type {} from '../industrial/ports.ts';
import type {} from '../industrial/assembly-service.ts';
import type {} from '../goal/goal-service.ts';
import type {} from '../tech/tech.pack.ts';
import { diagnosticsSnapshot, type DiagnosticsSource } from './diagnostics.ts';
import type { DiagnosticsSnapshot } from './diagnostics-types.ts';

export interface DiagnosticsService {
  /** 解锁后每帧 +1（未解锁时不递增：没有诊断数据就没有新版本）。 */
  revision(): number;
  /** 只读诊断快照；未解锁 `line-diagnostics` 或服务未就绪时返回 null。 */
  snapshot(): DiagnosticsSnapshot | null;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    diagnostics: DiagnosticsService;
  }
}

const SYSTEM_NAME = 'island-industria/diagnostics';
/** 必须晚于机械运行时：后者每帧刷新 goalProgress 观测（本系统只读它的当帧结果）。 */
const AFTER_SYSTEM = 'island-industria/mechanical-runtime';

export const diagnosticsPlugin: Plugin = {
  name: SYSTEM_NAME,
  inject: ['world', 'tech', 'ports', 'assembly'],
  apply(ctx) {
    const world = ctx.world;
    const tech = ctx.tech;
    ctx.effect(function* () {
      let revision = 0;
      let latest: DiagnosticsSnapshot | null = null;
      yield ctx.provide('diagnostics', {
        revision: () => revision,
        snapshot: () => latest,
      });

      world.addSystem(Update, {
        name: SYSTEM_NAME,
        after: [AFTER_SYSTEM],
        queries: [],
        fn: () => {
          // 门控在业务入口：未解锁时不构造任何诊断（snapshot 保持 null）。
          if (!tech.hasCapability('line-diagnostics')) {
            latest = null;
            return;
          }
          const goal = ctx.get('goalProgress');
          if (!goal) {
            latest = null;
            return;
          }
          const source: DiagnosticsSource = {
            observation: goal.observation(),
            ports: ctx.ports.snapshot(),
            links: ctx.ports.links(),
            assemblies: ctx.assembly.snapshot(),
          };
          latest = diagnosticsSnapshot(source, true);
          revision += 1;
        },
      }).unwrap();

      yield () => {
        world.removeSystem(Update, SYSTEM_NAME).unwrap();
        latest = null;
      };
    }, SYSTEM_NAME);
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