// M2.0-P2-E2 工作包 A 真实游戏验收：科技树玩家界面 + HUD 追踪卡 + 协议 v2。
//
// player 正式模式、从新游戏开始；不使用 __II_TEST_TECH__ / __II_TEST_ENDGAME__
// （脚本显式断言两个测试入口都不存在），所有科技交互都点真实 DOM 按钮。
//
// 覆盖任务书 §三 A1–A6：
//   A1 Tab 背包模态 + 科技页签；A2 12 节点/3 阶段/四态/前置/材料/解锁；
//   A3 逐项提交 + 一键交齐 + 防重复点击 + 错误码中文反馈；A4 追踪卡与订单 HUD 交接；
//   A5 协议 v2（tech/project/diagnostics/save 字段随状态下发）；
//   A6 1280×720 内面板/HUD 不越界（1280×600 由 project play 的 viewports 自动截图并检查 layout）。
//
// 拆分（单文件 < 20KB）：
//   p2e2-tech-ui-lib.mjs      DOM 读取/轮询/页签与按钮点击
//   p2e2-tech-ui-phase-a.mjs  步骤 00-04（启动/科技页/生产/订单 HUD 交接/T1.1 交付）
//   p2e2-tech-ui-phase-b.mjs  步骤 05-08（追踪卡/T1.2 交付/错误反馈/服务页与布局）
import { createHarness } from './m18-helpers.mjs';
import { createOrderKit } from './m20-order-lib.mjs';
import { createUiKit } from './p2e2-tech-ui-lib.mjs';
import { runTechUiPhaseA } from './p2e2-tech-ui-phase-a.mjs';
import { runTechUiPhaseB } from './p2e2-tech-ui-phase-b.mjs';

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  const h = createHarness(play);
  const kit = createOrderKit(play, h);
  const ui = createUiKit(play);
  await runTechUiPhaseA({ play, h, kit, ui });
  await runTechUiPhaseB({ play, h, kit, ui });
}
