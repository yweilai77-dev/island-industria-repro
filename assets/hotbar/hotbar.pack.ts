import { Update } from '@forgeax/engine/ecs';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import { HOTBAR_SLOT_COUNT, createHotbarService } from './hotbar.ts';

const SYSTEM_NAME = 'island-industria/hotbar-input';
const DIGIT_CODES = [
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8',
] as const;

/**
 * 快捷栏：8 个槽位、绑定/选中状态由 Engine 持有；
 * 数字键 1-8 选择槽位（背包打开时由前端处理并走 MessagePort）。
 */
export const hotbarPlugin: Plugin = {
  name: 'island-industria/hotbar',
  inject: ['world'],
  apply(ctx) {
    const world = ctx.world;
    const hotbar = createHotbarService();

    ctx.effect(function* () {
      yield ctx.provide('hotbar', hotbar);

      world
        .addSystem(Update, {
          name: SYSTEM_NAME,
          queries: [],
          fn: () => {
            const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
            if (!input) return;
            for (let index = 0; index < HOTBAR_SLOT_COUNT; index += 1) {
              const code = DIGIT_CODES[index];
              if (code !== undefined && input.keyboard.justPressedCode(code)) {
                hotbar.select(index);
                break;
              }
            }
          },
        })
        .unwrap();
      yield () => world.removeSystem(Update, SYSTEM_NAME).unwrap();
    }, 'island-industria/hotbar');
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.hotbar,
  plugins: true,
  build: () =>
    ok({
      'plugin/hotbar': {
        kind: 'plugin',
        module: { specifier: './hotbar.pack.ts', export: 'hotbarPlugin' },
      },
    }),
});