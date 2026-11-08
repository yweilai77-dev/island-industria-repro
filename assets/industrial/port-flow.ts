import type { PortFlowGateway } from '../production/production-runtime.ts';
import { coreForPart } from './catalog.ts';
import { feedsSlotFrom } from './port-slot-world.ts';
import type { PortService } from './ports.ts';

/**
 * P2-B 物料流网关的**唯一实现**（纯函数组装，零引擎依赖）。
 *
 * 加工运行时只持有 `PortFlowGateway` 接口；本函数把「接口盒服务」装成那个接口。
 * 生产代码（mechanical/runtime.ts）与集成测试共用同一份实现，避免测试里另写一套
 * 行为——否则测的就不是游戏真正跑的那条路径。
 *
 * 规则：
 * - 自动输入只认**输入位**上的接口盒；
 * - 溜槽的输送方向必须正好从该安装位所在的面外侧推进来（`feedsSlotFrom`），
 *   相邻不够，方向也得对；
 * - 没有盒子 / 方向不对 / 盒子满了 → 返回 false，上游把物品留在自己那里（不吞不丢）。
 */
export function createPortFlowGateway(ports: PortService): PortFlowGateway {
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
  };
}
