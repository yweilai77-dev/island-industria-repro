/**
 * M2.0-P2-E3 终局联合工厂服务（交付进度 + 运行证明）。
 *
 * 契约：`endgame-types.ts`；纯逻辑：`endgame.ts`。
 *
 * 数据来源只有真实运行时快照：
 * - `goalProgress.observation()`：每台加工机器的 producedTotal 与每个零件的 powered；
 * - `ports`：已装接口盒（输出安装位）与 MaterialLink 实时状态；
 * - `assembly`：组合机械成员；
 * - `tech`：T3.3 节点的成套交付进度。
 *
 * 本服务**不**写完成标记：proof 转为 passed 后调用 tech 的 `completeProjectNode`，
 * 并把「运行证明是否通过」注册为 tech 的项目完成守卫。因此：
 * - 运行证明与物品交付是两个独立条件；
 * - 直接 `tech/submit` 永远无法解锁项目节点（只有 completeProjectNode 可以）；
 * - `beginProof` 不扣任何材料。
 */
import { Time, Update } from '@forgeax/engine/ecs';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/assets-runtime';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import type {} from '../tech/tech.pack.ts';
import type {} from '../industrial/ports.ts';
import type {} from '../industrial/assembly-service.ts';
import type {} from '../goal/goal-service.ts';
import type { EndgameSnapshot } from './endgame-types.ts';
import {
  ENDGAME_NODE_ID,
  ENDGAME_PROJECT_ID,
  EMPTY_TECH_SNAPSHOT,
  EndgameProof,
  buildEndgameSnapshot,
  type EndgameAssemblyView,
  type EndgamePersistedState,
  type EndgameWorldView,
} from './endgame.ts';

const SYSTEM_NAME = 'island-industria/endgame';
/** 终局投影/证明窗口的更新间隔（秒）：0.2 s 对 60 s 观察窗口足够，且避免每帧重建拖慢输入。 */
const ENDGAME_UPDATE_INTERVAL = 0.2;

export interface BeginProofResult {
  readonly ok: boolean;
  readonly code: 'ok' | 'not-unlocked' | 'already-running' | 'already-completed' | 'delivery-incomplete' | 'unavailable';
}

export interface EndgameRestoreResult {
  readonly repaired: boolean;
  readonly issues: readonly string[];
}

export interface EndgameService {
  revision(): number;
  snapshot(): EndgameSnapshot;
  /** 开始运行证明观察窗口（例如 60 秒）；不扣任何材料。 */
  beginProof(): BeginProofResult;
  /** 中止进行中的观察窗口（已通过的证明不会被取消）。 */
  cancelProof(): void;
  /** 序列化边界：纯 JSON（保存窗口状态/基线/上次结论，不存派生量）。 */
  serialize(): EndgamePersistedState;
  /** 从不可信数据恢复（幂等；修复记录随返回值上报）。 */
  restore(raw: unknown): EndgameRestoreResult;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    endgame: EndgameService;
  }
}

const EMPTY_VIEW: EndgameWorldView = {
  assemblies: [],
  machines: [],
  outputPortPartIds: [],
  links: [],
};

export const endgamePlugin: Plugin = {
  name: SYSTEM_NAME,
  inject: ['world', 'tech'],
  apply(ctx) {
    const world = ctx.world;
    const tech = ctx.tech;
    const proof = new EndgameProof();

    let revision = 0;
    let lastCompleted = false;
    let proofClock = 0;
    const readTech = () => {
      try {
        return tech.snapshot();
      } catch {
        return EMPTY_TECH_SNAPSHOT;
      }
    };

    /** 从真实服务快照映射只读世界视图（任何服务缺失都退化为空，不影响其它系统）。 */
    const readView = (): EndgameWorldView => {
      let assemblies: readonly EndgameAssemblyView[] = [];
      try {
        assemblies = (ctx.get('assembly')?.snapshot() ?? []).map((assembly) => ({
          id: assembly.id,
          memberIds: [...assembly.memberIds],
        }));
      } catch {
        assemblies = [];
      }
      let machines: EndgameWorldView['machines'] = [];
      try {
        const observation = ctx.get('goalProgress')?.observation();
        const powered = new Map((observation?.parts ?? []).map((part) => [part.partId, part.powered]));
        machines = (observation?.machines ?? []).map((machine) => ({
          partId: machine.partId,
          producedTotal: machine.producedTotal,
          powered: powered.get(machine.partId) === true,
        }));
      } catch {
        machines = [];
      }
      const outputPortPartIds: number[] = [];
      let links: EndgameWorldView['links'] = [];
      try {
        const ports = ctx.get('ports');
        if (ports) {
          const seen = new Set<number>();
          for (const assembly of assemblies) {
            for (const partId of assembly.memberIds) {
              if (seen.has(partId)) continue;
              seen.add(partId);
              const installed = ports.installedOf(partId);
              if (installed.some((port) => port.slot.role === 'output')) outputPortPartIds.push(partId);
            }
          }
          links = ports.links().map((link) => ({
            fromPartId: link.from.entityId,
            toPartId: link.to.entityId,
            active: link.active,
          }));
        }
      } catch {
        links = [];
      }
      return { assemblies, machines, outputPortPartIds, links };
    };

    let cached: EndgameSnapshot = buildEndgameSnapshot(EMPTY_TECH_SNAPSHOT, proof.snapshotOf(EMPTY_VIEW));

    /** 重新派生缓存并处理完成态变化（完成态变化也要 revision+1）。 */
    const refresh = (techSnapshot: ReturnType<typeof readTech> = readTech()): boolean => {
      cached = buildEndgameSnapshot(techSnapshot, proof.snapshotOf(readView()));
      if (cached.completed !== lastCompleted) {
        lastCompleted = cached.completed;
        return true;
      }
      return false;
    };

    /** 证明通过后重试项目结算（幂等；覆盖「先过证明后交齐」与读档恢复）。 */
    const retryCompletion = (techSnapshot: ReturnType<typeof readTech>): boolean => {
      if (!proof.passed()) return false;
      const node = techSnapshot.nodes.find((entry) => entry.id === ENDGAME_NODE_ID);
      if (node === undefined || node.status === 'completed') return false;
      const delivered = node.cost.every((entry) => (node.delivered[entry.itemId] ?? 0) >= entry.count);
      if (!delivered) return false;
      try {
        return tech.completeProjectNode(ENDGAME_NODE_ID).ok;
      } catch {
        return false;
      }
    };

    // 运行证明是项目节点的完成守卫：未通过时 completeProjectNode 被拒绝。
    tech.setProjectCompletionGuard((projectId) => (
      projectId === ENDGAME_PROJECT_ID ? proof.completionBlocker() : null
    ));

    const service: EndgameService = {
      revision: () => revision,
      snapshot: () => cached,
      beginProof: () => {
        const techSnapshot = readTech();
        const node = techSnapshot.nodes.find((entry) => entry.id === ENDGAME_NODE_ID);
        if (node === undefined) return { ok: false, code: 'unavailable' };
        if (node.status === 'completed') return { ok: false, code: 'already-completed' };
        if (node.status === 'locked') return { ok: false, code: 'not-unlocked' };
        const outcome = proof.begin(readView());
        if (outcome === 'already-running') return { ok: false, code: 'already-running' };
        // 已通过的证明是终态（等待交付结算），不能再开新窗口。
        if (outcome === 'already-passed') return { ok: false, code: 'already-completed' };
        revision += 1;
        refresh(techSnapshot);
        return { ok: true, code: 'ok' };
      },
      cancelProof: () => {
        if (!proof.cancel()) return;
        revision += 1;
        refresh();
      },
      serialize: () => proof.serialize(),
      restore: (raw) => {
        const outcome = proof.restore(raw);
        revision += 1;
        refresh();
        return { repaired: outcome.repaired, issues: outcome.issues };
      },
    };

    ctx.provide('endgame', service);

    ctx.effect(function* () {
      world.addSystem(Update, {
        name: SYSTEM_NAME,
        queries: [],
        fn: () => {
          // 性能：只读投影不需要每帧重建；窗口计时用累计 delta（精度 0.2 s 对 60 s 窗口足够），
          // 降低投影重建频率避免拖慢真实输入/拾取链路。
          proofClock += world.getResource(Time).delta;
          if (proofClock < ENDGAME_UPDATE_INTERVAL) return;
          const step = proofClock;
          proofClock = 0;
          const view = readView();
          const tick = proof.tick(step, view);
          let changed = tick.changed;
          const techSnapshot = readTech();
          if (retryCompletion(techSnapshot)) changed = true;
          if (refresh(techSnapshot)) changed = true;
          if (changed) revision += 1;
        },
      }).unwrap();
      yield () => world.removeSystem(Update, SYSTEM_NAME).unwrap();
    }, SYSTEM_NAME);
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