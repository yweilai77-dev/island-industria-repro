// M2.0-P2-E3 存档/读档端到端验收（真实键鼠，不用任何测试后门搭世界）。
//
// 验收目标（任务书 P2-E3 工作包 E）：
//   1) 真实搭一小段工厂 + 交付一个科技节点 + 放 1 个普通建筑；
//   2) 手动保存 -> 校验存档 JSON 与当前真实世界一致、体积受限；
//   3) play.reload() -> 启动自动恢复；
//   4) 库存 / 建筑 / 零件 / 科技进度 / 矿量 / 玩家位置逐项一致；
//   5) 不重复发放起步包、不重复扣矿、零件 id 不重复、恢复后世界仍可运行。
//
// 文件拆分（守住 20KB 提交限制）：本文件只编排；共用辅助在 p2e3-save-lib.mjs，
// 第一段在 p2e3-save-reload-phase-a.mjs，第二段在 p2e3-save-reload-phase-b.mjs。
//
// 注意：本脚本只由 Lead 串行运行（play 是 machine-wide 单例）。
import { createHarness } from './m18-helpers.mjs';
import { createOrderKit } from './m20-order-lib.mjs';
import { createSaveHelpers } from './p2e3-save-lib.mjs';
import { runPhaseA } from './p2e3-save-reload-phase-a.mjs';
import { runPhaseB } from './p2e3-save-reload-phase-b.mjs';

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  const h = createHarness(play);
  const kit = createOrderKit(play, h);
  const helpers = createSaveHelpers(play, kit);
  const { saved } = await runPhaseA({ play, h, kit, helpers });
  await runPhaseB({ play, kit, helpers, saved });
}
