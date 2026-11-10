// M2.0-P1-D 第一份工业订单端到端 Playthrough（真实游戏 UI + 真实生产数据）。
//
// 完整八步：采集 → 建机器 → 接动力 → 启动 → 破碎 → 熔炼 → 锻压 → 订单完成。
// 所有操作走真实键鼠事件；HUD 断言读真实 DOM，生产证据只读 GameRead(mechanical) 的
// production.produced 相对订单开始基线的增量；不伪造、不用库存/机器状态代替产量。
//
// 分段实现（单个代码文件 ≤20KB）：
//   m20-order-lib.mjs      共用 HUD/状态读取、等待与补储、证据快照
//   m20-order-phase-a.mjs  步骤 01-06（采集/建机/接动力/启动/破碎）
//   m20-order-phase-b.mjs  步骤 07-11（熔炼/动力中断恢复/拆机重建/锻压完成/终局核对）
import { createHarness } from './m18-helpers.mjs';
import { createOrderKit } from './m20-order-lib.mjs';
import { runOrderPhaseA } from './m20-order-phase-a.mjs';
import { runOrderPhaseB } from './m20-order-phase-b.mjs';
import { enterLegacyMode } from './legacy-mode.mjs';

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  await enterLegacyMode(play);
  const h = createHarness(play);
  const kit = createOrderKit(play, h);
  await runOrderPhaseA(kit);
  await runOrderPhaseB(kit);
}
