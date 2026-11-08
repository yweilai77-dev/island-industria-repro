// M2.0-P2-B 验收：接口盒物品 → 真实安装位 → 自动输入（溜槽 → 接口盒 → 核心输入缓冲）
//
// 布局与已验收的 M1.8 产线一致（只多了一个接口盒）：
//   飞轮(-8,8) → 轴(-7,8) → 轴(-6,8) → 12T(-5,8) ┬→ 轴(-4,8) → 破碎机(-3,8)  产物出口(-2,8)
//                                                └→ 24T(-5,9) → 轴(-4,9) → 轴(-3,9) → 熔炼炉(-2,9)
//   锻压机支路：24T(-5,7) 与 12T(-5,8) 外啮合 → 轴(-4,7) → 轴(-3,7) → 锻压机(-2,7)
//
// 场景：
//   A 旧式人工生产（无接口盒、无溜槽，全程手动按 C / 右键）
//   B 制造接口盒（锻压机真实产出）→ 安装到熔炼炉输入安装位，背包减少、世界可见
//   C 自动输入（溜槽 → 接口盒 → 熔炼炉输入缓冲 → 真实熔炼）
//   D 新旧方式共存（同一台机器同时手动投料 + 自动输入，不重复）
//   E 拆卸与恢复（返还物品、连接解除、盒内物料交回、重装后自动输入恢复）
//   F 异常（安装位占用、溜槽断开、机器断电）
import { createHarness } from './m18-helpers.mjs';
import { createPortContext } from './p2b-ports-lib.mjs';
import { runAbc } from './p2b-ports-phase-abc.mjs';
import { runDef } from './p2b-ports-phase-def.mjs';

export default async function playthrough(play) {
  const h = createHarness(play);
  const C = createPortContext(play, h);
  await runAbc(play, h, C);
  await runDef(play, h, C);
}
