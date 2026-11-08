import type { ItemId } from '../items/items.ts';
import type { PortFlowGateway } from '../production/production-runtime.ts';
import { coreForPart } from './catalog.ts';
import type { PortSlotId } from './ids.ts';
import type { InstalledPort } from './port-runtime.ts';
import { feedsSlotFrom } from './port-slot-world.ts';

/**
 * P2-B/P2-C 物料流网关的**唯一实现**（纯函数组装，零引擎依赖）。
 *
 * 加工运行时只持有 `PortFlowGateway` 接口；本函数把「接口盒服务 + 物料连接运行时」
 * 装成那个接口。生产代码（mechanical/runtime.ts）与集成测试共用同一份实现，
 * 避免测试里另写一套行为——否则测的就不是游戏真正跑的那条路径。
 *
 * 规则：
 * - 自动输入只认**输入位**上的接口盒；
 * - 溜槽的输送方向必须正好从该安装位所在的面外侧推进来（`feedsSlotFrom`），
 *   相邻不够，方向也得对；
 * - 没有盒子 / 方向不对 / 盒子满了 → 返回 false，上游把物品留在自己那里（不吞不丢）；
 * - 自动输出只认**输出位**上的接口盒（P2-C）；
 * - 物料连接由 `stepLinks()` 推进，每次物流推进一次（P2-C）。
 */

/** 网关需要的最小接口盒能力（`PortRuntime` / `PortService` 都满足）。 */
export interface PortFlowSource {
  inputBoxesOf(partId: number): readonly InstalledPort[];
  outputBoxesOf(partId: number): readonly InstalledPort[];
  accept(partId: number, slotId: PortSlotId, itemId: ItemId): boolean;
  drain(partId: number, tryInsert: (itemId: ItemId) => boolean): number;
}

/** 物料连接推进器（`MaterialLinkRuntime` 的 step 绑定）。 */
export interface PortLinkStepper {
  step(): number;
}

export function createPortFlowGateway(
  ports: PortFlowSource,
  links?: PortLinkStepper,
): PortFlowGateway {
  return {
    acceptFromChute: (part, itemId, incoming) => {
      const core = coreForPart(part.def.id);
      if (!core) return false;
      for (const port of ports.inputBoxesOf(part.id)) {
        if (!feedsSlotFrom(port.slot, part.placement.rotation, incoming)) continue;
        return ports.accept(part.id, port.slot.id, itemId);
      }
      return false;
    },
    drain: (partId, tryInsert) => ports.drain(partId, tryInsert),
    outputBoxesOf: (partId) => ports.outputBoxesOf(partId).map((port) => ({ slotId: port.slot.id })),
    acceptInto: (partId, slotId, itemId) => ports.accept(partId, slotId as PortSlotId, itemId),
    stepLinks: () => links?.step() ?? 0,
  };
}
