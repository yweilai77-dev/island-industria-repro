import { definePack } from '@forgeax/engine/pack/source';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';

// M1.4 前端 root：正式背包与快捷栏 UI 资产。
export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.frontend,
  plugins: true,
  build: () =>
    ok({
      'plugin/frontend': {
        kind: 'plugin',
        module: { specifier: './frontend-ui.ts', export: 'frontendUi' },
      },
    }),
});