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
  type UiStateMessage,
} from './protocol.ts';
import { buildGoalView, goalViewSignature, type UiGoalState } from './goal-view.ts';

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
    const signatureWithGoal = (goal: UiGoalState | null): string =>
      stateSignature(definitions, countOf, hotbar.revision) + '|' + goalViewSignature(goal);

    const sendState = (): void => {
      revision += 1;
      const goal = readGoal();
      const message: UiStateMessage = buildStateMessage({
        revision,
        definitions,
        totals: collectTotals(definitions, countOf),
        slots: hotbar.slots,
        selected: hotbar.selected,
        goal,
      });
      lastSignature = signatureWithGoal(goal);
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
          case 'state/request':
            sendState();
            return;
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
            hotbar.dropUnavailable((itemId) => inventory.count(itemId));
            const goal = readGoal();
            const signature = signatureWithGoal(goal);
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
