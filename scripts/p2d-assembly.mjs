// M2.0-P2-D 真实游戏验收：组合机械（加工核心与结构组织）。
//
// 场景（每场独立搭建、结束后拆除，避免污染下一场）：
//   A 基础组合：两台独立核心 + 一个结构框架 → Assembly（成员/结构关系/整体边界）
//   B 多核心组合：三台核心 + 两个结构框架 → 一个含三成员的组合，成员身份独立
//   C 组合中实际生产：组合内部用 P2-C 的接口盒与 MaterialLink 传输物料，两台核心各自加工
//   D 机械动力共存：组合前后动力网络与驱动状态一致，整体需求只是成员额定扭矩求和
//   E 组合管理/整体选择：选中成员或结构模块识别所属 Assembly，单独核心仍可选、可读状态
//   F 拆解与恢复：拆结构框架解除组合、返还物品；实体 ID/加工进度/缓冲/接口/连接保持
//   G 成员旋转：1×1 核心旋转不改变组合边界，连接按 P2-C 规则失效/恢复，不产生空间数据不一致
//
// 全部操作走真实键鼠；断言只读唯一 GameRead `mechanical`（含 P2-D 的 assemblies 字段）。
// 拆分：入口 + 共享上下文 + 三个场景文件（单文件 20 KB 上限）。
import { createHarness } from './m18-helpers.mjs';
import { createP2dCtx } from './p2d-assembly-lib.mjs';
import { runSceneAB } from './p2d-assembly-scene-ab.mjs';
import { runSceneCDE } from './p2d-assembly-scene-cde.mjs';
import { runSceneFG } from './p2d-assembly-scene-fg.mjs';
import { enterLegacyMode } from './legacy-mode.mjs';

export default async function playthrough(play) {
  await enterLegacyMode(play);
  const h = createHarness(play);
  const C = createP2dCtx(play, h);
  await runSceneAB(play, h, C);
  await runSceneCDE(play, h, C);
  await runSceneFG(play, h, C);
}
