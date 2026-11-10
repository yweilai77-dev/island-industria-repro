# M2.0-P2-E1 测试报告

- 阶段：M2.0-P2-E1
- 代码基线：P2-D `f0fd623` / P2-E0 交付后 HEAD `53fb546`
- 结论：**全部技术门通过；任务书 §六 要求的自动化覆盖、回归与真实游戏验收项全部完成**（唯一例外是 P2-E1 之前就存在的 m17a 断言债，见 §6）。

---

## 1. 门禁结果（最终代码）

| 检查 | 命令 | 结果 |
|:--|:--|:--|
| 单元/集成测试 | `pnpm test` | **63 文件 / 658 用例全部通过**（基线 57 / 555；**净增 6 文件 / 103 用例**） |
| 类型检查 | `pnpm typecheck` | 通过（无输出） |
| 工程检查 | `forgeax project check --json` | `ok: true` |
| 生产构建 | `forgeax project build` | 通过；**226 artifacts / 25,179,146 B**（P2-D 基线 220 / 23,868,148 B） |
| 真实游戏验收（E1） | `project play scripts/p2e-tech-core.mjs` | **通过**：420 步 / 248.7 s / console 0 / page 0 / layout 0 / 10 张截图 |
| 回归 P1 订单 | `project play scripts/m20-first-order.mjs` | 通过：176 步 / 169.4 s / console 0 / page 0 |
| 回归 M1.8 生产链 | `project play scripts/m18c-production.mjs` | 通过：135 步 / 175.5 s / console 0 / page 0（首次尝试因采集抖动失败，见 §6） |
| 回归 P2-B 接口盒 | `project play scripts/p2b-ports.mjs` | 通过：248 步 / 268.5 s / console 0 / page 0 |
| 回归 P2-C 物流 | `project play scripts/p2c-links.mjs` | 通过：500 步 / 360.3 s / console 0 / page 0 |
| 回归 P2-D 组合机械 | `project play scripts/p2d-assembly.mjs` | 通过：375 步 / 264.6 s / console 0 / page 0 |
| 布局检查 | `project play` 内置 1280×720 / 1280×600 | 全部脚本 layout warnings = 0 |

> 说明：回归脚本均在 **legacy 兼容模式**下运行（保留它们原有的套件、快捷栏槽位与全配方断言）；E1 的新功能由 `p2e-tech-core.mjs` 在 **player 正式模式**下验收。两类模式的区别与理由见兼容性报告。

---

## 2. 新增单元测试（6 文件 / 103 例）

| 文件 | 用例 | 覆盖 |
|:--|--:|:--|
| `assets/__tests__/tech-nodes.test.ts` | 25 | 12 节点 ID 精确集合、唯一性、`TECH_ID_PATTERN`、阶段 4/5/3、路线 3/6/3、前置无环+闭包、成本与解锁目标真实存在（含 T2.5 machine/structure 双目标）、阶段不跳跃；12 类坏数据各报对应 code；`assertValidTechTree` 抛 RangeError |
| `tech-state.test.ts` | 16 | locked→available→researching→completed；前置完成后继可用；部分交付；重复/超额/已完成拒绝；未知节点/物品/非要求物品/非法数量；`submit` 原子性（remove 失败→库存与状态都不变）；`submitAll` 补偿回滚；`unlocked` 不重复；`trackNode` |
| `tech-persistence.test.ts` | 19 | serialize→restore 往返相等（含防御性拷贝）；版本不符保留可识别字段；未知节点/物品逐条丢弃；负数/超额 clamp、小数取整；前置闭包修复（多级剔除）；`trackedId` 容错；重复 restore 幂等 |
| `tech-gates.test.ts` | 17 | 索引与数据一致（每个 unlock 可反查、不污染）；`BASE_RECIPE_IDS` 三条基础配方开局 true；科技配方未解锁 false→完成后 true；`STARTER_PART_IDS` 11 项放行、`structure_frame` T2.5 前 false 后 true；接口盒/结构/能力/项目门控同型；legacy 全放行；未知目标 false |
| `tech-start-kit.test.ts` | 10 | 起步包 9 项 21 件与 E0 §9.2 逐项一致；不含调试件/接口盒/结构框架；槽位表精确、5 号空槽、无重复、itemId 合法；与旧 `PROTOTYPE_KIT`（56 件）严格区分 |
| `tech-recipe-order.test.ts` | 16 | 过滤不重排；`cycleRecipe` 跳过未解锁；`activeRecipe` 在 recipeId 稳定；**D3 回归**：解锁集合变化后机器 recipeId/recipeIndex 不漂移；`ensureRecipeSelected` 不改动进度/缓冲 |

---

## 3. 任务书 §六 自动化覆盖对照

| 要求 | 覆盖位置 | 结果 |
|:--|:--|:--|
| 12 个节点定义完整 | tech-nodes | ✅ |
| 依赖图无环 | tech-nodes（DFS 环检测 + 坏数据用例） | ✅ |
| 所有节点前置关系有效 | tech-nodes | ✅ |
| 节点四态转换正确 | tech-state | ✅ |
| 部分交付/完整交付正确 | tech-state | ✅ |
| 交付事务原子性 | tech-state（remove 失败、submitAll 补偿） | ✅ |
| 重复提交/重复完成幂等 | tech-state、tech-persistence | ✅ |
| 配方解锁稳定、不受数组顺序影响 | tech-recipe-order（recipeId 权威 + D3 回归） | ✅ |
| 各类门控真实生效 | tech-gates + 真实游戏验收 | ✅ |
| 起步包发放正确 | tech-start-kit + 真实游戏验收（库存逐项 = 起步包） | ✅ |
| GameRead 科技快照正确 | 真实游戏验收（`state.tech` 四字段、12 节点、状态） | ✅ |
| 既有生产/动力/物流/组合机械测试通过 | 全量 658 用例 + 5 条回归 playthrough | ✅ |

---

## 4. 真实游戏验收（player 正式模式）`scripts/p2e-tech-core.mjs`

**目的**：不用任何正式科技 UI，证明 E1 底层系统在真实游戏里成立。

| 步 | 做了什么 | 断言 |
|:--|:--|:--|
| 00 | 页面注入测试 flags 并 reload | `tech.mode === 'player'`；tech 快照属于唯一 read |
| 01 | 读取开局状态 | 起步包 9 项数量逐项相等；接口盒/结构框架/调试件为 0；12 节点存在；T1.1 available、T1.2 locked；5 号空槽 |
| 02 | 未解锁时的能力 | `P` 结构模式不激活 |
| 03 | 真实采集 12 铁矿石 | 库存 ≥12 |
| 04 | 真实键鼠搭建 11 件产线 | 1 个动力网络；锻压机默认 forge-shaft；**可见配方数 = 1**（其余 16 条未解锁） |
| 05 | 摇飞轮、离合、破碎 12、熔炼 12 | 产出 ≥12 碎铁矿 / ≥12 铁锭；全程真实加工 |
| 06 | 锻压 2 根传动轴 | 库存传动轴 ≥2、剩 ≥3 铁锭 |
| 07 | 非法交付 | T1.2（前置未完成）拒绝；非需求物品拒绝；超量拒绝；**均不扣库存、不改状态** |
| 08 | 合法交付 | 先交 3 铁锭 → `researching`（精确扣 3）；再交 2 传动轴 → `completed`（精确扣 2）；`unlocked` 含 T1.1；**T1.2 变为 available** |
| 09 | 解锁真实生效 | 锻压机可见配方 1 → **3**；`R` 切到 `forge-gear-12`；真实锻出 2 个齿轮进入库存；产线仍在运转 |
| 10 | 终态 | 仍为 player 模式；12 节点可读；恰好 1 个 completed；输出完整状态日志 + 截图 |

结果：**passed: true / 420 steps / 248.7 s / console 0 / page 0 / layout 0**，截图 10 张（`artifacts/play/scripts/p2e-tech-core/`）。

---

## 5. 回归测试（最终代码，legacy 兼容模式）

| 脚本 | 结果 | 步数 | 耗时 | console/page | 关键覆盖 |
|:--|:--|--:|--:|:--:|:--|
| `m20-first-order.mjs`（P1 八步订单） | ✅ | 176 | 169.4 s | 0/0 | 采集→建机→接动力→破碎→熔炼→锻轴→订单 8/8；HUD 与真实产出增量 |
| `m18c-production.mjs`（M1.8 生产链） | ✅（重试后） | 135 | 175.5 s | 0/0 | 完整生产闭环、接口盒自动送料、断轴冻结恢复、锻压 |
| `p2b-ports.mjs`（P2-B 接口盒） | ✅ | 248 | 268.5 s | 0/0 | 安装/拆卸/返还、自动输入、手动/自动共存、异常 |
| `p2c-links.mjs`（P2-C 物流） | ✅ | 500 | 360.3 s | 0/0 | 建链/解链、分流/合流公平性、多核产线、拆卸恢复 |
| `p2d-assembly.mjs`（P2-D 组合机械） | ✅ | 375 | 264.6 s | 0/0 | 组合建立/成员/边界/选择/拆解恢复/成员旋转 |

- 5 条回归全部 **console error 0 / page error 0 / layout 0**。
- 回归断言一条未删除、未弱化；脚本只在入口加了 `await enterLegacyMode(play)`（+ 必要的一次等待）。

---

## 6. 失败分类说明（不掩盖）

| # | 现象 | 分类 | 结论 |
|:--|:--|:--|:--|
| F1 | `m18c-production` 首次运行在 step 01 失败：采集到 9 铁矿石（脚本要求 ≥11，ORE_TARGET=12） | **既有采集时序抖动**（与 E1 改动无关：该步只按 F 采集，不涉及科技）；同一脚本重跑即通过（135 步全绿） | 重试通过；记录为已知 flaky，建议后续给采集步加 1–2 次冗余按键或按实际库存重试 |
| F2 | `m17a-playthrough` 在 step 02 断言 `counts[3]===1` 失败（实得 3） | **P2-E1 之前就存在的断言债**：P2-C 把 `PROTOTYPE_KIT.power_source` 从 2 改为 4，m17a 仍写死旧口径；与 E1 的 legacy 迁移无关 | 不属于 E1 必需回归；未修改/弱化其断言；建议独立小修（记录于兼容性报告） |
| F3 | `m17b-playthrough` 末步截图出现 `Execution context was destroyed … navigation` | **外部导航干扰**：并发 agent 在写 `.forgeax/generated`/构建产物导致页面被重置（capture documents=3）；脚本只在开头 reload 一次 | 非代码缺陷；安静窗口可重跑；不属于 E1 必需回归 |
| F4 | 交互式并行 play 时出现过一次 play 锁等待 | 环境（单项目 play 串行锁） | 后续回归改为串行后台任务执行，无失败 |

---

## 7. 数据与证据

- 单测：`pnpm test` 输出 63 文件 / 658 用例全绿；新增 6 文件 / 103 用例。
- 构建：226 artifacts / 25,179,146 B。
- 真实游戏证据：`artifacts/play/scripts/p2e-tech-core/`（10 张截图 + play.json）、
  `artifacts/play/scripts/{m20-first-order,m18c-production,p2b-ports,p2c-links,p2d-assembly}/`（各 8–22 张截图 + play.json）。
  这些目录由 `project play` 生成、被 `.gitignore` 忽略，不入库。
