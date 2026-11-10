// 正式 UI 桥接：Browser UI <-> Engine Worker 的 MessagePort 协议端点。
import type {} from '@forgeax/engine/app';
import { Update } from '@forgeax/engine/ecs';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import { getItemDefinition, itemDefinitions, type ItemId } from '../items/items.ts';
import {
  UI_PROTOCOL_VERSION,
  buildStateMessage,
  collectTotals,
  parseUiCommand,
  stateSignature,
  type UiErrorMessage,
  type UiHelloFlags,
  type UiStateMessage,
} from './protocol.ts';
import type { TechSnapshot } from '../tech/types.ts';
import type { EndgameSnapshot } from '../endgame/endgame-types.ts';
import type { DiagnosticsSnapshot } from '../diagnostics/diagnostics-types.ts';
import type { PersistenceSnapshot } from '../save/persistence.pack.ts';
import { buildGoalView, goalViewSignature, type UiGoalState } from './goal-view.ts';
import { attachSaveTransport, forwardSaveCommand, readSaveSnapshot, type PersistenceServiceLike } from './save-bridge.ts';
import { diagnosticsSignature, projectSignature, saveSignature } from './panel-signatures.ts';

const SYSTEM_NAME = 'island-industria/game-ui-bridge';

/**
 * Engine 侧 UI 桥接插件：
 * - 维护库存/快捷栏的权威状态；
 * - 通过 executionBootstrapHost.port 接收前端命令并回发状态快照；
 * - 每帧检测库存/快捷栏变化（含数字键选择），并自动解除零库存绑定；
 * - 暂停期间帧循环停止，但端口事件仍可处理（Spike 已验证）。
 */
export const gameUiBridge: Plugin = {
  name: 'island-industria/game-ui-bridge',
  inject: ['world', 'inventory', 'hotbar', 'executionBootstrapHost'],
  apply(ctx) {
    const world = ctx.world;
    const inventory = ctx.inventory;
    const hotbar = ctx.hotbar;
    const port = ctx.executionBootstrapHost.port;

    if (!port) {
      console.error('M1.4: executionBootstrapHost.port is missing; inventory UI will not sync');
      return;
    }

    let revision = 0;
    let lastSignature = '';

    const definitions = itemDefinitions();
    const countOf = (itemId: ItemId): number => inventory.count(itemId);

    // 目标进度服务由机械运行时稍后提供：按需读取，不做注入，避免打乱插件挂载顺序。
    // 读取失败只影响订单面板（显示初始化态），绝不让 UI 故障打断机械/生产运行时。
    const readGoal = (): UiGoalState | null => {
      try {
        return buildGoalView(ctx.get('goalProgress')?.snapshot());
      } catch (error) {
        console.error('M2.0: failed to read goal progress', error);
        return null;
      }
    };
    // P2-E1：科技快照随状态一起下发（E1 只读；E2 科技页复用同一字段）。
    const readTech = (): TechSnapshot | null => {
      try {
        return ctx.get('tech')?.snapshot() ?? null;
      } catch (error) {
        console.error('M2.0: failed to read tech snapshot', error);
        return null;
      }
    };
    const techRevision = (): number => ctx.get('tech')?.revision() ?? -1;
    // P2-E2/E3：终局联合工厂、产线诊断、正式存档的只读快照。
    // 与 readGoal/readTech 同样的边界：服务缺失/抛错只让该字段为 null，绝不打断 UI 或帧循环。
    const readProject = (): EndgameSnapshot | null => {
      try {
        return ctx.get('endgame')?.snapshot() ?? null;
      } catch (error) {
        console.error('P2-E2: failed to read endgame snapshot', error);
        return null;
      }
    };
    const readDiagnostics = (): DiagnosticsSnapshot | null => {
      try {
        return ctx.get('diagnostics')?.snapshot() ?? null;
      } catch (error) {
        console.error('P2-E2: failed to read diagnostics snapshot', error);
        return null;
      }
    };
    const persistenceService = (): PersistenceServiceLike | null => {
      try {
        return (ctx.get('persistence') as unknown as PersistenceServiceLike | undefined) ?? null;
      } catch {
        return null;
      }
    };
    const readSave = (): PersistenceSnapshot | null => {
      try {
        return readSaveSnapshot(persistenceService());
      } catch (error) {
        console.error('P2-E2: failed to read persistence snapshot', error);
        return null;
      }
    };
    const signatureOfState = (
      goal: UiGoalState | null,
      project: EndgameSnapshot | null,
      diagnostics: DiagnosticsSnapshot | null,
      save: PersistenceSnapshot | null,
    ): string =>
      stateSignature(definitions, countOf, hotbar.revision)
      + '|' + goalViewSignature(goal)
      + '|tech:' + String(techRevision())
      + '|' + projectSignature(project)
      + '|' + diagnosticsSignature(diagnostics)
      + '|' + saveSignature(save);

    // 存档下行通道：服务在桥接之后才挂载，apply 时先试一次，之后每帧重试一次（同 pendingFlags）。
    const postToFrontend = (message: unknown): void => {
      try {
        port.postMessage(message);
      } catch (error) {
        console.error('P2-E2: failed to post save channel message', error);
      }
    };
    let persistenceAttached = false;
    const attachPersistence = (): void => {
      if (persistenceAttached) return;
      try {
        if (attachSaveTransport(persistenceService(), postToFrontend)) persistenceAttached = true;
      } catch (error) {
        console.error('P2-E2: failed to attach persistence transport', error);
      }
    };
    attachPersistence();

    /** hello 携带的测试启动标志：legacy 兼容模式（只由验收脚本通过前端 flags 设置）。 */
    let pendingFlags: UiHelloFlags | null = null;
    const applyFlags = (flags: UiHelloFlags | undefined): void => {
      if (flags === undefined) return;
      pendingFlags = flags;
      const tech = ctx.get('tech');
      if (!tech) return; // 服务未就绪时留到下一帧重试（见 Update 系统）
      if (flags.progression === 'legacy') tech.setMode('legacy');
      else if (flags.progression === 'player') tech.setMode('player');
      pendingFlags = null;
    };

    const sendState = (): void => {
      revision += 1;
      const goal = readGoal();
      const project = readProject();
      const diagnostics = readDiagnostics();
      const save = readSave();
      const message: UiStateMessage = buildStateMessage({
        revision,
        definitions,
        totals: collectTotals(definitions, countOf),
        slots: hotbar.slots,
        selected: hotbar.selected,
        goal,
        tech: readTech(),
        project,
        diagnostics,
        save,
      });
      lastSignature = signatureOfState(goal, project, diagnostics, save);
      try {
        port.postMessage(message);
      } catch (error) {
        console.error('M1.4: failed to post UI state', error);
      }
    };

    const sendError = (code: string, message: string): void => {
      const payload: UiErrorMessage = { v: UI_PROTOCOL_VERSION, type: 'error', code, message };
      try {
        port.postMessage(payload);
      } catch (error) {
        console.error('M1.4: failed to post UI error', error);
      }
    };

    port.start?.();
    port.onmessage = (event: MessageEvent<unknown>) => {
      const parsed = parseUiCommand(event.data);
      if (!parsed.ok) {
        sendError(parsed.code, parsed.message);
        return;
      }
      const command = parsed.command;
      try {
        switch (command.type) {
          case 'hello':
            applyFlags(command.flags);
            sendState();
            return;
          case 'state/request':
            sendState();
            return;
          case 'tech/submit': {
            const tech = ctx.get('tech');
            if (!tech) {
              sendError('tech-unavailable', 'technology service is not ready');
              return;
            }
            const result = tech.submit(command.nodeId, command.itemId, command.count);
            if (!result.ok) sendError(result.code, `tech submit rejected: ${result.code}`);
            sendState();
            return;
          }
          case 'tech/submit-all': {
            const tech = ctx.get('tech');
            if (!tech) {
              sendError('tech-unavailable', 'technology service is not ready');
              return;
            }
            const result = tech.submitAll(command.nodeId);
            if (!result.ok) sendError(result.code, `tech submit-all rejected: ${result.code}`);
            sendState();
            return;
          }
          case 'tech/track': {
            const tech = ctx.get('tech');
            if (!tech) {
              sendError('tech-unavailable', 'technology service is not ready');
              return;
            }
            if (!tech.track(command.nodeId)) sendError('unknown-node', 'unknown tech node');
            sendState();
            return;
          }
          // P2-E2/E3：终局运行证明。服务缺失/失败都回 error 消息，UI 按 code 给中文反馈。
          case 'project/proof/begin': {
            const endgame = ctx.get('endgame');
            if (!endgame) {
              sendError('project-unavailable', 'endgame service is not ready');
              return;
            }
            const result = endgame.beginProof();
            if (!result.ok) sendError(result.code, `proof begin rejected: ${result.code}`);
            sendState();
            return;
          }
          case 'project/proof/cancel': {
            const endgame = ctx.get('endgame');
            if (!endgame) {
              sendError('project-unavailable', 'endgame service is not ready');
              return;
            }
            endgame.cancelProof();
            sendState();
            return;
          }
          // P2-E2：正式存档通道（下行 save/write|read|clear 由 persistence 服务经 transport 发出）。
          case 'save/request':
          case 'save/restore':
          case 'save/new':
          case 'save/data': {
            const outcome = forwardSaveCommand(persistenceService(), command);
            if (outcome.error) sendError(outcome.error.code, outcome.error.message);
            sendState();
            return;
          }
          case 'hotbar/select':
            hotbar.select(command.slot);
            sendState();
            return;
          case 'hotbar/unbind':
            hotbar.unbind(command.slot);
            sendState();
            return;
          case 'hotbar/bind': {
            const definition = getItemDefinition(command.itemId);
            if (definition === undefined) {
              sendError('unknown-item', `unknown item id: ${command.itemId}`);
              return;
            }
            if (inventory.count(command.itemId) <= 0) {
              sendError('item-unavailable', `item is not available: ${command.itemId}`);
              return;
            }
            hotbar.bind(command.slot, command.itemId);
            sendState();
            return;
          }
          default:
            sendError('unknown-command', 'unsupported command');
        }
      } catch (error) {
        console.error('M1.4: bridge command failed', error);
        sendError('command-failed', error instanceof Error ? error.message : String(error));
      }
    };

    ctx.effect(function* () {
      // 库存变化后自动解除零数量绑定，并把新状态同步给 UI。
      world
        .addSystem(Update, {
          name: SYSTEM_NAME,
          queries: [],
          fn: () => {
            // 测试启动标志可能在 tech 服务就绪前到达：每帧重试一次。
            if (pendingFlags !== null) applyFlags(pendingFlags ?? undefined);
            // 存档服务在桥接之后挂载：attach 成功前每帧重试一次。
            if (!persistenceAttached) attachPersistence();
            hotbar.dropUnavailable((itemId) => inventory.count(itemId));
            const goal = readGoal();
            const signature = signatureOfState(goal, readProject(), readDiagnostics(), readSave());
            if (signature !== lastSignature) sendState();
          },
        })
        .unwrap();
      yield () => world.removeSystem(Update, SYSTEM_NAME).unwrap();
      yield () => {
        port.onmessage = null;
      };
    }, SYSTEM_NAME);
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.gameUiBridge,
  plugins: true,
  build: () =>
    ok({
      'plugin/game-ui-bridge': {
        kind: 'plugin',
        module: { specifier: './bridge.pack.ts', export: 'gameUiBridge' },
      },
    }),
});
