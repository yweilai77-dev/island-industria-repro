import { Time, Update } from '@forgeax/engine/ecs';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import type { Plugin } from '@forgeax/engine/plugin';
import { PROPAGATE_TRANSFORMS_SYSTEM, Transform } from '@forgeax/engine/scene';
import type { GameProjectionValue } from '@forgeax/engine/app';
import type {} from '@forgeax/engine/assets-runtime';
import type {} from '../hotbar/hotbar.ts';
import { isMechanicalItem } from '../items/items.ts';
import { resolveSceneEntity } from '../shared/scene-refs.ts';
import { applyMachinePose, applySpin } from './animation.ts';
import type { MechanicalService } from './mechanical.pack.ts';
import { createMechanicalReadout, type ReadoutStatus } from './readout.ts';
import { MechanicalRuntimeState, sourceToggleTarget } from './runtime-state.ts';

const SYSTEM_NAME = 'island-industria/mechanical-runtime';

/**
 * M1.7-C runtime：
 * - 右键启停（悬停动力源优先，选中动力源兜底）；
 * - 只读 GameRead 投影；
 * - 每帧只做 revision 同步、必要解算、角度积分和 Transform 写入；
 * - 选中/悬停零件上方显示最小机械读数（RPM + 状态色）；
 * - 不创建/销毁机械实体，不修改 Registry/SpatialIndex/Inventory（读数牌是纯视图实体）。
 */
export const mechanicalRuntime: Plugin = {
  name: SYSTEM_NAME,
  inject: ['world', 'mechanical', 'hotbar', 'gameHost', 'assets', 'gameScene'],
  apply(ctx) {
    const world = ctx.world;
    const mechanical = ctx.mechanical;
    const hotbar = ctx.hotbar;
    const assets = ctx.assets;
    if (!assets) throw new Error('mechanical runtime requires asset service');
    const camera = resolveSceneEntity(world, ctx.gameScene, 'camera');

    ctx.effect(function* () {
      const state = new MechanicalRuntimeState();
      const readout = createMechanicalReadout(world, assets, camera);
      const unregisterRead = ctx.gameHost?.gameProjection?.registerRead({
        id: 'mechanical',
        title: 'Mechanical state',
        read: () => state.snapshot() as unknown as GameProjectionValue,
      });
      yield () => unregisterRead?.();

      const readoutStatus = (partId: number): ReadoutStatus => {
        if (state.isStalled(partId)) return 'stalled';
        if (state.omegaOf(partId) === 0) return 'idle';
        return state.speedFactorOf(partId) >= 0.999 ? 'running' : 'slowed';
      };

      world.addSystem(Update, {
        name: SYSTEM_NAME,
        // 必须在本帧 Transform 传播之前写入动画；mechanical 自己的输入系统在 propagate 之后。
        before: [PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          const parts = mechanical.parts();
          const connections = mechanical.connections();
          state.sync(mechanical.revision, parts, connections);

          const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
          const selectedItem = hotbar.slots[hotbar.selected] ?? null;
          if (isMechanicalItem(selectedItem) && input.mouse.justPressed(2)) {
            const target = sourceToggleTarget(parts, mechanical.hoveredPartId(), mechanical.selectedPartId());
            if (target !== undefined) state.toggleSource(target);
          }

          const delta = world.getResource(Time).delta;
          state.step(delta);

          for (const part of parts) {
            const view = mechanical.view(part.id);
            if (!view) continue; // 新建 view 允许晚一帧；已销毁 view 绝不写
            applySpin(world, view, part, state.angleOf(part.id));
            if (part.def.kind === 'machine') {
              applyMachinePose(world, view, state.poseOf(part.id));
            }
          }

          const targetId = mechanical.selectedPartId() ?? mechanical.hoveredPartId();
          const targetPart = targetId === undefined ? undefined : parts.find((part) => part.id === targetId);
          if (targetPart === undefined) {
            readout.update(undefined);
            return;
          }
          readout.update({
            omega: state.omegaOf(targetPart.id),
            status: readoutStatus(targetPart.id),
          });
        },
      }).unwrap();

      yield () => {
        world.removeSystem(Update, SYSTEM_NAME).unwrap();
        readout.dispose();
        state.clear();
      };
    }, SYSTEM_NAME);
  },
};
