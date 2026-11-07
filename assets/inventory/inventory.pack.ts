import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import { createInventoryService } from './inventory.ts';

/** 统一库存服务：当前只注册铁矿石，规则见 inventory.ts。 */
export const playerInventory: Plugin = {
  name: 'island-industria/inventory',
  apply(ctx) {
    ctx.effect(function* () {
      yield ctx.provide('inventory', createInventoryService());
    }, 'island-industria/inventory');
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.inventory,
  name: 'ISLAND INDUSTRIA / Inventory',
  plugins: true,
  build: () =>
    ok({
      'plugin/inventory': {
        kind: 'plugin',
        module: { specifier: './inventory.pack.ts', export: 'playerInventory' },
      },
    }),
});