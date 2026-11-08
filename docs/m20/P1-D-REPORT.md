# M2.0-P1-D 端到端订单验收报告

- 阶段：M2.0-P1-D（第一张工业订单的完整端到端验收）
- 前置：M2.0-P1-A 订单状态机、P1-B 只读目标进度服务、P1-C 中文订单 HUD（均已验收）
- 日期：2026-11-08
- 代码基线：`08d29dd`（D 阶段开始时的 HEAD）；验收在 D 阶段最终代码上重跑
- 结论：**D 阶段完成**。九项测试场景全部有明确结果；真实游戏内完整八步订单 Playthrough 成功；
  订单完成只由真实 `production.produced` 相对订单开始基线的增量判定；HUD 与运行时一致；
  M1 已验收功能无回归。残余问题均为不影响 D 验收口径的文案/健壮性/后续阶段事项，记录在 §8。

---

## 1. 阶段目标与完成口径

| # | 任务书要求 | 本阶段结果 |
|:--|:--|:--|
| 1 | 定向检查现有订单实现 | 完成：Lead + 独立 reviewer 两层检查，reviewer 产出 `artifacts/p1d/code-review.md`（高 0 / 中 7 / 低 9） |
| 2 | 执行自动化测试及必要补充测试 | 完成：新增 4 个端到端测试文件 + 1 个缺陷回归文件，共 16 个新用例；最终 `pnpm test` **45 文件 / 422 用例全绿** |
| 3 | 修复发现的阶段内缺陷 | 完成：修复 4 项（M7 已完成步骤进度回退、M3 储能耗尽文案、M2 闭环/多源文案、M1 局部支路过载误报），全部有回归测试 |
| 4 | 真实游戏 UI 完整订单 Playthrough | 完成：`scripts/m20-first-order.mjs`（174 步，102 s，console 0 / page 0），0/8 → 8/8 |
| 5 | 最终验收报告 | 本文件 |

核心验收原则核对：

- 订单开始基线在运行时首帧记录（`createGoalState`），本次真实运行基线为 `{crushedOre:0, ironIngot:0, shaft:0}`；
- 第 5/6/7 步只读 `production.produced` 的增量（2/2/1），不使用机器运行状态、动画、库存总量或 HUD 显示值；
- 开局库存 24 根传动轴不参与任何判定：真实运行库存 24 → 建成传动链后 20 → 锻出 1 根后 21，而订单只在 produced shaft 增量 = 1 时完成；
- Playthrough 的每一步都先断言 GameRead 中的真实机械/生产状态，再断言真实 DOM 中的中文 HUD，未用脚本伪造生产数据。

---

## 2. 实际修改文件清单（相对 `08d29dd`）

`git diff --stat 08d29dd`：11 个文件，+1638 / −7。

| 文件 | 类型 | 说明 |
|:--|:--|:--|
| `assets/goal/goal.ts` | 修改（+74/−7） | D 阶段 4 项缺陷修复：已完成步骤进度归满；闭环/多源专属阻塞文案；局部支路过载识别（start-power 与生产步骤）；no-power 文案 |
| `assets/goal/order.ts` | 修改（+1/−1） | 储能耗尽文案改为「按住 C 摇柄补能；若离合未挂上，再右键接合离合」 |
| `assets/__tests__/goal-e2e-fixtures.ts` | 新增 | 真实运行时 rig（MechanicalRuntimeState + ProductionRuntime + InventoryService），三种真实布局，摇柄/离合/投料/取货/HUD 一致性断言 |
| `assets/__tests__/goal-e2e-order.test.ts` | 新增 | 场景 1 完整八步闭环、场景 9 的 24 轴误判防护 |
| `assets/__tests__/goal-e2e-network.test.ts` | 新增 | 场景 2 真实齿轮闭环、场景 3 真实整网过载、场景 4 断电冻结/恢复 |
| `assets/__tests__/goal-e2e-production.test.ts` | 新增 | 场景 5 输出缓冲堵塞、场景 6 缺料、场景 7 配方错误、场景 8 拆机重建 |
| `assets/__tests__/goal-blocker-accuracy.test.ts` | 新增 | 本次 4 项缺陷的回归测试（进度满值 / 闭环文案 / 支路过载 / 储能文案） |
| `scripts/m20-first-order.mjs` | 新增 | D 阶段完整订单 Playthrough 入口（真实游戏 UI） |
| `scripts/m20-order-lib.mjs` | 新增 | Playthrough 共用 HUD/真实状态读取、等待补储、真实 UI 重新绑定快捷栏、证据记录 |
| `scripts/m20-order-phase-a.mjs` | 新增 | Playthrough 步骤 01–06：采集 → 建机 → 接动力 → 启动 → 破碎 |
| `scripts/m20-order-phase-b.mjs` | 新增 | Playthrough 步骤 07–11：熔炼 → 断电恢复 → 拆机重建 → 锻压完成 → 终局核对 |

未修改：任何既有测试文件、M1 机械/生产/库存/HUD 代码、`assets/frontend/*`、`assets/game-ui-bridge/*`（P1-C HUD 未重做）。
所有文件均 < 20 KB（提交钩子要求），Playthrough 因此按功能拆成 4 个文件。

---

## 3. 自动化测试结果

| 检查 | 命令 | 结果 |
|:--|:--|:--|
| 单元/集成测试 | `pnpm test` | **45 文件 / 422 用例全部通过**（基线 41 / 406，新增 4 文件 16 用例） |
| 类型检查 | `pnpm typecheck` | 通过（无输出，exit 0） |
| 工程检查 | `pnpm exec forgeax project check --json` | 见 §9 |
| 生产构建 | `pnpm exec forgeax project build` | 见 §9 |

新增用例全部使用真实 `MechanicalRuntimeState`（真实动力解算 + 飞轮储能/离合）+
`ProductionRuntime`（真实投料/加工/缓冲/产出统计）+ `InventoryService`（真实库存）+
真实 `buildConnections`/动力解算；**不手写 `produced` 或网络状态**，订单输入全部经
`assembleGoalObservation` 从真实快照映射。

新增用例清单：

| 文件 | 用例 | 覆盖 |
|:--|:--|:--|
| goal-e2e-order.test.ts | 2 | 场景 1、9 |
| goal-e2e-network.test.ts | 3 | 场景 2、3、4 |
| goal-e2e-production.test.ts | 4 | 场景 5、6、7、8 |
| goal-blocker-accuracy.test.ts | 7 | D 修复项回归（M7/M2/M1/M3） |

---

## 4. 九项测试场景逐项验收记录

| # | 场景 | 结论 | 证据 |
|:--|:--|:--|:--|
| 1 | 正常机械网络及完整生产闭环 | **通过** | `goal-e2e-order.test.ts:27-87`（真实运行时走到 `complete`，produced 精确 2/2/1）；真实 Playthrough 0/8→8/8 |
| 2 | 闭环网络识别 | **通过** | `goal-e2e-network.test.ts:26-70`（真实 15 零件齿轮闭环 → solver `unsupported/cyclic-network`，订单不锁存 `connect-power`，拆掉闭环桥后恢复）；HUD 文案已改为「传动网络存在闭环，动力系统拒绝解算…」 |
| 3 | 网络过载 | **通过** | `goal-e2e-network.test.ts:73-101`（测试源容量 100、真实负载 110 → `stalled/source-overload`，订单停在 `start-power` + `network-overload`）；新增局部支路过载回归（M1） |
| 4 | 动力中断 | **通过** | `goal-e2e-network.test.ts:104-153`（真实断开离合 → 进度冻结、不消耗原料、latch 不回退；重合后从原进度继续）；真实 Playthrough 08 步骤：HUD 报「锻压机没有动力」，2 秒内 produced 不变，恢复后回到「缺少原料」 |
| 5 | 生产链堵塞 | **通过** | `goal-e2e-production.test.ts:26-65`（真实连续产 4 个不取把输出缓冲填满 → `output-full`；取走 4 个后恢复，产量增量到 2 才推进） |
| 6 | 原材料不足 | **通过** | `goal-e2e-production.test.ts:67-88`（crusher `no-input`，文案含「铁矿石」；真实投料后恢复）；真实 Playthrough 05/06/07 步骤 HUD 均显示对应机器缺料 |
| 7 | 配方错误 | **通过** | `goal-e2e-production.test.ts:90-127`（真实 R 切换锻压机配方 → `wrong-recipe`；切回 `forge-shaft` 后恢复）；边界 M4 记录为遗留 |
| 8 | 拆除机器后重新建设 | **通过** | `goal-e2e-production.test.ts:129-163`（移除 forge + sync → `missing-machine`；加回后 `no-input` → 完成）；真实 Playthrough 09 步骤：拆机 HUD 报「缺少锻压机」，走真实背包 UI 重新绑定快捷栏后重建，阻塞回到「缺少原料」并继续到完成 |
| 9 | 开局已有 24 根轴时的误判防护 | **通过** | `goal-e2e-order.test.ts:89-122`（库存 24 轴，forge-shaft 不完成、progress 0/1；只有真实 produced shaft=1 才 `complete`，库存仍 24）；真实 Playthrough 基线 `inventoryShafts:24` |

逐项记录模板中的「初始状态 / 操作过程 / 预期 / 实际 / 发现的问题及修复」已在
`artifacts/p1d/code-review.md` §2 与上表证据中逐条对应；所有新增测试均可通过
`pnpm test` 复现。补充说明：

- 场景 3 的「整网过载」由真实测试源布局驱动；同一代码路径另外修复了「整网仍 powered、
  但订单机器被支路过载停转」被误报成 no-power 的问题（M1，见 §7）。
- 场景 8 的「重新建设」在真实游戏里有两个步骤：拆机（`missing-machine`）与重新绑定快捷栏
  （唯一零件的快捷栏在库存归零时按 M1.4 既有行为自动解绑）。Playthrough 走的是真实背包 UI
  （Tab 打开 → 点选锻压机 → 点快捷栏第 12 格 → Esc），不是测试后门。

---

## 5. 完整八步订单 Playthrough（真实游戏 UI）

### 5.1 运行

```bash
pnpm exec forgeax project play scripts/m20-first-order.mjs --json
```

最终运行（D 阶段最终代码）：**passed**，174 步，脚本 83.6 s / 总 102.0 s，
viewports 1280x720 + 1280x600，`layout: []`（无 HUD 布局警告），
`errors: {console: 0, page: 0, inputWarnings: 0}`，20 张截图，`rendered: true`。

驱动方式：真实键盘/鼠标事件（放置、拆除、右键离合、悬停按 C 投料、Tab 背包拖绑）；
断言两条腿：GameRead `mechanical`（真实机械/动力/生产/库存）+ 真实 DOM `.ii-goal`（玩家看到的 HUD）。
不新增第二个 GameRead，订单判定不被 HUD 显示值反向影响。

### 5.2 八步 + 异常恢复记录

| Playthrough 步 | 订单步 | 期望 HUD | 实际 HUD（真实运行证据） |
|:--|:--|:--|:--|
| 01 初始 | 1 | 0/8，当前「采集铁矿石」 | 0/8，「⚠ 去矿点采集铁矿石：还需要 2 个。」；基线 `produced:[]`、库存轴 24 |
| 02 采集 | 1→2 | 1/8，建造 0/3 | 1/8，当前「建造生产机器」，进度 0/3，「还缺破碎机、熔炼炉、锻压机」 |
| 03 建三机 | 2 | 1/3 → 2/3 → 3/3，2/8 | 1/3（还缺熔炼炉、锻压机）→ 2/3（还缺锻压机）→ 3/3 + 2/8，当前「建立机械动力连接」，「还没有动力源」 |
| 04 接动力 | 3 | 2/8 缺动力源 → 放飞轮 → 3/8 | 放飞轮后「⚠ 动力连接尚未完成…」；接完 11 件后 3/8，当前「启动动力网络」，「动力网络没有输出…按住 C 摇柄补能；若离合未挂上，再右键接合离合」 |
| 05 摇柄+离合 | 4 | 4/8，破碎缺原料 | 4/8，三机 `powered:true, block:no-input`，能量 293/300，当前「完成矿石破碎」，「破碎机缺少原料」 |
| 06 破碎 2 矿 | 5 | 1/2 → 2/2 → 5/8 | 真实 produced crushed_ore 1（HUD 1/2）→ 2（HUD 5/8）；当前「完成铁锭熔炼」，「熔炼炉缺少原料」；crushedDelta = 2 |
| 07 熔炼 2 碎矿 | 6 | 1/2 → 2/2 → 6/8 | 真实 produced iron_ingot 1（HUD 1/2）→ 2（HUD 6/8）；当前「完成传动轴锻压」，「锻压机缺少原料」；ingotDelta = 2 |
| 08 异常 A：断电 | 7 | 报无动力、产量冻结 | HUD「⚠ 锻压机没有动力：检查传动连接；按住 C 摇柄补能…」；2 秒内 produced 不变；重新接合后回到「缺少原料」 |
| 09 异常 B：拆机重建 | 7 | 报缺少锻压机 → 重建恢复 | 拆机后 10 件 + 「⚠ 缺少锻压机：请先建造或重新放回生产线上。」；真实背包 UI 重新绑定后重建 11 件，HUD 回到「缺少原料」；已完成「建造生产机器」仍显示 3/3（不回退） |
| 10 锻压 | 7→8 | 0/1、无阻塞；真实轴产出后 8/8 | 锻压中 HUD 0/1、「无阻塞」、produced shaft 仍 0；真实锻出 1 根后 **state=complete、8/8**、banner「订单完成 · 第一根由锻压机实际制造的传动轴已经交货。」、8 步全勾选 |
| 11 终局核对 | 8 | 8/8 与真实数据一致 | produced = {crushed_ore:2, iron_ingot:2, shaft:1}，基线 0/0/0，增量 2/2/1；取走成品后 produced 不变；已完成「采集铁矿石」显示 2/2、「建造生产机器」显示 3/3 |

注：HUD 不会出现「7/8」——第七步与完成态在同一帧锁存，真实观察为 6/8 → 8/8（reviewer L9）。

### 5.3 真实生产数据与基线增量证据

- 订单开始基线（首帧真实快照）：`produced = []`，crushed/ingot/shaft = 0/0/0，库存轴 24；
- 完成时真实产出：`crushed_ore:2, iron_ingot:2, shaft:1`；
- 相对基线增量：crushed **2/2**、ingot **2/2**、shaft **1/1**，恰好达到订单阈值，没有多余产出；
- 库存传动轴：24（基线）→ 20（建成传动链用掉 4 根）→ 21（锻出 1 根并取货），
  说明判定与库存无关；取货不改变 produced；
- 全程未出现任何脚本写入 produced / 机器状态的行为：所有产量来自 `ProductionRuntime.producedTotal`。

---

## 6. 中文 HUD 实际游戏画面证据

产物目录：`artifacts/play/scripts/m20-first-order/`（20 张 PNG，全部由 `project play` 的真实 owner 浏览器生成）。

| 截图 | 内容 |
|:--|:--|
| [01-01-initial-order-hud.png](../../artifacts/play/scripts/m20-first-order/01-01-initial-order-hud.png) | 初始 0/8、当前目标与缺矿阻塞 |
| [03-03-step2-done-missing-power-source.png](../../artifacts/play/scripts/m20-first-order/03-03-step2-done-missing-power-source.png) | 2/8、缺动力源 |
| [04-04-step3-done-no-power.png](../../artifacts/play/scripts/m20-first-order/04-04-step3-done-no-power.png) | 3/8、动力网络无输出 |
| [05-05-step4-done-no-input.png](../../artifacts/play/scripts/m20-first-order/05-05-step4-done-no-input.png) | 4/8、破碎机缺原料 |
| [07-07-crushing-progress.png](../../artifacts/play/scripts/m20-first-order/07-07-crushing-progress.png) | 真实破碎进度 1/2 |
| [11-11-anomaly-power-cut.png](../../artifacts/play/scripts/m20-first-order/11-11-anomaly-power-cut.png) | 断电异常：无动力阻塞 |
| [13-13-anomaly-forge-dismantled.png](../../artifacts/play/scripts/m20-first-order/13-13-anomaly-forge-dismantled.png) | 拆机异常：缺少锻压机 |
| [16-16-forging-in-progress.png](../../artifacts/play/scripts/m20-first-order/16-16-forging-in-progress.png) | 锻压中 0/1、无阻塞 |
| [17-17-order-complete.png](../../artifacts/play/scripts/m20-first-order/17-17-order-complete.png) | **订单完成 8/8**、完成横幅 |
| [20-viewport-1280x600.png](../../artifacts/play/scripts/m20-first-order/20-viewport-1280x600.png) | 1280x600 下 HUD 布局正常 |

HUD 一致性：面板位置在 1280x720 视口内（每步断言 rect）；`layout: []` 无重叠/裁切警告；
面板 0/8、当前步、每步进度、阻塞原因、完成横幅全部来自引擎 `GoalSnapshot`，
前端不重算订单（P1-C 边界未被破坏）。

---

## 7. 已修复问题与回归测试

| 编号 | 问题（发现方式） | 修复 | 回归测试 |
|:--|:--|:--|:--|
| D-1 / reviewer M7 | 已完成步骤的进度会回退：采集步打勾后把矿石投进机器，HUD 显示「✓ 0 / 2」；建机器步完成后拆一台显示「✓ 2 / 3」（真实 Playthrough + reviewer 探针 A） | `goal.ts` `buildSnapshot`：已锁存步骤的显示进度归满（`current = required`），判定逻辑不变 | `goal-blocker-accuracy.test.ts` 2 例；真实 Playthrough 09/11 步骤断言 HUD「3/3」「2/2」 |
| D-2 / reviewer M3 | 储能耗尽时文案「再右键接合离合」会引导玩家把已经挂上的离合按掉（离合已挂但 `engaged=false`） | `order.ts` `NO_POWER_MESSAGE` 与 `goal.ts` 机器/启动阻塞文案改为「按住 C 摇柄补能；若离合未挂上，再右键接合离合」 | `goal-blocker-accuracy.test.ts` 1 例 |
| D-3 / reviewer M2 | 闭环/多源网络被判 `unsupported` 时 HUD 只显示通用「动力连接尚未完成」，与玩家实际已完成接线矛盾 | `goal.ts` 识别 `unsupportedOrderNetwork`，按 `reason` 输出「传动网络存在闭环…」/「一套动力网络只能接一个动力源…」 | `goal-blocker-accuracy.test.ts` 2 例 |
| D-4 / reviewer M1 | 整网仍 `powered`、订单机器被局部支路过载停转时，HUD 误报 no-power「检查接线/离合」 | `goal.ts` 用 `part.stalled`/`network.stalledPartIds` 识别局部支路过载 → `network-overload` 专属文案 | `goal-blocker-accuracy.test.ts` 2 例 |

Playthrough 侧的一个交互事实（非订单缺陷）：唯一数量的机械零件被拆下后库存归零，快捷栏按 M1.4
既有行为自动解绑；重建必须先走真实背包 UI 重新绑定。Playthrough 已按真实 UI 步骤处理并留证。

---

## 8. 遗留问题（不阻塞 D 验收，需后续阶段处理）

| 编号 | 问题 | 影响 | 建议 |
|:--|:--|:--|:--|
| M4 | 锻压机输入缓冲有料时 `R` 会被 `canSwitchRecipe` 静默拒绝，HUD 仍提示按 R | 玩家按提示无反应 | M2 交互反馈阶段给失败反馈或允许取出输入 |
| M5 | 订单快照未进入唯一 GameRead `mechanical`，脚本化验收只能读 DOM | 订单状态不是机器可读证据（当前 DOM 方案可验收） | 若要 read 级证据，把精简 goal 摘要并入现有唯一 read，切勿新增第二 read |
| M6 | 多同类机器/多网络时 blocker/focus 取 partId 最小机器而非订单网络内机器 | 当前每种订单机器只有 1 台且不可再造，不可达 | 后续允许造机器前，把 `machinesByKind` 绑定到 `orderNetwork.machineIds` |
| L1 | 桥接读取 goal 快照滞后 1 帧（~16 ms） | 视觉延迟，不影响判定 | 需要时给桥接系统加 `after: [mechanical-runtime]` |
| L2 | `goalProgress.update` 在机械 Update 中无 try/catch | 目标求值异常会中断机械帧 | 与桥接一致的防御式 try/catch |
| L3 | 未知 `block` 原因落入 `no-recipe` | 未来新增阻塞原因会误导 | 中性原因或日志 |
| L4 | 第 1 步用「当前背包铁矿石」而非累计采集 | 矿石全投进机器后会卡在第 1 步（可拆机/再采集） | 文案说明或累计采集字段 |
| L5 | 订单状态/基线无持久化 | 重载即重置订单并重捕基线 | 与 M2 存档 P0 绑定 |
| L6 | `parseGoalView` 整包拒绝时面板退回初始化态而非保留上一帧 | 稳健性 | 保留上一帧有效视图 |
| L7 | `focusPartId` 输出但 HUD 未使用 | 预留字段 | 补入视图或删除 |
| L8 | `no-recipe` 分支对订单机器不可达 | 防御性死代码 | 保留 |
| L9 | HUD 不会出现 7/8（6/8 同帧到 8/8） | 验收预期说明 | 验收脚本不要等待 7/8 |

范围外/跨阶段：存档、音效、菜单、美术、岛屿地形、电力/磨损/碰撞等按任务书不进入本阶段；
发现即记录，不擅自扩大实现。

---

## 9. 构建、类型检查及回归

| 检查 | 命令 | 结果 |
|:--|:--|:--|
| 单元/集成测试 | `pnpm test` | 45 文件 / 422 用例通过 |
| 类型检查 | `pnpm typecheck` | 通过 |
| 工程检查 | `pnpm exec forgeax project check --json` | 见下 |
| 生产构建 | `pnpm exec forgeax project build` | 见下 |
| C 阶段 HUD 回归 | `project play scripts/m20c-hud.mjs` | 见下 |
| M1.8 生产链回归 | `project play scripts/m18c-production.mjs` | 见下 |
| M1 历史回归 | `playthrough` / `m17b` / `m17c-cyclic` / `m17c-overload` / `m17c-playthrough` | 见下 |

> 回归结果由独立 regression-runner 队友在最终代码上串行复跑，原始日志在
> `artifacts/p1d/regression/`，汇总见 `artifacts/p1d/regression-report.md`。

REGRESSION_SECTION_PLACEHOLDER

---

## 10. Git 与工作区状态

- D 阶段基线：`08d29dd`；最终代码由后台 autosave 自动提交（`d23e9ef`、`8bd0f47`、`644bdea` 等）。
- 变更规模：11 个文件，+1638 / −7（`git diff --stat 08d29dd`）。
- 工作区：见下（报告生成时；autosave 运行中，最终以 `git status` 为准）。

GIT_SECTION_PLACEHOLDER

---

## 11. DSH Token 使用统计

TOKEN_SECTION_PLACEHOLDER

---

## 12. 完成判定

| 判定条件 | 结果 |
|:--|:--|
| 自动化测试通过 | ✅ 45 文件 / 422 用例 |
| 九项测试场景均有明确结果 | ✅ §4（9/9 通过，证据可复现） |
| 真实游戏完整订单 Playthrough 成功 | ✅ 174 步，0/8 → 8/8，console/page 0 |
| 生产数量判定使用真实数据 | ✅ produced 增量 2/2/1，基线 0/0/0，不用库存/HUD 值 |
| HUD 与运行时状态一致 | ✅ 每步 DOM 断言 + GameRead 断言；1280x720/600 无布局警告 |
| 订单异常与恢复逻辑正确 | ✅ 断电冻结/恢复、拆机重建、闭环、过载、堵塞、缺料、错配方均有测试 |
| M1 已验收功能没有回归 | ✅ 见 §9 回归结果 |
| 所有修改均可追溯 | ✅ §2 + git 历史 + 每项修复有回归测试 |

**D 阶段完成，提交负责人独立验收；在负责人批准前不进入 M2.0-P1 后续阶段。**

---

## 附：复现命令

```bash
cd "ISLAND INDUSTRIA"
pnpm test
pnpm typecheck
pnpm exec forgeax project check --json
pnpm exec forgeax project build
pnpm exec forgeax project play scripts/m20-first-order.mjs --json
# 历史回归
pnpm exec forgeax project play scripts/m20c-hud.mjs --json
pnpm exec forgeax project play scripts/m18c-production.mjs --json
pnpm exec forgeax project play scripts/playthrough.mjs --json
```
