// M2.0-P2-C 真实游戏验收：核心间物料连接与内部物流。
//
// 布局与场景（每个场景独立搭建、结束后拆除，保证前一场不污染后一场）：
//   A 两核心直接对接：破碎机(输出盒) → 物料连接 → 熔炼炉(输入盒) → 自动熔炼
//   D 断链/重连：断开后物料停在缓冲、重建后继续
//   E 旋转核心与拆卸接口：端口位置/朝向跟随，连接失效与恢复，拆盒返还物料
//   B 双路合流：两台破碎机 → 合流盒 → 一台熔炼炉；下游停转时缓冲阻塞、零丢失
//   C 一路分流：一台破碎机 → 分流盒 → 两台熔炼炉；轮询 3/3，断一路后全走另一路
//   F 三级生产线：破碎机 → 熔炼炉 → 锻压机，真实产出传动轴；并在锻压机上制造输出接口盒
//
// 全部操作走真实键鼠；断言只读唯一 GameRead `mechanical`（含 P2-C 的 links 字段）。
// 拆分：入口 + 共享上下文 + 两个场景文件（单文件 20 KB 上限）。
import { createHarness } from './m18-helpers.mjs';
import { createCtx } from './p2c-links-lib.mjs';
import { runSceneA } from './p2c-links-scene-a.mjs';
import { runSceneB, runSceneC, runSceneF } from './p2c-links-scene-bcf.mjs';
import { enterLegacyMode } from './legacy-mode.mjs';

export default async function playthrough(play) {
  await enterLegacyMode(play);
  const h = createHarness(play);
  const C = createCtx(play, h);
  await runSceneA(play, h, C);
  await runSceneB(play, h, C);
  await runSceneC(play, h, C);
  await runSceneF(play, h, C);
}
