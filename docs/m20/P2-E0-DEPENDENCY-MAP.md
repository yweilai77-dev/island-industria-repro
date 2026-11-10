# M2.0-P2-E0 · 科技系统依赖关系与实施拆分（P2-E1 / P2-E2 / P2-E3）

- 阶段：M2.0-P2-E0（调查 / 设计，**不实施**）
- 开工基线：`f0fd623`（P2-D 最终验收版本，工作区 clean）
- 设计唯一来源：[P2-E0-TECH-TREE-DESIGN.md](P2-E0-TECH-TREE-DESIGN.md)（下称「设计文档」）；本文只把它的依赖与实施边界落到可执行粒度，**不改变任何设计决策**
- 事实来源：[P2-E0-INVESTIGATION.md](P2-E0-INVESTIGATION.md)、[P2-E0-DEMO-PROGRESSION.md](P2-E0-DEMO-PROGRESSION.md)、P2-A→P2-D 的报告/设计、仓库外三份 E0 事实表（industrial-facts / mech-facts / goal-ui-facts）
- 本文性质：**实施计划**。所有条目都是将来时与验收标准，不含任何代码/资源/配方/测试/配置改动
- 行号约定：`file.ts:line` 均相对仓库根、基于 `f0fd623`；设计条目引用为「设计 §N」

> 结论先行：科技系统不是一个新子系统，而是**架在 12 个既有子系统上的门控层**。
> 它只新增三样东西：一份纯数据节点表、一个只读+扣库存的 `tech` 服务、一个只读 `tech` GameRead 字段；
> 其余全部是「在既有单一入口插入 `isUnlocked` 查询」。最大风险不在科技本身，而在
> **替换开局套件与配方可见性会同时撞上 6 条既有验收脚本与锻压机 R 循环**。

---

## 0. 阅读约定

| 标记 | 含义 | 判定证据 |
|:--|:--|:--|
| ✅ 已实现 | 有生产代码路径，多数有测试 | 事实表与源码双向核对 |
| ◐ 需扩展 | 入口已存在，只差门控/字段/过滤 | 单一入口已定位，改动面可数 |
| ○ 需新建 | 代码 0 命中 | 设计文档 §1.1「科技/解锁 0 行」 |

- 方向写法：**科技→X** 表示科技读取/门控 X；**X→科技** 表示 X 必须向科技提供服务、状态或注入点。
- 风险等级：高 = 不做前置决策就会返工/破坏验收；中 = 有已知绕法但需显式排期；低 = 只读接入或纯新增。

---

## 1. 依赖总表

### 1.1 科技系统对 12 个子系统的依赖

| # | 子系统 | 科技依赖它什么 | 方向 | 接口符号（证据） | 现状 | 风险 |
|--:|:--|:--|:--|:--|:--|:--|
| 1 | inventory | 交付扣料、拥有数展示、起步包发放；**单物品整笔原子**，无多物品事务 | 科技→inventory（只读+扣减） | `inventoryHas/inventoryRemove` `inventory/inventory.ts:55-115`；`InventoryService.has/remove/count` `inventory.ts:122-152` | ✅ 用现有接口；◐ 多物品补偿事务要科技服务自封装（设计 §6.3） | 中 |
| 2 | hotbar | 起步包只绑定已解锁物品；12 格已由套件占 11 格 | 科技→hotbar（绑定表） | `hotbar.bind/select` `hotbar/hotbar.ts:34-68`；`dropUnavailable` `:71-85`；槽位表 `mechanical/parts.ts:378-390` | ◐ 绑定来源从 `PROTOTYPE_KIT_SLOTS` 改为科技起步包 + 解锁过滤 | 中 |
| 3 | build | 机器放置复用 `validatePlacement`；建筑系统本身不消耗物品 | 科技→mechanical（不经 build） | `validatePlacement` `build/build.ts:80-123`；build 不注入 inventory（事实：build 目录 grep inventory 0 命中） | ✅ 不改 build | 低 |
| 4 | mechanical | 起步包发放、放置事务、快捷栏选中解析、唯一 GameRead 宿主 | 双向：科技→mechanical 门控；mechanical→科技 提供 read 字段 | `grantKit` `mechanical/mechanical.pack.ts:128-139`；`selectedItem` `:232-235`；`place` `:302-332`；`canPlacePart/placePart` `:335-347`；read `mechanical/runtime.ts:103-171,173-177` | ◐ 四处插入门控 + 起步包换源 | 高 |
| 5 | power | 动力求解语义**零改动**；阶段 3 的「动力墙」依赖单源树状网络事实 | 科技→power（只读诊断/终局证明） | `solvePower` `mechanical/power.ts:229-437`；多源/闭环 unsupported `power.ts:186-197`；快照 `runtime-state.ts:349-379`（`sources/networks` 经 read 暴露） | ✅ 不改；只读 | 低 |
| 6 | production | 配方可见性过滤（R 循环）、配方选择身份、批量配方 `outputs[0].count` 语义、生产累计读数 | 双向：科技→production 过滤；production→科技 提供 `produced`/机器状态 | `recipesFor` `production/recipes.ts:177-179`；`activeRecipe/cycleRecipe` `production.ts:62-86`；`cycleMachineRecipe` `production-runtime.ts:218-223`；`primaryInputOf/primaryOutputOf` `recipes.ts:182-189`；产出扣减 `production.ts:181-233` | ◐ 过滤 + 下标身份需改；count 需验证 | 高 |
| 7 | industrial | 端口安装门控、结构放置门控、物料连接能力门控、组合快照只读 | 双向：科技→industrial 门控；industrial→科技 提供只读快照 | `PORT_MODULES` `industrial/port-module.ts:74-111`；`installModule` `industrial/port.pack.ts:128-143`；`PortRuntime.install` `port-runtime.ts:140-167`；`STRUCTURE_MODULES` `assembly-module.ts:54`；`placeFrameAt` `assembly-system.ts:245-250`；`structurePlacementIssue` `assembly-runtime.ts:480-498`；`MaterialLinkRuntime.create` `link-runtime.ts:198-221`；`AssemblyService` `assembly-service.ts:10-19` | ◐ 三处门控；运行时零改动 | 中 |
| 8 | goal | 订单逻辑保留、HUD 交接、只读投影/阻塞文案模式复用 | 科技→goal（仅 HUD 层）；goal 逻辑不改 | `goalProgress` 服务 `goal/goal-service.ts:28-33,82-159`；`GoalSnapshot` `goal/goal.ts:69-79`；`resolveBlocker` `goal/goal-blockers.ts:147-166`；HUD 视图 `game-ui-bridge/goal-view.ts:47-147` | ✅ 订单不改；◐ E2 只改 HUD 显示切换 | 中 |
| 9 | frontend | 科技页（背包模态第二标签）、HUD 追踪卡、1280×600 布局 | 科技→frontend（消费快照） | `createGoalPanel` `frontend/frontend-goal-panel.ts:26-190`；`render()` `frontend-ui.ts:160-269`；暂停 `:271-322`；CSS `frontend-ui-styles.ts:2-116`（目标面板 `left:16;top:146;width:302` `:71-74`） | ○ 科技页/追踪卡新建；◐ 背包标签扩展 | 中 |
| 10 | game-ui-bridge | 协议 v2、tech 视图、上行命令、签名去重 | 双向：科技→bridge 数据；bridge→科技 命令入口 | `UI_PROTOCOL_VERSION=1` `game-ui-bridge/protocol.ts:11`；`UiStateMessage` `:23-34`；`parseUiCommand` `:63-92`；`buildStateMessage` `:95-125`；`stateSignature` `:138-145`；前端解析 `frontend-ui-protocol.ts:65-93` | ◐ v1→v2 扩展 | 中 |
| 11 | 持久化 | 科技状态必须是纯 JSON 快照字段；当前**无任何存储实现** | 科技→存档（提供 TechState）；存档→科技（restore 入口） | `TechState`（设计 §8.1）；SAVE-ARCHITECTURE §3 快照 v1 字段位与 §2 六个缺口 | ○ 需新建（P0 并行时并入） | 高 |
| 12 | 唯一 GameRead | 科技只读状态必须并入 `mechanical`，禁止第二个 read | mechanical→科技（容纳 tech 字段） | `registerRead({id:'mechanical'})` `mechanical/runtime.ts:173-177`；`snapshotOf` `:103-171` | ◐ 增加 `tech` 子字段 | 中 |

### 1.2 反向依赖：系统 → 科技的注入点（全部是既有单一入口）

| # | 注入点 | 现有行为 | 科技要加什么 | 约束/证据 |
|--:|:--|:--|:--|:--|
| 1 | 起步包发放 | `grantKit()` 一次性发 56 件 + 9 盒 + 4 框 | 换成「继承工坊」清单，只发一次（沿用 granted key 思路） | `mechanical.pack.ts:128-139`；`port.pack.ts:51-58`；`assembly-system.ts:51-53,96-99`；设计 §9.2 |
| 2 | 快捷栏绑定 | 套件绑定 11 格，5 号留空 | 未解锁物品不绑定；空槽语义不变 | `PROTOTYPE_KIT_SLOTS` `parts.ts:378-390`；`hotbar.ts:8` |
| 3 | 机械放置 | 只查 `inventory.has` + 几何 | `place()`/`placePart()` 前查 `isPartUnlocked`（含结构框架路径） | `mechanical.pack.ts:302-347` |
| 4 | 配方选择 | `recipesFor` 全量，R 循环整表 | 过滤为「已解锁集合」；`recipeIndex` 身份策略见 D3 | `recipes.ts:177-179`；`production.ts:62-86`；`production-runtime.ts:218-223` |
| 5 | 端口安装 | `installModule` 只查库存/槽/角色 | 加 `isPortUnlocked` + `hasCapability('material-link')` | `port.pack.ts:128-143`；`port-runtime.ts:140-167` |
| 6 | 结构放置 | 只查相邻 + 空间 | 加 `isStructureUnlocked` + `P` 模式门控 | `assembly-system.ts:245-250,261-312`；`assembly-runtime.ts:480-498` |
| 7 | 连接能力 | `J/H` 建链解链无门槛 | 加 `hasCapability('material-link')`；未解锁时按键无效并提示 | `port.pack.ts:227-234`（键位）；`link-runtime.ts:198-221` |
| 8 | 结构模式 | `P` 直接进入 | 未解锁 → 不进入并提示 | `assembly-system.ts:261-269` |
| 9 | GameRead | 无 tech | 增加 `tech: { unlocked, states, trackedId }` | 设计 §7.4；`mechanical/runtime.ts:103-171` |
| 10 | 插件挂载顺序 | inventory → build → bridge → mechanical → ports → assembly → mechanical-runtime | `plugin/tech` 必须晚于 inventory、早于 mechanical | `assets/scene-owner.pack.ts:59-74` |

### 1.3 依赖方向的三条硬规则

1. **科技只读世界状态，世界状态不知道科技**：`power/production/port/link/assembly` 的运行时不得 import 科技模块；门控只能通过注入的查询函数生效（避免第二套真相）。
2. **科技状态只有一个写者**：新 `tech` 服务；UI/read/goal/HUD 全部只读快照。
3. **科技不反向驱动运行时**：不存在「解锁后自动改变机器状态」；解锁只改变**下一帧查询结果**（设计 §8.3「门控在运行时每帧查询」）。

---

## 2. 状态所有权与数据边界

### 2.1 所有权矩阵

| 状态 | 唯一所有者 | 只读者 | 生命周期 | 落盘 |
|:--|:--|:--|:--|:--|
| 12 节点定义（前置/成本/解锁） | 新纯数据模块 `assets/tech/nodes*.ts` | 科技服务、校验器、UI | 编译期常量 | 否（随版本） |
| 已交付材料计数 `delivered` | 新 `tech` 服务 | 唯一 GameRead `tech`、科技页、追踪卡 | 会话（E3 后落盘） | 是（设计 §8.1） |
| 已解锁节点集合 `unlocked` | 新 `tech` 服务（派生+显式保存） | GameRead、门控查询、UI | 会话 | 是 |
| 追踪目标 `trackedId` | 新 `tech` 服务 | GameRead、HUD | 会话 | 是 |
| 门控结果（能否造/能否装） | **派生**（`isUnlocked` 查询） | mechanical/ports/assembly/production | 每帧重算 | 否 |
| 库存/快捷栏 | 既有 `inventory`/`hotbar` 服务 | 科技（只读 count/stacks） | 会话 | 既有存档范围 |
| 加工/端口/连接/组合状态 | 既有 `ProductionRuntime`/`PortRuntime`/`MaterialLinkRuntime`/`AssemblyRuntime` | 科技（只读快照） | 会话 | 既有存档范围 |
| 终局运行证明窗口 | `tech` 服务内**只读累加器**（不写世界状态） | 终局判定 | 会话（60 s 窗口） | 否（可由进度推导） |

### 2.2 唯一 GameRead 的满足方式

- 只保留 `id:'mechanical'` 一个 read（`mechanical/runtime.ts:173-177`）；`tech` 作为其子字段返回：
  `tech: { unlocked: string[], states: [{ id, status, delivered: Record<ItemId, number> }], trackedId: string | null }`（设计 §7.4）。
- `snapshotOf()` 从注入的 `tech` 服务取**已序列化的只读快照**，不直接暴露类实例/Map；`status` 必须由服务每帧/按需派生，read 层不做业务判断。
- 验收脚本与 UI 都只读该字段（`play.state()` 默认读唯一 read，见 `engine-devkit/play.d.ts:60-107`），因此 `tech` 一进 read，E1 就能被脚本断言。
- 禁止：新增第二个 `registerRead`（设计 §1.2 第 1 条）、把 tech 状态塞进 `ui` 字段（`ui` 是交互态，不承载进度）、让 read 反向写 tech。

### 2.3 协议 v2 的字段与兼容策略

| 项 | v1（现状） | v2（目标） | 兼容做法 |
|:--|:--|:--|:--|
| 版本号 | `UI_PROTOCOL_VERSION = 1`（`protocol.ts:11`） | `= 2` | 双端同版本发布；`parseUiCommand` 继续对版本不符直接拒绝（`:66`），不做 v1/v2 混跑 |
| 下行状态 | `{v,type:'state',revision,items,hotbar,goal}` | 增加可选 `tech: UiTechState \| null` | 缺失/null 时前端显示初始化态，**不整包丢弃**（仿 `parseGoalView` 的防御式解析 `goal-view.ts:92-147`） |
| 上行命令 | hello / state/request / hotbar/* | 增加 `tech/submit {nodeId,itemId,count}`、`tech/track {nodeId}` | 未知命令继续 `unknown-command` 拒绝（`:89-90`）；命令参数校验失败返回 code+message，不抛异常 |
| 推送去重 | `stateSignature` 只含物品计数+hotbar（`:138-145`） | 签名追加 `tech` 视图签名（节点状态+已交计数+追踪） | 科技变化必须改变签名，否则 UI 不刷新（D8）；沿用 `bridge.pack.ts:59-79,135-153` 的每帧比较 |
| 前端解析 | `parseState` 校验 items/hotbar，解析 goal | 增加 tech 解析与回退 | 形状错误逐字段回退，不丢弃整包（`frontend-ui-protocol.ts:65-93`） |
| 面板状态 | 前端不本地改状态 | 提交后**等待下一帧状态刷新** | 与背包/hotbar 现有单向数据流一致（`frontend-ui.ts:413-457`） |

### 2.4 禁止重复造轮子（数据边界红线）

- 不新增物品、不新增可放置机器、不新增接口盒/结构模块种类（设计 §1.2 第 2 条）。
- 不建第二套配方表/物品表/机器表：科技节点只**引用** `ItemId/RecipeId/PartId/PortModuleId/StructureModuleId`（设计 §3.1）。
- 不建第二个库存：交付只调 `inventory.has/remove`；不新增「科技仓库」。
- 不建第二套订单/目标状态机：`goal` 保留为教学与文案模板（设计 §6.4），科技用它「只读投影 + code+message 阻塞文案」的模式，不复用其 latch。
- 不改动力/加工/端口/连接/组合的求解与语义：只加门控入口（设计 §1.2 第 3 条）。

---

## 3. 修改面估算

### 3.1 按模块估算（人天与行数均为量级估计，E1 收口时以实际为准）

| 模块 | 新增 | 修改 | 预计行数 | 20 KB 注意 | 子阶段 |
|:--|:--|:--|--:|:--|:--|
| tech 数据层 | `assets/tech/types.ts`、`nodes-stage1/2/3.ts`、`nodes.ts`、`validate.ts` | — | 550–700 | 节点按阶段拆 3 文件，单文件 < 20 KB | E1 |
| tech 状态与事务 | `assets/tech/state.ts`（纯状态机+交付事务） | — | 220–300 | 纯逻辑、零引擎依赖 | E1 |
| tech 门控 | `assets/tech/gates.ts`（查询函数） | — | 120–180 | 只导查询，不导状态 | E1 |
| tech 插件 | `assets/tech/tech.pack.ts`、`start-kit.ts` | `assets/scene-owner.pack.ts`（+1 挂载） | 240–300 | 插件只做接线 | E1 |
| mechanical | — | `mechanical/parts.ts`、`mechanical.pack.ts`、`mechanical/runtime.ts` | +120–170 | `mechanical.pack.ts` 已 22,156 B（超限文件）；本阶段只做小幅增量并复用 `BIG_FILE_LIMIT` 机制，长期拆分另立任务 | E1 |
| production | — | `production/recipes.ts`（+6 配方）、`production.ts`（过滤/count）、`production-runtime.ts`（注入查询） | +90–140 | `production.ts` 8.8 KB，安全 | E1 |
| industrial | — | `industrial/port.pack.ts`、`assembly-system.ts` | +70–110 | `assembly-system.ts` 15,993 B，接近上限，只小幅增量 | E1 |
| 测试（E1） | `__tests__/tech-nodes.test.ts`、`tech-state.test.ts`、`tech-gates.test.ts`、`tech-read.test.ts` | 5–6 个既有测试契约同步（见 3.2） | 500–700 | 按测试主题拆文件 | E1 |
| 协议 v2 | `game-ui-bridge/tech-view.ts` | `protocol.ts`、`frontend-ui-protocol.ts`、`bridge.pack.ts` | 240–340 | 协议文件均 < 6 KB | E2 |
| 科技页 UI | `frontend/frontend-tech-panel.ts`（列表/详情/提交）、`frontend/frontend-tech-styles.ts` | `frontend-ui.ts`（Tab 双标签/挂载/暂停语义）、`frontend-ui-styles.ts` | 420–560 | `frontend-ui.ts` 16,690 B 接近上限：新增逻辑放新文件，只留挂载与 render 调用 | E2 |
| HUD 追踪卡 | `frontend/frontend-tech-tracker.ts` | `frontend-ui.ts`、`frontend-ui-styles.ts` | 160–240 | 复用 302px 区域，不改布局骨架 | E2 |
| 新验收脚本 | `scripts/p2e-tech-ui.mjs` + `p2e-tech-ui-lib.mjs` | — | 350–450 | 单文件 < 20 KB（沿用 P2-B/C/D 拆分方式） | E2 |
| 终局与诊断 | `assets/tech/project.ts`、`run-proof.ts`、`frontend/frontend-diagnostics-panel.ts`、`frontend/frontend-completion-panel.ts` | `tech/nodes-stage3.ts`、`tech/state.ts` | 600–800 | 运行证明与诊断各自独立文件 | E3 |
| 数值与全流程 | `scripts/p2e-full-demo.mjs` + 场景文件 | `production/recipes.ts`（批量配方）、世界矿点数据、`docs/PROGRESS.md` | 400–600 | 脚本按场景拆分，每个 < 20 KB | E3 |

### 3.2 会触碰既有验收脚本的文件与脚本（E1 必读）

| 脚本 | 依赖的既有契约 | 改动会怎么破坏它 | 处置 |
|:--|:--|:--|:--|
| `scripts/m17a-playthrough.mjs` | 套件精确数量：`counts[0]===24 && counts[4]===5`（`:29`）、布局后逐项数量（`:54`） | 新起步包数量全变 → 首步即红 | E1 同步断言（或走 legacy 开关） |
| `scripts/m18c-production.mjs`（+ `-forge.mjs`） | 硬编码槽位 `SHAFT=0/GEAR12=1/GEAR24=2/CHUTE=6/VERTICAL=7/FLYWHEEL=8/CRUSHER=9/SMELTER=10/FORGE=11`（`:11-19`）；套件至少 1 个接口盒（`:98`） | 槽位与数量变化 → 全程按错物品 | E1 同步槽位常量与套件断言 |
| `scripts/m18e-playtest.mjs` | 复用 `m18c-production` 全流程（`:14,24`） | 跟随 m18c 一起红 | E1 随 m18c 更新，超时预算不变 |
| `scripts/m20-first-order.mjs`（+ `m20-order-lib/-phase-a/-phase-b.mjs`） | 槽位常量（`m20-order-lib.mjs:5-11`）；R 循环按 recipeId 断言；完成态 HUD `state==='complete' && 8/8`（`m20-order-phase-b.mjs:193-200`） | 套件/槽位变化、或 HUD 在完成瞬间切到科技追踪卡 → 完成断言失败 | E1 更新套件；E2 定 HUD 切换时机（D5），必要时同步脚本 |
| `scripts/m20c-hud.mjs` | 槽位常量（`:10-16`）、订单面板 DOM 选择器（`.ii-goal-*`） | HUD 结构变化/布局改动 → 断言失败 | E2 同步选择器；布局数值不变则影响小 |
| `scripts/p2b-ports.mjs`（+ `-lib/-phase-abc/-def`） | `PORT_KIT` 4/3/1/1；R 循环到 `forge-interface-box`（`p2b-ports-phase-abc.mjs:143-154`） | 接口盒套件取消 + 配方门控 → 无法造盒、R 循环死循环 | E1/E2 同步：走 legacy 或脚本内先解锁 |
| `scripts/p2c-links.mjs`（+ `-lib`） | 输出/分流/合流盒来自套件；按 recipeId 切换配方（`p2c-links-lib.mjs:134-141`） | 套件取消/配方隐藏 → 建链失败 | E1/E2 同步 |
| `scripts/p2d-assembly.mjs`（+ `-lib/-scene-*`） | 4 个结构框架来自 `STRUCTURE_KIT_COUNT`；`P` 模式无门槛 | 结构套件取消 + P 门控 → 场景 A 起即红 | E1/E2 同步 |

> 计数口径：设计文档 §1.2 记 6 条（M1.8 / P1 / P2-B / P2-C / P2-D）。按 P2-D §13 的实际回归清单为
> `m18c-production`、`m20-first-order`、`p2b-ports`、`p2c-links`、`p2d-assembly` 五条，加 P1-C 的 `m20c-hud` 恰为 6；
> `m17a-playthrough` 与 `m18e-playtest` 不在 6 条内，但**必须一起验证**（前者卡套件数量，后者 15 分钟真实体验）。

**会从源码侧波及脚本的修改点**（脚本红不红，取决于这些文件的契约是否变）：

| 源码文件 | 波及脚本 | 原因 |
|:--|:--|:--|
| `assets/mechanical/parts.ts`（套件表/槽位表） | 全部 8 条脚本 | 槽位与数量被脚本硬编码（`m17a-playthrough.mjs:29,54`、`m20-order-lib.mjs:5-11`、`p2b-ports-lib.mjs:18-25`） |
| `assets/mechanical/mechanical.pack.ts`（`grantKit`） | 全部 8 条脚本 | 开局发放内容与槽位绑定的唯一来源（`:128-139`） |
| `assets/industrial/port.pack.ts`（`PORT_KIT`/安装门控） | `p2b-ports`、`p2c-links` | 盒数量（4/3/1/1）与安装可用性 |
| `assets/industrial/assembly-system.ts`（结构套件/P 模式） | `p2d-assembly` | 4 个结构框架 + `P` 直接进入 |
| `assets/production/recipes.ts`（+6 配方/过滤） | `m18c-production-forge`、`p2b-ports`、`p2c-links` | R 循环可见集合与顺序 |
| `assets/frontend/frontend-ui.ts` + `frontend-ui-styles.ts`（HUD 切换/布局） | `m20c-hud`、`m20-first-order` | 订单面板 DOM 选择器与完成态可见性 |

### 3.3 20 KB 钩子与拆分策略

- 门禁：全局 pre-commit 钩子 `C:/Users/Admin/.dsh/git-hooks/pre-commit`，代码文件 > 20 KB 拒绝提交；Markdown/资产不检查（证据：P2-A-INVESTIGATION §钩子；P2-D 报告使用 `BIG_FILE_LIMIT=40960` 机制而非 `--no-verify`）。
- 既有超限文件（改动需特别小心，只做小幅增量）：`build/build.pack.ts` 28,826 B、`mechanical/visuals.ts` 25,681 B、`build/floors.pack.ts` 23,297 B、`mechanical/mechanical.pack.ts` 22,156 B、`scripts/m18-helpers.mjs` 22,264 B。
- 接近上限（新增逻辑应优先放到新文件）：`industrial/assembly-runtime.ts` 19,573 B、`mechanical/runtime.ts` 17,250 B、`frontend/frontend-ui.ts` 16,690 B、`industrial/assembly-system.ts` 15,993 B、`production/production-runtime.ts` 16,585 B。
- 策略：E1 把科技逻辑全部放 `assets/tech/`（单文件目标 < 12 KB）；E2 的科技页/追踪卡各自独立文件；E3 的终局/运行证明/诊断各自独立文件；验收脚本按「入口 + lib + 场景」拆分（沿用 P2-B/C/D 模式）。

### 3.4 修改面合计

| 子阶段 | 新增文件 | 修改文件 | 预计代码行（含测试） | 预计人天 |
|:--|--:|--:|--:|--:|
| E1 | 10–12 | 8–10 + 5–6 测试 + 8 脚本 | 1,700–2,300 | 10–13 |
| E2 | 5–7 | 6–8 | 1,300–1,700 | 9–11 |
| E3 | 6–8 | 5–7 | 1,400–1,900 | 12–15 |

---

## 4. P2-E1 / P2-E2 / P2-E3 拆分

### 4.0 子阶段边界与回滚点

| 子阶段 | 一句话目标 | 可独立验收的产物 | 回滚点（不需要改设计） |
|:--|:--|:--|:--|
| E1 | 科技从 0 行代码变成「可判定、可门控、可读」的数据层 | 单测全绿 + 唯一 read 出现 `tech` + 6 条基线 + `m17a`/`m18e` 全绿 | 门控总开关置 `legacy`（默认值），行为回到 P2-D |
| E2 | 玩家能用真实 UI 交付并看到解锁 | 真实游戏完成 ≥3 个节点 + 追踪卡 + 布局 0 警告 | 协议 v2 与 UI 面板可整体回退到 v1；E1 数据层不受影响 |
| E3 | 从阶段 2 能稳定打到 Demo 终局并被自动验收 | 全流程 playthrough 通过 + 材料预算可复现 | 终局判定与诊断面板可单独关闭（节点 T3.3 变「未开放」横幅），不影响 E1/E2 |

### 4.1 P2-E1：科技数据层与门控

| 维度 | 内容 |
|:--|:--|
| 目标 | 12 节点纯数据 + 校验器；状态机与交付事务；五类门控；「继承工坊」起步包；唯一 GameRead 扩 `tech`；单测与既有测试契约同步 |
| 做 | ① 节点数据按阶段拆文件 + 校验（ID 唯一、前置存在无环、成本物品存在、解锁目标存在、阶段不跳跃，设计 §3.2/§3.4）；② `TechState` 派生（locked/available/researching/completed）+ 单物品原子交付 + 多物品补偿事务（设计 §6.2/§6.3）；③ 门控：配方（`recipesFor` 过滤）、机器（`place/canPlacePart`）、端口（`installModule`）、结构（`placeFrameAt` + `P`）、能力（`J/H` 建链、`K/L` 安装）；④ 起步包替换（设计 §9.2）；⑤ `tech` 服务 `provide` + read 子字段；⑥ 新增 6 条配方数据（需用户授权 2） |
| 不做 | 科技 UI、协议 v2、HUD 追踪卡、终局项目、诊断视图、数值平衡、存档落盘、市场、任何新物品/机器 |
| 依赖前置 | 用户 Q1（起步包授权）、Q2（6 条配方授权）必须先答复；D1（门控/套件开关机制）、D2（tech ID 格式）、D3（配方选择身份）、D11（E1 是否留游戏内开发通道）定案；基线 6 条脚本在 `f0fd623` 上复跑通过（见 §7.2） |
| 主要交付文件 | `assets/tech/{types,nodes,nodes-stage1,nodes-stage2,nodes-stage3,validate,state,gates,start-kit,tech.pack}.ts`；修改 `mechanical/parts.ts`、`mechanical/mechanical.pack.ts`、`mechanical/runtime.ts`、`production/recipes.ts`、`production.ts`、`production-runtime.ts`、`industrial/port.pack.ts`、`industrial/assembly-system.ts`、`scene-owner.pack.ts` |
| 技术门 | `pnpm test`（新增 tech 5 组单测；既有 555 用例全部保持通过、总数只增不减；5–6 个契约同步文件按新增配方/套件更新断言，不删除/弱化既有断言）；`pnpm typecheck`；`forgeax project check --json` → `ok:true`；`forgeax project build`；6 条基线 playthrough + `m17a`/`m18e` 全绿；新增 `scripts/p2e-tech-read.mjs` 断言：`state.tech.unlocked` 为数组、`states` 覆盖 12 个节点、初始全 `locked`、JSON 可往返、`trackedId` 可空 |
| 门控断言点（单测） | 未解锁配方不出现在 `recipesFor` 结果、R 循环整轮回不到它；未解锁零件 `place()` 返回 false 且库存不变；未解锁接口盒 `installModule` 无效果；未解锁结构 `P` 不进模式；未解锁时 `J/H` 无连接产生；交付不足时库存不变、满额时一次性 `completed`；重复交付被拒且计数不超需求 |
| 体验门（开发者手工，30 分钟） | 以新起步包开局：只有 1 飞轮/1 破碎/1 熔炼/1 锻压 + 8 轴/4+2 齿轮/1 立式带/2 溜槽；能做完阶段 0 教学订单；想造齿轮时看见「未解锁」的明确阻塞文案；不做 UI 观感评估（留给 E2） |
| 退出条件 | 全部门禁绿；6 条基线 + `m17a`/`m18e` 全绿；`tech` read 字段可被脚本读取；无第二个 GameRead、无第二套物品/配方表；legacy/门控开关机制与默认值写入 PROGRESS |
| 工作量 | 10–13 人天（其中脚本迁移 3–4 人天） |
| 主要风险 | R1/R2/R3（设计 §13.1）+ D1/D2/D3/D11；最大单项是「8 条脚本的槽位/数量迁移」 |

### 4.2 P2-E2：科技 UI 与协议 v2

| 维度 | 内容 |
|:--|:--|
| 目标 | 玩家在真实游戏里用 `Tab` 科技页交付材料、解锁节点、看到追踪卡；门控对玩家可见可理解 |
| 做 | ① 协议 v2（`tech` 字段 + 2 条命令 + 签名）；② 科技页：左阶段列表 / 中节点卡片 / 右详情 + 逐项提交 + 「一键交齐」补偿事务 + 已交付不可逆提示（设计 §7.1/§7.2/§6.2）；③ HUD 追踪卡与订单 HUD 切换（设计 §7.3）；④ 1280×720 与 1280×600 布局；⑤ 新 playthrough `scripts/p2e-tech-ui.mjs`；⑥ 同步 6 条脚本的套件/槽位/HUD 断言并把默认流程切到新起步包 |
| 不做 | T3.3 终局、T3.2 诊断视图、数值平衡、存档落盘、市场、新节点/新物品、订单逻辑改动 |
| 依赖前置 | E1 全绿；用户 Q5（Tab 内科技页）答复；D5（HUD 切换时机）与 D8（tech 签名）定案；协议双端同一提交发布 |
| 主要交付文件 | 新增 `game-ui-bridge/tech-view.ts`、`frontend/frontend-tech-panel.ts`、`frontend/frontend-tech-styles.ts`、`frontend/frontend-tech-tracker.ts`、`scripts/p2e-tech-ui.mjs`（+lib）；修改 `protocol.ts`、`frontend-ui-protocol.ts`、`bridge.pack.ts`、`frontend-ui.ts`、`frontend-ui-styles.ts` |
| 技术门 | `pnpm test`（tech-view 视图/签名/解析、协议 v2 命令校验、前端面板纯逻辑）；`pnpm typecheck`；`check`/`build` 全绿；`scripts/p2e-tech-ui.mjs`：断言提交 1 件 → `delivered` +1 且库存 -N；最后一件提交 → 节点 `completed` 且对应配方进入 R 循环；追踪卡 DOM 出现且显示进度；`project play` 的 layout warnings = 0；多张截图（available/researching/completed/1280×600）；6 条基线 + `m17a`/`m18e` 全绿 |
| 体验门（不看代码，25–35 分钟） | 从开局新建工厂 → 打开 `Tab` → 看懂 12 个节点与前置 → 交付完成 T1.1、T1.2、T1.4（至少 3 个）→ 用解锁的齿轮配方造出齿轮并布进新的动力线；能说清「缺什么材料/为何灰显/已交不能退」；1280×600 下三栏不溢出、不与快捷栏/目标区重叠 |
| 退出条件 | 真实游戏可完成 ≥3 节点；布局 0 警告；截图逐张人工检查；协议 v2 双端一致；`tech` 推送不丢帧（交付后 ≤1 帧 UI 刷新） |
| 工作量 | 9–11 人天 |
| 主要风险 | R2/D5（HUD 切换与订单完成断言）、D8（签名）、D9（1280×600 三栏）、frontend-ui.ts 体积 |

### 4.3 P2-E3：终局、诊断与平衡

| 维度 | 内容 |
|:--|:--|
| 目标 | 从阶段 2 能稳定推进到 Demo 终局；终局条件体现「多级加工 + 多机协作 + 真实连接 + 真实动力 + 组合机械」；全流程自动验收 |
| 做 | ① T3.1 批量配方（3 条，必要时做 `outputs[0].count` 展开）；② T3.2 诊断视图（只读：成员/动力/连接/各核心产出/堵塞原因，设计 §4.12）；③ T3.3 终局：成套交付 + 运行证明（设计 §4.13），口径在 D4 定稿；④ 结算/完成横幅；⑤ 数值平衡（矿点供给方案，用户 Q3；成本/时长复现）；⑥ `scripts/p2e-full-demo.mjs`（阶段 0→3）；⑦ 若存档 P0 就绪，并入 `tech` 快照字段与恢复 |
| 不做 | 工业市场（P2-F）、新机器/物品、风力/水力/蒸汽/传送带/电力、嵌套组合/整体移动、多槽位/云存档、多输入多输出配方 |
| 依赖前置 | E2 全绿；用户 Q3（矿量）与 Q4（终局双条件）答复；D4（运行证明口径）、D7（产出归属）定案；批量配方 count 语义已用单测确认；存档 P0 状态明确（并行或延后） |
| 主要交付文件 | 新增 `assets/tech/project.ts`、`assets/tech/run-proof.ts`、`frontend/frontend-diagnostics-panel.ts`、`frontend/frontend-completion-panel.ts`、`scripts/p2e-full-demo.mjs`（+场景）；修改 `tech/nodes-stage3.ts`、`tech/state.ts`、`production/recipes.ts`、世界矿点数据 |
| 技术门 | `pnpm test`（project 判定、运行证明窗口可注入时间、诊断视图纯逻辑、count 展开、存档往返）；`typecheck`/`check`/`build`；`scripts/p2e-full-demo.mjs` 断言：12 节点全 `completed`、`tech.unlocked` 含 `tech:combined-works`、16 件成套物品库存精确下降、`assemblies` 中 ≥3 成员组合、≥2 条 active 物料连接、≥2 台 powered 成员、窗口内产出达阈值、结算面板 DOM 出现、console 0 / page 0、layout 0；6 条基线 + E2 脚本回归全绿 |
| 体验门（不看代码，90–120 分钟） | 从开局一路通关：阶段 0 教学 → 阶段 1 基建 → 阶段 2 多核/组合 → 阶段 3 批量产线 → 终局交付；能复述每阶段能力变化；卡住时诊断视图给出具体原因；终局有「工厂建成」的完成感；刷新前（无存档时）明确提示进度仅会话内 |
| 退出条件 | 全流程通过；材料预算可复现（≈210 铁锭当量，与设计 §11.2 一致；供给方案 A 的 250 留出余量）；诊断视图只读、不影响帧率与操作；存档字段若就绪则往返一致，否则明确记录为「会话内」限制 |
| 工作量 | 12–15 人天 |
| 主要风险 | R5（矿量）、R6/R7（产出归属与 count）、D4/D7、时长超预算导致体验门被压缩 |

### 4.4 每个边界必须能做的中间验收（不允许的中间态）

| 边界 | 必须可验收 | 不允许出现的中间态 |
|:--|:--|:--|
| E1 结束 | 门控关闭 = 旧体验完全一致；门控开启（测试开关）= 单测与 read 断言通过 | 门控开着但玩家没有任何交付入口（死锁，见 D1） |
| E2 结束 | 真实玩家不借任何开发通道完成 ≥3 节点；6 条脚本在新起步包上全绿 | UI 能提交但门控未生效（可白嫖解锁）；协议 v1/v2 混跑 |
| E3 结束 | 全流程通关 + 材料预算可复现；终局可回退为纯交付 | 终局靠「摆拍」通过（无运行证明的降级必须在报告里显式标注） |

---

## 5. 风险矩阵

### 5.1 设计文档 §13.1 的 R1–R8

| # | 风险 | 概率 | 影响 | 缓解（将来时） | 验证方法 |
|--:|:--|:--|:--|:--|:--|
| R1 | 替换原型套件破坏 6 条既有 playthrough | 高 | 高 | 二选一：脚本迁移为主、legacy 开关兜底（默认值随阶段切换，见 D1）；逐条核对 `m17a/m18c/m18e/m20*/p2b/p2c/p2d` 的套件与槽位断言 | E1 收口时 6 条 + `m17a`/`m18e` 全绿；任一条红即不算通过 |
| R2 | 配方门控改变锻压机 R 循环 | 高 | 中 | 门控只过滤可见集合、不改 `MACHINE_RECIPES` 数组顺序；脚本按 `recipeId` 断言而非下标（`m18c-production-forge.mjs:22` 已是 ID 断言） | `p2b-ports-phase-abc.mjs:143-154` 的 R 循环仍能到达 `forge-interface-box` |
| R3 | 交付材料不返还 | 中 | 中 | 首次提示 + 「一键交齐」只在全齐时可用 + 界面明示不可逆 | E2 截图与手工操作确认提示文案；单测确认不返还 |
| R4 | 无存档，刷新丢进度 | 高 | 中 | E1/E2 在验收说明中写明「仅会话内」；E3 与存档 P0 合并验收 | 每次验收报告显式登记该限制；E3 若 P0 就绪则跑刷新用例 |
| R5 | 矿量不足（80 铁锭当量 < ≈210 需求） | 高 | 高 | 用户 Q3 授权后按设计 §11.3 方案 A 调整矿点数据 | E3 playthrough 输出的总消耗与剩余矿量可复现 |
| R6 | 终局按组合统计产出，可能踩第二 read | 中 | 中 | 聚合放进 `tech` 服务/read 子字段；只读、不改运行时；口径见 D4 | 代码审查确认无第二个 `registerRead`；单测确认聚合不写世界 |
| R7 | 批量配方依赖 `Recipe.outputs[0].count` | 中 | 中 | E1 先用单测验证 `producedTotal += out.count` 与输出空间预检；若需改动，限制在「产出 count 展开」一处并补测试 | 单测：4 铁锭 → 2 传动轴时 `inputCount` 扣 4、`outputCount` +2、`producedTotal` +2 |
| R8 | 12 格快捷栏已满 | 高 | 低 | Demo 不加新物品；新起步包占用更少槽位；未解锁物品不绑定 | E2 新起步包下槽位映射表被脚本断言；空槽语义不变 |

### 5.2 本文件补充的依赖风险

| # | 风险 | 概率 | 影响 | 缓解 | 验证方法 |
|--:|:--|:--|:--|:--|:--|
| D1 | E1 无 UI 却让门控生效 → 没有任何交付入口，进度死锁 | 高 | 高 | 门控/起步包开关默认 `legacy`，E2 与 UI 同阶段切到新流程；E1 的新流程只在新脚本/单测里以测试开关开启 | E1 收口：6 条基线绿且新脚本断言门控开启后的初始全 locked |
| D2 | `tech:<slug>` 与既有稳定 ID 规则冲突（`STABLE_ID_PATTERN` 只允许 `.`/`-`，`industrial/ids.ts:20`） | 高 | 低 | E1 首日定案：新增 `TECH_ID_PATTERN`（`tech:`）或改用 `tech.<slug>`；`assertStableId` 不用于 tech ID | 校验器单测：非法/合法 ID 各一组；节点引用物品/配方/机器 ID 全部通过 `assertStableId` |
| D3 | 解锁集合变化会让 `MachineState.recipeIndex` 指向别的配方（`production.ts:62-67` 用下标） | 高 | 高 | 二选一：`MachineState` 改存 `recipeId`（读档/升级时旧下标映射一次）；或解锁时对所有机器 `recipeIndex` 做重映射（按旧列表中的 ID 定位新下标） | 单测：先解锁后置 index 的机器在集合变化后仍指向同一 `recipeId`；playthrough：先造某配方再解锁新配方，机器不换配方 |
| D4 | 终局运行证明口径二义（**已定案**） | 低 | 中 | 方案 B：对组合成员的加工核心取每机 `producedTotal` 增量求和（`production.ts:32,231`，字段已存在、既有测试在用）；全局 `production.produced` 仅作降级；E3 单测固定口径并在报告注明 | 单测：窗口内成员增量达标、非成员增量不计；playthrough 断言阈值 |
| D5 | HUD 在订单完成瞬间切到科技追踪卡，破坏 `m20-first-order` 的 `state==='complete' && 8/8` 断言（`m20-order-phase-b.mjs:193-200`） | 高 | 中 | E2 定规则：订单完成横幅保留到玩家首次打开科技页/首次交付，再切换；脚本显式断言「切换」这一帧 | `m20-first-order`（或迁移后的脚本）先读到完成态，再读到追踪卡 |
| D6 | 脚本硬编码槽位（`m20-order-lib.mjs:5-11`、`p2b-ports-lib.mjs:18-25`）与新起步包不一致 | 高 | 高 | E1 统一维护一份「槽位映射常量」供脚本引用（或脚本读 `ui.hotbar.slots` 反查），不再写死数字 | 脚本内 grep 不到字面量槽位；新起步包下所有脚本首步通过 |
| D7 | `production.produced` 是全局累计，无法按组合成员归属（`production-runtime.ts:315,417-420`） | 中 | 中 | 若走成员归属：用 `machines[].producedTotal` 的成员增量求和（只读聚合，不改运行时）；否则按 D4 方案 A | 单测：两台机器一台属于组合、一台不属于，窗口统计只计成员 |
| D8 | `stateSignature` 不含 tech，交付后 UI 不刷新（`protocol.ts:138-145`） | 中 | 中 | 签名追加 tech 视图签名；`bridge.pack.ts:135-153` 每帧比较 | E2 脚本：提交后 ≤1 帧 DOM 进度变化 |
| D9 | 1280×600 下科技页三栏或追踪卡溢出/重叠（背包框 `min(1040px,94vw)×min(660px,84vh)`，600 高时 ≈504px） | 中 | 中 | 复用现有背包尺寸与 24px 安全边距；三栏在 600 高时改为窄列 + 详情滚动；`project play` 的 layout 检查纳入门禁 | `project play` 输出 layout warnings=0；两张 1280×600 截图人工检查 |
| D10 | 协议 v2 双端版本不匹配：`parseUiCommand` 对版本不符直接拒绝（`protocol.ts:66`），`parseState` 版本不符返回 undefined（`frontend-ui-protocol.ts:68`）→ UI 整块不渲染 | 中 | 高 | 双端同一提交发布；`tech` 字段单独防御式回退（缺字段/畸形不丢弃 v2 整包）；保留一个阶段可切回 v1 的构建开关 | E2 联调：故意制造版本不符时 UI 显示初始化态而非白屏；构建产物内 `UI_PROTOCOL_VERSION` 只有一个值 |

---

## 6. 与 P2-F（市场）、存档 P0、HUD/UI 改版的接口约定

### 6.1 现在必须留好（否则后期返工）

| 交界 | 现在留什么 | 证据/理由 |
|:--|:--|:--|
| 市场 | `tech` 交付事务与市场交易**互不调用**；市场只买基础材料；科技节点成本只用 `ItemId`，不预留「市场价」字段 | 设计 §9.3；交付是消费、交易是购买，两套事务 |
| 存档 P0 | `TechState` 必须是纯 JSON（`version/delivered/unlocked/trackedId`），提供 `snapshot()`/`restore()` 边界；未知节点/物品逐条丢弃 | 设计 §8.1/§8.2；SAVE-ARCHITECTURE §3 已留 `version` 与容错原则 |
| 存档顺序 | 科技不依赖世界几何，快照顺序放在库存/快捷栏之后、与建筑/机械同批 | 设计 §8.2 |
| HUD 改版 | 追踪卡复用目标面板的 302px 区域（`frontend-ui-styles.ts:71-74`）；科技页在 `Tab` 背包模态内新增标签 | 设计 §7.3；避免 1280×600 重叠 |
| UI 协议 | 版本号统一走 `UI_PROTOCOL_VERSION`；`tech` 字段可选、防御式解析 | 设计 §7.4；与 goal 字段同一模式 |
| 组合诊断（P2-D 遗留） | 诊断视图只读 `assemblies/ports/links/networks/production` 快照；不新增世界状态 | 设计 §4.12；P2-D §15 R4 |

### 6.2 明确延后（不在 P2-E 做，也不为它预留复杂结构）

| 项 | 延后理由 | 留给谁 |
|:--|:--|:--|
| 市场购买科技锁定物 / 用市场跳过交付 | 会让科技树退化成「买买买」 | P2-F 明确禁止 |
| 多槽位/云存档/主菜单 | 存档 P0 尚不存在的上层能力 | 存档 P1/P2 |
| 组合信息面板与诊断合并 | P2-D 已明确本轮不做成员列表面板 | M2-D UI 阶段 |
| 机械信息侧栏 / 统一 Toast / 建造菜单 | 与本阶段目标无关 | M2 UI 改版 |
| 副产物、多输入多输出、传送带、电力 | 运行时只取 `inputs[0]/outputs[0]` | M3/M4 |

### 6.3 字段级预留（写进 E1 的接口，不写实现）

- `TechState`：`{ version: 1, delivered: Record<nodeId, Record<ItemId, number>>, unlocked: string[], trackedId: string | null }`（设计 §8.1）。
- read `tech`：`{ unlocked: string[], states: [{ id, status, delivered }], trackedId }`（设计 §7.4）。
- 协议命令：`tech/submit { nodeId, itemId, count }`、`tech/track { nodeId }`（设计 §7.4）。
- 能力枚举：`'material-link' | 'split-merge' | 'assembly' | 'line-diagnostics'`（设计 §3.2）；新增能力必须只追加。

---

## 7. 开工前置检查清单

### 7.1 用户待决 5 项（设计 §13.2）

| # | 待决问题 | 不答复的后果 | 影响子阶段 |
|--:|:--|:--|:--|
| 1 | 是否授权「继承工坊」起步包替代原型套件（6 条脚本需迁移） | R1/D6 无法收口，E1 无法开工 | E1 |
| 2 | 是否授权新增 6 条配方（齿轮 ×2、飞轮 ×1、批量 ×3） | T1.1/T2.4/T3.1 没有可再生产的解锁对象 | E1/E3 |
| 3 | 是否授权调整矿点储量（推荐 4×50 + 1 深层矿点） | 三阶段材料预算无法满足（设计 §11.2） | E3 |
| 4 | 终局是否采用「成套交付 + 运行证明」双条件（+1–2 天） | E3 终局口径不确定 | E3 |
| 5 | 科技页放在 `Tab` 背包模态内是否可接受 | E2 UI 方案不确定 | E2 |

### 7.2 工程基线核对（E1 开工首日）

| 项 | 期望值 | 证据 |
|:--|:--|:--|
| HEAD / 工作区 | `f0fd623`，`git status --short` 为空 | 设计文档开头 |
| 单测 | 57 文件 / 555 用例全绿 | P2-D §11 |
| 类型/检查/构建 | `typecheck` 通过、`check --json` `ok:true`、`build` 220 artifacts | P2-D §11 |
| 6 条基线 playthrough | 在最终代码上复跑并记录步数/耗时：`m18c-production` 136、`m20-first-order` 171、`m20c-hud` 93、`p2b-ports` 249、`p2c-links` 500、`p2d-assembly` 376 | P2-D §12/§13、P1-D §12 |
| 附加脚本 | `m17a-playthrough`（套件数量断言）、`m18e-playtest`（15 分钟体验）复跑通过 | M1.8 报告；m18c 依赖 |
| 存档 P0 状态 | 明确「并行」或「延后」；并行时 E1 起就以快照 v2 字段位开发 | SAVE-ARCHITECTURE §6 |
| 20 KB 钩子 | 确认全局 `pre-commit` 生效；超限文件清单与 `BIG_FILE_LIMIT` 机制可用 | P2-A-INVESTIGATION §钩子；P2-D §16 |

### 7.3 E1 首日必须定案的实现决策

| # | 决策 | 推荐 | 影响 |
|--:|:--|:--|:--|
| D1 | 门控/起步包开关键名与默认值 | `TECH_PROGRESSION = 'legacy' \| 'on'`，E1 默认 `legacy`，E2 切 `on`；legacy 仅用于既有旧脚本（6 条基线 + `m17a`/`m18e`） | 能否保持「每个中间态都可玩」 |
| D2 | tech 节点 ID 分隔符 | 新增 `TECH_ID_PATTERN` 接受 `tech:`（与 `link:`/`assembly:` 运行时 ID 风格一致），不走 `assertStableId` | 数据校验器与单测 |
| D3 | 配方选择身份 | `MachineState` 增存 `recipeId`（`recipeIndex` 保留为兼容字段） | R 循环与解锁顺序的稳定性 |
| D11 | E1 是否留游戏内开发通道 | 不留：E1 用测试开关而非游戏内后门；真实门控体验全部在 E2 验收 | 避免作弊后门泄漏到 Demo |
| D6 | 脚本槽位常量 | 脚本改为从 `ui.hotbar.slots` 反查物品→槽位，不写死数字 | 8 条脚本长期可维护性 |
| D8 | 协议签名 | 新增 `techViewSignature` 并并入 `stateSignature` | UI 交付后刷新 |

### 7.4 环境与提交

- 提交走项目后台 autosave/人工提交；不得 `--no-verify`（P2-D §16 的 `BIG_FILE_LIMIT=40960` 机制可对既有超大文件使用，新增文件必须 < 20 KB）。
- 不运行 `pnpm test/build/play` 之外的验收外命令；所有验收证据来自 `project play` 的 owner 浏览器与截图目录 `artifacts/play/scripts/...`。

---

## 8. 明确不纳入范围（P2-E 不做）

1. 不改动力、加工、端口、连接、组合的求解语义（只加门控入口）。
2. 不新增机器、物品、接口盒、结构模块种类；不新增第二个 GameRead。
3. 不实现市场/采购/点数；不实现风力/水力/蒸汽/传送带/电力；不实现副产物/多输入多输出。
4. 不实现存档与读档本身（只交付 `TechState` 字段契约；落盘由 P0 负责）。
5. 不重做 HUD、背包、快捷栏；不做主菜单/暂停菜单/设置/多槽位/云存档。
6. 不做组合整体移动/旋转/嵌套、结构承载/疲劳、跨层组合。
7. 不在 Demo 里放「未来节点」的假入口（设计 §10）。
8. **本阶段（P2-E0）不改任何游戏代码/资源/配方/测试/配置**，只产出文档。

---

## 9. 附录

### 9.1 建议的文件级改动清单（新增/修改 + 责任子阶段）

| 路径 | 新/改 | 职责 | 子阶段 |
|:--|:--|:--|:--|
| `assets/tech/types.ts` | 新 | TechStage/TechRoute/TechNodeDef/TechUnlock/TechState 类型 | E1 |
| `assets/tech/nodes-stage1.ts` / `-stage2.ts` / `-stage3.ts` | 新 | 12 节点数据按阶段拆分（避免单文件超 20 KB） | E1（E3 增 T3.x 细节） |
| `assets/tech/nodes.ts` | 新 | 聚合导出 + 索引（id→node、前置闭包） | E1 |
| `assets/tech/validate.ts` | 新 | 图校验：唯一/无环/前置存在/成本合法/解锁目标存在/阶段不跳跃 | E1 |
| `assets/tech/state.ts` | 新 | 状态派生、交付事务（单物品原子/多物品补偿）、trackedId | E1 |
| `assets/tech/gates.ts` | 新 | `isRecipeUnlocked/isPartUnlocked/isPortUnlocked/isStructureUnlocked/hasCapability` | E1 |
| `assets/tech/start-kit.ts` | 新 | 继承工坊清单（设计 §9.2）+ 槽位映射 | E1 |
| `assets/tech/tech.pack.ts` | 新 | 插件：`provide('tech')`、挂门控、暴露只读快照 | E1 |
| `assets/tech/project.ts` / `run-proof.ts` | 新 | 终局目标定义 + 运行证明只读聚合 | E3 |
| `assets/mechanical/parts.ts` | 改 | 套件表换源/保留 legacy 表；槽位映射单一来源 | E1 |
| `assets/mechanical/mechanical.pack.ts` | 改 | `grantKit` 换源；`place/canPlacePart/placePart` 门控；选中态过滤 | E1 |
| `assets/mechanical/runtime.ts` | 改 | read 增加 `tech`；注入 `tech` 服务 | E1 |
| `assets/production/recipes.ts` | 改 | 新增 6 条配方；配方→节点解锁映射（或放 tech 数据） | E1/E3 |
| `assets/production/production.ts` | 改 | 配方过滤注入；产出 count 展开（若验证需要） | E1 |
| `assets/production/production-runtime.ts` | 改 | `cycleMachineRecipe`/`activeRecipe` 走注入查询 | E1 |
| `assets/industrial/port.pack.ts` | 改 | `PORT_KIT` 门控；`installModule` 门控；`J/H` 能力门控 | E1 |
| `assets/industrial/assembly-system.ts` | 改 | 结构套件门控；`P` 模式门控；`placeFrameAt` 门控 | E1 |
| `assets/scene-owner.pack.ts` | 改 | 挂载 `plugin/tech`（inventory 之后、mechanical 之前） | E1 |
| `assets/__tests__/tech-*.test.ts`（4 个） | 新 | 数据/状态/门控/read 单测 | E1 |
| `assets/__tests__/{production,industrial-compat,industrial-catalog,structure-module,inventory,mechanical-items}.test.ts` | 改 | 配方/物品/套件契约同步（按实际命中同步） | E1 |
| `scripts/p2e-tech-read.mjs` | 新 | E1 真实游戏断言 `tech` read 字段与初始全 locked | E1 |
| `scripts/{m17a-playthrough,m18c-production,m18e-playtest}.mjs` | 改 | 套件/槽位断言迁移 | E1 |
| `scripts/{m20*,p2b*,p2c*,p2d*}.mjs` | 改 | 槽位/HUD/套件断言迁移 | E1（套件）E2（HUD） |
| `assets/game-ui-bridge/tech-view.ts` | 新 | `tech` 视图模型 + 签名 + 防御式解析 | E2 |
| `assets/game-ui-bridge/protocol.ts` | 改 | v2：`tech` 字段、2 条命令、签名 | E2 |
| `assets/game-ui-bridge/bridge.pack.ts` | 改 | 命令处理 + 推送 + 签名比较 | E2 |
| `assets/frontend/frontend-tech-panel.ts` / `-tech-tracker.ts` / `-tech-styles.ts` | 新 | 科技页、追踪卡、样式 | E2 |
| `assets/frontend/frontend-ui.ts` / `-ui-styles.ts` / `-ui-protocol.ts` | 改 | Tab 双标签、挂载、解析、布局 | E2 |
| `assets/frontend/frontend-diagnostics-panel.ts` / `-completion-panel.ts` | 新 | 诊断视图、结算面板 | E3 |
| `scripts/p2e-tech-ui.mjs` / `-lib.mjs` / `scripts/p2e-full-demo.mjs` + 场景 | 新 | E2/E3 真实游戏验收 | E2/E3 |
| 世界矿点数据（`assets/resource/**` 或 map 数据） | 改 | 按用户 Q3 调整储量/新增深层矿点 | E3 |
| `docs/PROGRESS.md` / 阶段报告 | 改 | 每阶段收口记录 | E1/E2/E3 |

### 9.2 最小可行路径（时间不足时的 E1+E2 最小子集）

| 优先级 | 最小子集 | 玩家得到什么 | 估算 |
|:--|:--|:--|--:|
| P0（不可砍） | 12 节点数据 + 状态机 + 交付事务 + 配方门控 + 机器门控 + 起步包 + `tech` read + 科技页提交/追踪 | 阶段 1–2 的配方与机器可按顺序解锁；6 条脚本全绿 | E1 的 70% + E2 的 80%，≈16–19 人天 |
| P1（可砍） | 端口/结构/能力门控（保留原型套件中的 9 盒 + 4 框） | 阶段 2 的接口盒/结构仍「开局就有」，但配方/机器仍有科技节奏 | 省 ≈2 人天 |
| P1（可砍） | T3.3 降级为纯成套交付（无运行证明） | 有终局交付，但没有「工厂真在跑」的证明 | 省 ≈1–2 人天（设计 §13.2 第 4 项） |
| P2（可砍） | 只在 1280×720 验收，1280×600 列为已知限制 | 仍可玩，但窄屏可能裁切（违反 AGENTS.md 验收要求，需显式记录） | 不建议砍 |

> 最小路径的硬底线：**交付扣料必须原子且不可返还**、**6 条既有 playthrough 必须全绿**、**不得新增第二个 GameRead**。
> 任何「先跳过门控、以后再补」的方案都会让科技树退化成装饰，等同于本阶段失败。

### 9.3 证据索引（本文引用的关键 file:line）

| 主题 | 证据 |
|:--|:--|
| 唯一 GameRead 注册与字段 | `assets/mechanical/runtime.ts:103-171,173-177` |
| 起步包 / 槽位 | `assets/mechanical/parts.ts:328-345,356-370,378-390`；`mechanical.pack.ts:128-139` |
| 放置事务与门控最佳插入点 | `assets/mechanical/mechanical.pack.ts:302-347` |
| 配方表与查询 | `assets/production/recipes.ts:158-179,182-189`；`production.ts:62-86,181-233` |
| 端口安装 / 套件 / 键位 | `assets/industrial/port.pack.ts:51-58,128-143,227-234`；`port-runtime.ts:140-167` |
| 结构放置 / 套件 | `assets/industrial/assembly-system.ts:51-53,96-99,245-250,261-312`；`assembly-runtime.ts:480-498` |
| 订单状态机 / HUD | `assets/goal/goal.ts:39-51,69-79,187-205`；`goal-service.ts:28-33`；`frontend/frontend-goal-panel.ts:26-190` |
| 协议 v1 | `assets/game-ui-bridge/protocol.ts:11,23-48,63-92,95-125,138-145`；`frontend-ui-protocol.ts:65-93` |
| 布局数值 | `assets/frontend/frontend-ui-styles.ts:3-13,71-74`；UI-SPEC 1280×720/600 |
| 稳定 ID 规则 | `assets/industrial/ids.ts:20-33` |
| 插件挂载顺序 | `assets/scene-owner.pack.ts:41-77` |
| 存档缺口与快照 | `docs/design/SAVE-ARCHITECTURE.md:8-36,38-73,94-110` |
| 既有回归基线 | `docs/m20/P2-D-REPORT.md:217-225,299-318`；`docs/m20/P1-D-REPORT.md:221-241` |
| 6 条脚本的套件/槽位断言 | `scripts/m17a-playthrough.mjs:29,54`；`scripts/m18c-production.mjs:11-19,98`；`scripts/m20-order-lib.mjs:5-11`；`scripts/p2b-ports-lib.mjs:18-25`；`scripts/m20-order-phase-b.mjs:193-200` |

---

*本文与 [P2-E0-TECH-TREE-DESIGN.md](P2-E0-TECH-TREE-DESIGN.md) 冲突时以设计文档为准；本文只补充实施顺序、依赖边界与验收口径。*
