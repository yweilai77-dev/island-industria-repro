# M2.0-P2-E0 现有工程能力调查报告

> 本文件是 P2-E 前置调查的唯一交付物（任务书 §七.1）。只记录**现状与缺口**，不含设计决策；
> "科技树应该怎么做"属于后续设计文档，不在本文件展开。

---

## 0. 文档信息

### 0.1 基本信息

| 项 | 值 |
|:--|:--|
| 阶段 | M2.0-P2-E0（P2-E 前置调查；**未进入 P2-E 实施**） |
| 基线 commit | `f0fd623`（完整 `f0fd6234cfcc7c8e135a79a456c6987ed1ea3437`），本次实测 `git rev-parse` 一致，`git status --porcelain` 为空 |
| 调查日期 | 2026-11-10 |
| 调查对象 | `E:\DeepseekHarness\ISLAND INDUSTRIA`（下称"仓库"），只读 |
| 交付物 | 本文件（`docs/m20/P2-E0-INVESTIGATION.md`），仓库内唯一新增文件 |
| 授权边界 | 不修改任何游戏代码/资源/测试/配方；不运行 `pnpm test`/`typecheck`/`build`/`project play` |
| 配套资料 | 仓库外事实表三份（见 0.5），本文件把其结论回填为仓库内 `file:line` |

### 0.2 调查方法与证据约定

- **方法**：只读静态阅读（read/grep/glob）+ 与既有阶段报告、三份事实表交叉核对；不做推测性运行。
- **证据格式**：`相对仓库根的路径:行号`。凡引用仓库外事实表的，标注"（事实表 A/B/C §x）"，其原始证据仍以 `file:line` 给出。
- **状态标注**：**已实现** = 有生产代码路径（多数有单测）；**部分实现（调试占位/仅数据）** = 只有数据、类型、调试件或运动学原型，运行时能力不完整；**未实现** = 代码中不存在。
- **推断**标注为"（推断）"，其余均为代码/文档可直接核对的事实。
- **行号时效**：全部行号基于 `f0fd623`，后续任何提交都会使其漂移。

### 0.3 基线统计（本次实测）

| 项目 | 数值 | 采集方式 |
|:--|--:|:--|
| `assets/**/*.ts` 文件总数 | 153 | `find assets -name '*.ts' \| wc -l` |
| 其中非测试源文件 | **92 个 / 17,081 行** | 同上排除 `assets/__tests__`，`wc -l` |
| 测试文件 | **57 个 / 9,076 行 / 555 用例** | `find assets/__tests__ -name '*.test.ts'`；`it(` 551 处 + `it.each`×4 |
| `assets` 一级目录 | 22 个 | `find assets -maxdepth 1 -type d` |
| 文档 | `docs/**/*.md` 26 个；`docs/m20` 阶段文档 13 个（本文件新增后 14） | `find docs -name '*.md'` |
| 验收脚本 | `scripts/*.mjs` 38 个 | `ls scripts/*.mjs` |
| 物品 / 配方 / 零件 / 加工核心 | 19 / 13 / 12 / 3 | 见 §1、§2 |
| 测试基线（既有报告口径） | 57 文件 / 555 用例全绿（P2-D 完成时） | `docs/m20/P2-D-REPORT.md:178` |

> 用例数说明：静态计数为 551 个 `it(` + 1 个 `it.each(`（`assets/__tests__/floors.test.ts:137`，4 组参数展开为 4 例）= **555**，与 P2-D 报告一致。

### 0.4 实际检查的文件与文档

**源码（本次逐一打开核对关键行）**

| 文件 | 行数 | 检查内容 |
|:--|--:|:--|
| `assets/items/items.ts` | 268 | 全文：19 物品定义、类别常量、接口盒归类的注释理由 |
| `assets/production/recipes.ts` | 194 | 全文：13 条配方、机器配方表、主输入/输出取值器 |
| `assets/mechanical/parts.ts` | 407 | 全文：12 零件、扭矩/能量/缓冲常量、原型套件、加工机器集合 |
| `assets/mechanical/power.ts` | 462 | 部分：模型边界、闭环、机器终端、过载、速度下垂 |
| `assets/mechanical/runtime.ts` | 352 | 部分：唯一 GameRead、摇柄、右键交互、R/C、每帧 goal 更新 |
| `assets/mechanical/mechanical.pack.ts` | 533 | 部分：套件发放、放置/拆除事务、R/Esc/Delete 输入、楼层判定 |
| `assets/mechanical/runtime-state.ts` | 450 | 引用（能量池/拓扑缓存，事实表 A §4） |
| `assets/mechanical/ports.ts` | 211 | 引用（连接判定，事实表 A §4.4） |
| `assets/industrial/processing-core.ts` | 189 | 部分：工艺表、安装位布局、槽定义、核心集合 |
| `assets/industrial/port-module.ts` | 126 | 部分：4 种接口盒静态定义与字段 |
| `assets/industrial/port.pack.ts` | 262 | 部分：套件 9 盒、安装/拆卸、键位让出 |
| `assets/industrial/port-runtime.ts` | 268 | 部分：安装校验顺序、拆卸返还、accept/drain |
| `assets/industrial/link-runtime.ts` | 353 | 部分：容量/对接常量、失败原因、状态枚举、公平游标 |
| `assets/industrial/assembly-runtime.ts` | 498 | 部分：组合定义、≥2 核心、快照字段、混层/归属校验、结构放置检查 |
| `assets/industrial/assembly-module.ts` | 69 | 部分：唯一结构模块定义 |
| `assets/industrial/assembly-system.ts` | 333 | 部分：结构套件 4 个、P 模式、原型供给注释 |
| `assets/industrial/catalog.ts` / `ids.ts` | 157 / 138 | 引用（稳定 ID 与派生索引，事实表 B §1） |
| `assets/production/production.ts` | 253 | 部分：状态字段、阻塞枚举、缓冲容量、tick/扣料/输出 |
| `assets/production/production-runtime.ts` | 435 | 引用（tick 编排、拆除返还、必须经接口盒） |
| `assets/production/transport.ts` | 121 | 引用（溜槽常量、交接） |
| `assets/goal/order.ts` | 154 | 全文：8 步、数量、机器、配方映射、阻塞码 |
| `assets/goal/goal.ts` | 228 | 部分：判定条件、latch、完成推导、快照 |
| `assets/goal/goal-service.ts` | 160 | 部分：observation 映射、首帧基线、服务面 |
| `assets/goal/goal-context.ts` / `goal-blockers.ts` / `observation.ts` | 170 / 166 / 71 | 引用（上下文、文案、只读类型） |
| `assets/game-ui-bridge/protocol.ts` | 147 | 部分：协议版本 1、5 条命令、2 种下行消息、state 字段 |
| `assets/game-ui-bridge/bridge.pack.ts` / `goal-view.ts` | 168 / 147 | 引用（命令分发、签名推送、视图解析） |
| `assets/hotbar/hotbar.ts` | 131 | 部分：12 格、bind 替换、零库存解绑 |
| `assets/inventory/inventory.ts` | 159 | 引用（无容量上限、整笔原子移除、无事务） |
| `assets/frontend/frontend-ui.ts` / `frontend-goal-panel.ts` / `frontend-ui-styles.ts` | 458 / 190 / 116 | 部分：DOM HUD、面板结构、布局数值 |
| `assets/frontend/frontend-ui-protocol.ts` | 92 | 引用（前端协议类型与防御式解析） |
| `assets/build/build.ts` / `build.pack.ts` | 163 / 722 | 引用（validatePlacement、建造输入让出） |
| `assets/grid/grid.ts` / `spatial/space.ts` / `spatial/support.ts` | 205 / 124 / 272 | 引用（格/层/支撑面常量） |
| `assets/resource/resource.ts` | 112 | 部分：矿点 4×20=80、储量常量 |
| `assets/runtime/zaohua-platform-init.js` | 8 | 全文：`initialize({ capabilities: [] })` |

**文档（本次核对）**

| 文档 | 行数 | 用途 |
|:--|--:|:--|
| `docs/m20/P2-D-REPORT.md` | 319 | 全文：当前系统最终状态、未实现清单、R1–R7 |
| `docs/m20/P2-A-DESIGN.md` | 489 | 部分：稳定 ID 定位、§8.2 后续翻转点（科技树/存档引用） |
| `docs/m20/P2-B-REPORT.md` | 345 | 部分：R5 物品分类缺口 |
| `docs/m20/P2-D-DESIGN.md` | 283 | 部分：结构框架"临时原型供给"声明 |
| `docs/design/SAVE-ARCHITECTURE.md` | 110 | 头部 §1/§2：状态内存表、6 个接口缺口 |
| `docs/PROGRESS.md` / `docs/ROADMAP.md` | 211 / 152 | 部分：未实现清单、12 格已满、M2 目标 |
| `docs/design/UI-SPEC.md` / `ART-DIRECTION.md` | 105 / 81 | 部分（经事实表 C/艺术清单引用） |

### 0.5 资料源（仓库外，不随仓库交付）

| 文件 | 行数 | 内容 |
|:--|--:|:--|
| `E:\DeepseekHarness\m2-investigation\e0\mech-facts.md` | 418 | 机械动力、机器放置/回收（事实表 A） |
| `E:\DeepseekHarness\m2-investigation\e0\industrial-facts.md` | 513 | 工业核心、接口盒、连接、Assembly、配方（事实表 B） |
| `E:\DeepseekHarness\m2-investigation\e0\goal-ui-facts.md` | 560 | 订单、UI、背包、持久化（事实表 C） |
| 合计 | 1,491 | 三份事实表的结论已在本文各节以 `file:line` 复核 |

---

## 1. 物品与配方

### 1.1 分类常量与物品总数

| 事实 | 内容 | 证据 |
|:--|:--|:--|
| 物品总数 | **19**（3 资源 + 16 机械类） | `assets/items/items.ts:12-31,47-67,241-245`；单测断言 19：`assets/__tests__/mechanical-items.test.ts:16` |
| 分类只有 2 个取值 | `ItemCategory = 'resource' \| 'mechanical'` | `assets/items/items.ts:10` |
| 物品定义字段 | `id/name/description/icon/maxStack/category`，**无** unlock/tier/tech 字段 | `assets/items/items.ts:33-45` |
| 接口盒为何借 `mechanical` | `category` 目前实际只承担"选中该物品时建筑系统是否让出输入"一个职责；注释写明"等 P2-E 科技树需要真正的物品分类时再拆出独立分类" | `assets/items/items.ts:98-106`；`assets/build/input-mode.ts:1-9`；`docs/m20/P2-B-REPORT.md:314`（R5） |
| 堆叠上限 | 19 种全部 `maxStack = 999` | `assets/items/items.ts` 各定义 |
| 库存容量 | **无上限**（可无限开新堆） | `assets/inventory/inventory.ts`（事实表 C §6.2） |

### 1.2 19 物品全表

| # | itemId | 中文名 | category | 分类定位 | 用途（描述摘要） | 配方角色 | 可放置 | 证据（items.ts） |
|--:|:--|:--|:--|:--|:--|:--|:--:|:--|
| 1 | `iron_ore` | 铁矿石 | resource | 基础原料 | 破碎机原料；4 个矿点采集 | 仅输入：`crush-iron-ore`×1 | 否 | 69-76 |
| 2 | `crushed_ore` | 碎铁矿 | resource | 中间品 | 熔炼炉原料 | 输入 + 输出（`smelt-crushed-ore` 两侧） | 否 | 80-87 |
| 3 | `iron_ingot` | 铁锭 | resource | 中间品 | 锻压机原料；唯一可造零件的中间品 | 输出 + 11 条锻造配方输入 | 否 | 88-95 |
| 4 | `shaft` | 传动轴 | mechanical | 可放置零件·传动 | 1 m 轴，两端接轴/齿轮/机器 | 输出 `forge-shaft` | 是 | 108-115 |
| 5 | `gear_12` | 12 齿齿轮 | mechanical | 可放置零件·传动 | 与 24 齿啮合转速加倍、反向 | **无配方** | 是 | 116-123 |
| 6 | `gear_24` | 24 齿齿轮 | mechanical | 可放置零件·传动 | 与 12 齿啮合转速减半、反向 | **无配方** | 是 | 124-131 |
| 7 | `power_source` | 测试动力源 | mechanical | 可放置零件·动力（**调试件**） | "M1.7 临时测试动力源；无限输出，可启停。不是正式动力来源" | **无配方** | 是 | 132-139 |
| 8 | `machine` | 冲压机 | mechanical | 可放置零件·加工（**M1.7 运动学原型**） | 曲柄冲头往复，**不消耗也不产出物品** | **无配方** | 是 | 140-147 |
| 9 | `vertical_drive` | 立式传动带 | mechanical | 可放置零件·传动（跨层） | 3 m 高，底部接同层轴、顶部接上一层轴，需楼板开孔 | 输出 `forge-vertical-drive` | 是 | 148-155 |
| 10 | `flywheel_source` | 手摇飞轮储能机 | mechanical | 可放置零件·动力（**正式源**） | 靠近按住 C 摇柄储能、右键离合、耗尽自动停转 | **无配方** | 是 | 156-163 |
| 11 | `crusher` | 破碎机 | mechanical | 可放置零件·加工核心 | 1 铁矿石 → 1 碎铁矿，须机械动力 | 输出 `forge-crusher` | 是 | 164-171 |
| 12 | `smelter` | 熔炼炉 | mechanical | 可放置零件·加工核心 | 1 碎铁矿 → 1 铁锭 | 输出 `forge-smelter` | 是 | 172-179 |
| 13 | `forge` | 锻压机 | mechanical | 可放置零件·加工核心 | 铁锭锻零件，R 切配方（11 条），C 投料、右键取货 | 输出 `forge-processing-core` | 是 | 180-187 |
| 14 | `chute` | 重力溜槽 | mechanical | 可放置零件·物流 | 无动力运输，堵塞不消失 | 输出 `forge-chute` | 是 | 188-195 |
| 15 | `interface_box` | 基础接口盒 | mechanical | **功能模块**（`port.through`） | 1 进 1 出通用物料接口；T/O 安装 | 输出 `forge-interface-box` | **否** | 196-204 |
| 16 | `output_interface_box` | 输出接口盒 | mechanical | **功能模块**（`port.output`） | 专用输出，仅装输出位 | 输出 `forge-output-box` | **否** | 205-213 |
| 17 | `splitter_box` | 分流接口盒 | mechanical | **功能模块**（`port.splitter`） | 1 进 2 出，轮询分配 | 输出 `forge-splitter-box` | **否** | 214-221 |
| 18 | `merger_box` | 合流接口盒 | mechanical | **功能模块**（`port.merger`） | 2 进 1 出，轮询合流 | 输出 `forge-merger-box` | **否** | 222-229 |
| 19 | `structure_frame` | 结构框架 | mechanical | 可放置零件·结构 | 组合机械结构模块；P 模式放置，须正交相邻 | 输出 `forge-structure-frame` | 是 | 230-238 |

**分类结论**

| 类别 | 数量 | 成员 |
|:--|--:|:--|
| 基础原料（只能采集/无配方产出） | 1 | `iron_ore` |
| 中间品（有配方产出、又作配方输入） | 2 | `crushed_ore`、`iron_ingot` |
| 可放置机械零件（有 `MechanicalPartDef`，能进快捷栏） | **12** | `shaft, gear_12, gear_24, power_source, machine, vertical_drive, flywheel_source, crusher, smelter, forge, chute, structure_frame`（`assets/mechanical/parts.ts:328-341`） |
| 功能模块（无 part def、不能放置、不进快捷栏） | **4** | 四种接口盒；`partDefForItem` 不认（`assets/mechanical/parts.ts:392-396`） |
| 合计 | 19 | 3 + 12 + 4 |

> 注意：`structure_frame` 同时是"可放置零件"（`kind='structure'`）与"结构模块"（`structure.frame`），不是独立分类。
> 因此"机械类 16 个"在数据上是 12 个可放置零件 + 4 个不可放置功能模块，**不存在** `component` 分类。

### 1.3 13 条配方全表

配方结构 `{ id, label, inputs: [], outputs: [], seconds }`，**没有 prototype/temporary/unlock 字段**（`assets/production/recipes.ts:19-29`）；
"临时原型供给"只由注释声明（`recipes.ts:72-76,85-88,113-120,145-148`）。`seconds` 为额定 60 RPM 下的时长，实际时长 = `seconds / rate`（`recipes.ts:10-11`）。

| # | RecipeId | 显示名 | 输入 | 输出 | seconds | 机器 | 是否临时原型供给 | 证据 |
|--:|:--|:--|:--|:--|--:|:--|:--|:--|
| 1 | `crush-iron-ore` | 破碎铁矿 | iron_ore ×1 | crushed_ore ×1 | 4 | `core.crusher` | 否（M1.8 正式生产链） | `recipes.ts:31-37` |
| 2 | `smelt-crushed-ore` | 熔炼铁锭 | crushed_ore ×1 | iron_ingot ×1 | 6 | `core.smelter` | 否（正式生产链） | `recipes.ts:39-45` |
| 3 | `forge-shaft` | 锻压传动轴 | iron_ingot ×2 | shaft ×1 | 5 | `core.forge` | 否（M1.8「产物反哺建造」） | `recipes.ts:48-54` |
| 4 | `forge-vertical-drive` | 锻压立式传动带 | iron_ingot ×3 | vertical_drive ×1 | 6 | forge | 否（M1.8） | `recipes.ts:56-62` |
| 5 | `forge-chute` | 锻压重力溜槽 | iron_ingot ×2 | chute ×1 | 4 | forge | 否（M1.8） | `recipes.ts:64-70` |
| 6 | `forge-interface-box` | 锻压基础接口盒 | iron_ingot ×2 | interface_box ×1 | 5 | forge | **是**（"不涉及科技解锁"，P2-B 追加） | `recipes.ts:72-83` |
| 7 | `forge-output-box` | 锻压输出接口盒 | iron_ingot ×2 | output_interface_box ×1 | 5 | forge | **是**（"不引入科技解锁"，P2-C 追加） | `recipes.ts:85-95` |
| 8 | `forge-splitter-box` | 锻压分流接口盒 | iron_ingot ×3 | splitter_box ×1 | 6 | forge | **是**（同上） | `recipes.ts:97-103` |
| 9 | `forge-merger-box` | 锻压合流接口盒 | iron_ingot ×3 | merger_box ×1 | 6 | forge | **是**（同上） | `recipes.ts:105-111` |
| 10 | `forge-crusher` | 锻压破碎机 | iron_ingot ×6 | crusher ×1 | 8 | forge | **是**（"加工核心复制配方"，P2-C） | `recipes.ts:113-127` |
| 11 | `forge-smelter` | 锻压熔炼炉 | iron_ingot ×7 | smelter ×1 | 9 | forge | **是**（同上） | `recipes.ts:129-135` |
| 12 | `forge-processing-core` | 锻压锻压机（原文如此） | iron_ingot ×8 | forge ×1 | 10 | forge | **是**（同上） | `recipes.ts:137-143` |
| 13 | `forge-structure-frame` | 锻压结构框架 | iron_ingot ×3 | structure_frame ×1 | 5 | forge | **是**（"获取/解锁规则留给 P2-E"） | `recipes.ts:145-155` |

**配方分布与顺序依赖**

| 事实 | 内容 | 证据 |
|:--|:--|:--|
| 每台机器配方 | `crusher:[crush-iron-ore]`、`smelter:[smelt-crushed-ore]`、`forge:[11 条]` | `assets/production/recipes.ts:158-174` |
| 锻压列表顺序 = R 键切换顺序 | 追加配方一律放末尾以保持已有下标 | `recipes.ts:74-76,85-88`；`recipeIndex` 切换：`assets/production/production.ts:80-86` |
| 订单用配方 | 仅 `crush-iron-ore`/`smelt-crushed-ore`/`forge-shaft`（即锻压 11 条中的第 1 条） | `assets/goal/order.ts:131-135` |
| 订单外锻压配方 | **10 条**（立式带、溜槽、4 种盒、3 条核心复制、结构框架） | 上表 #4–#13 |
| 无任何配方的物品 | 6 个：`iron_ore`（可采集）+ `gear_12`/`gear_24`/`power_source`/`machine`/`flywheel_source`（只能靠开局套件） | `assets/mechanical/parts.ts:356-370`；`recipes.ts:158-174` 输出集合 |

**临时原型供给的逐条结论**：真正被注释明确标为"临时/留给 P2-E"的是 **#6–#13 共 8 条**（P2-B 起新增的接口盒、核心复制、结构框架配方）；
#3–#5 是 M1.8 原始生产链的一部分；#1–#2 是唯一被订单使用的正式链首。P2-D 报告 R2 明确"结构框架获取是临时原型（4 个开局 + 1 条通用配方），不是最终经济/科技设计"（`docs/m20/P2-D-REPORT.md:287`，另见 `:254`）。

### 1.4 当前获取通道（与"解锁"直接相关）

| 通道 | 内容 | 触发/幂等 | 证据 |
|:--|:--|:--|:--|
| 开采 | 铁矿石，4 个矿点 × 20 = **80** 总量 | 每格采集动作 | `assets/resource/resource.ts:12-13,33-38`；埋点单测 `assets/__tests__/map-regression.test.ts:107-109`（事实表 A §6） |
| 机械原型套件 | 12 种零件共 **56 个** | World 资源键 `IslandIndustriaMechanicalKitGranted` | `assets/mechanical/mechanical.pack.ts:128-139`；`assets/mechanical/parts.ts:356-370` |
| 接口盒套件 | 4+3+1+1 = **9 个** | 资源键 `IslandIndustriaPortKitGranted` | `assets/industrial/port.pack.ts:51-58` |
| 结构框架套件 | **4 个** | 资源键 `IslandIndustriaStructureKitGranted` | `assets/industrial/assembly-system.ts:51-53,96-99` |
| 锻压制造 | 13 条配方中的锻造部分 | 需先有动力 + 三核心 + 铁锭 | `assets/production/recipes.ts` |
| **无途径** | 齿轮、测试动力源、冲压机、飞轮**没有任何补充配方**，除开局数量外不可再生 | — | `recipes.ts:158-174` 输出集合不含它们 |

---

## 2. 机器与接口

### 2.1 3 个加工核心的真实能力

加工核心定义由 `PRODUCTION_MACHINE_IDS` 派生（`assets/mechanical/parts.ts:402-407`；`assets/industrial/processing-core.ts:185-189`），共 **3 个 / 6 个安装位**：

| 核心 | 显示名 | process | speedMultiplier | ratedLoadTorque | 输入位 / 输出位 | 输入容量 | 输出容量 | 配方数 | 证据 |
|:--|:--|:--|--:|--:|:--|--:|--:|--:|:--|
| `core.crusher` | 破碎机 | crushing | 1 | 18 N·m | `slot.crusher.in.nz` / `slot.crusher.out.px` | 4 | 4 | 1 | `processing-core.ts:120-127,185-189`；`parts.ts:260-272,119` |
| `core.smelter` | 熔炼炉 | smelting | 1 | 24 N·m | `slot.smelter.in.nz` / `slot.smelter.out.px` | 4 | 4 | 1 | `processing-core.ts:128-134`；`parts.ts:273-285,120` |
| `core.forge` | 锻压机 | forging | 1 | 22 N·m | `slot.forge.in.nz` / `slot.forge.out.px` | **6** | 4 | **11** | `processing-core.ts:135-142`；`parts.ts:286-298,121` |

| 共同事实 | 内容 | 证据 |
|:--|:--|:--|
| 占地/高度 | 全部 1×1、高 1 m、端口高度 0.5 m | `parts.ts:92-93,260-298` |
| 机械动力输入端口 | 本地 `nx` 面单端口 → 与安装位（`nz`/`px`）不冲突 | `parts.ts:168-170`；`processing-core.ts:109-111`；`integrity.ts:184-187`（事实表 B §3.2） |
| 总负载 | 18+24+22 = **64 N·m**（飞轮 140 下 speedFactor = 1−64/140 ≈ 0.543） | `assets/__tests__/industrial-compat.test.ts:113-119`（事实表 B §3.2） |
| `speedMultiplier` | 三个核心全为 1；**运行时无任何读取**，只被完整性校验引用 → **部分实现（数据预留）** | `processing-core.ts:94-98`；事实表 B §9.2 |

**非核心的"机器"**：`machine`（冲压机）`kind='machine'`、有 `loadTorque=20`，但不在 `PRODUCTION_MACHINE_IDS`，**无缓冲、无配方、无安装位**，不消耗也不产出物品 → **部分实现（M1.7 调试原型）**。证据：`assets/mechanical/parts.ts:222-233,402-403`；`assets/production/recipes.ts:7-8`；`assets/items/items.ts:143`。

### 2.2 单机加工状态机（真实语义）

| 语义 | 事实 | 证据 |
|:--|:--|:--|
| 状态字段 | `recipeIndex / progress / inputItem / inputCount / outputItem / outputCount / running / block / producedTotal` | `assets/production/production.ts:18-33` |
| 阻塞枚举 | `ok / no-power / no-input / output-full / no-recipe` | `production.ts:16` |
| 缓冲默认容量 | 输入 4 / 输出 4（核心可覆盖） | `production.ts:35-36` |
| **单输入单输出** | 输入缓冲只允许一种物料、输出也只一种；`Recipe.inputs/outputs` 虽是数组，运行时只取 `[0]` | `production.ts:181-182,203-211`；`recipes.ts:181-189` |
| 必须动力 | `!powered \|\| rate<=0` → `no-power`，**进度冻结、原料不扣** | `production.ts:192-195` |
| 开工整笔扣料 | 仅当 `progress<=0` 且输入 ≥ `inputs[0].count` 才扣 | `production.ts:197-211` |
| 输出空间预检 | 放不下则 `output-full`、**不扣料** | `production.ts:203-207,218-223` |
| 进度推进 | `progress += rate*dt/seconds`；`dt` 夹到 [0, 0.25] s（低帧率下加工变慢） | `production.ts:164,215` |
| 完成 | 放不下则 `progress=1` 等空间；放得下写输出并累加 `producedTotal` | `production.ts:216-233` |
| 拆机返还 | `flushMachine` 按两种物品返回 | `production.ts:237-253`；`production-runtime.ts:143-168` |
| 速率来源 | 完全来自动力解算 `rate = rpm/60` | `assets/mechanical/runtime.ts:306-313` |

### 2.3 4 种接口盒能力与安装位

| PortModuleId | 显示名 | kind | 输入 | 输出 | 可装角色 | 绑定物品 | 安装键 | 证据 |
|:--|:--|:--|--:|--:|:--|:--|:--:|:--|
| `port.through` | 基础直通盒 | through | 1 | 1 | 输入 + 输出 | `interface_box` | T（输入）/ O（输出） | `assets/industrial/port-module.ts:75-83` |
| `port.output` | 输出接口盒 | through | 1 | 1 | **仅输出** | `output_interface_box` | O | `port-module.ts:84-92` |
| `port.splitter` | 分流盒 | splitter | 1 | **2** | **仅输出** | `splitter_box` | K | `port-module.ts:93-101` |
| `port.merger` | 合流盒 | merger | **2** | 1 | **仅输入** | `merger_box` | L | `port-module.ts:102-110` |

| 安装/拆卸规则 | 事实 | 证据 |
|:--|:--|:--|
| 安装位总数 | 3 核心 ×（1 输入 + 1 输出）= **6**；输入位在 `nz` 面、输出位在 `px` 面 | `processing-core.ts:120-142`；`catalog.ts:86-92`（事实表 B §6.3） |
| 每安装位最多 1 个盒 | 已占用 → `slot-occupied` | `assets/industrial/port-runtime.ts:150` |
| 安装校验顺序 | 槽存在 → 模块存在 → 槽未占用 → 角色匹配 → 绑定真实物品；全过才写状态 | `port-runtime.ts:140-167` |
| 安装**不碰库存** | 交互层顺序：先 `inventory.has` → `install` → 成功后 `inventory.remove`（不会"扣了没装上"） | `assets/industrial/port.pack.ts:127-143` |
| 盒缓冲 | 单物料类型，件数 0..槽容量；容量 = 该角色机器缓冲（输入 4/4/6，输出 4/4/4） | `port-runtime.ts:15-18,188-196`；`processing-core.ts:144-155` |
| 拆卸返还 | 盒子物品 + 盒内剩余物料一并返还，并解除该端口的连接 | `port-runtime.ts:169-182`；`port.pack.ts:145-157` |
| 机器被拆 | 下一帧 `sync(aliveIds)` 把盒与缓冲交回库存 | `port.pack.ts:206-211`（事实表 B §5.2） |
| 键位 | T/O/K/L 安装，Y 拆盒，J 建/选连接，H 解连接，U 旋转核心，Esc 取消 | `port.pack.ts:227-234` |

### 2.4 分流 / 合流规则（真实能力，不是占位）

| 规则 | 事实 | 证据 |
|:--|:--|:--|
| 每条连接每次推进 | 最多 **1 件** | `assets/industrial/link-runtime.ts:35` |
| 每个接口每步 | 最多参与 1 次转移（`busy` 集合） → 不会一次抽干源缓冲 | `link-runtime.ts:304-322`（事实表 B §6.1） |
| 分流公平 | 按源接口分组、每组一个 `fromCursor`，**游标只在成功转移后前进**（注释记录过"按帧前进导致 3/1 偏斜"的真实 bug） | `link-runtime.ts:282-301,325-327` |
| 合流公平 | 全局 `cursor` 轮转端口组，组内按各源游标轮转 | `link-runtime.ts:294,302` |
| 合流不混合物料 | 两路物料类型不同时第二路被"目标类型不符"拒收 | `port-runtime.ts:125,188-196` |
| 多口对接几何 | 任一端 `outputs>1` 或 `inputs>1` 时允许**近距定向**：距离 ≤ 2 m 且朝向点积 ≥ 0.5 | `link-runtime.ts:37-39,209-217` |
| 直通类对接 | 必须面对面：锚点距离 ≤ 1e-4 m、法线点积 ≤ −1+ε | `link-runtime.ts:125-132` |
| 失败原因枚举 | `self-link/missing-part/not-a-core/unknown-slot/wrong-role/missing-port/duplicate-link/from-port-full/to-port-full/not-adjacent/out-of-reach/wrong-facing` | `link-runtime.ts:51-63` |
| 连接状态 | `ok / inactive-missing-part / -missing-port / -port-limit / -geometry` | `link-runtime.ts:43-48` |
| 拆盒不删连接 | 连接降级为 `inactive-missing-port`，重装同角色盒自动恢复 | `link-runtime.ts:242-245`；单测 `link-runtime.test.ts:213-224`（事实表 B §5.4） |
| 多级加工 | 无硬上限；3 核串联与"分流+合流同时运行"均有测试 | `assets/__tests__/link-flow.test.ts:183-251`（事实表 B §0.5） |

### 2.5 结构框架与 Assembly 的真实能力

| 事实 | 内容 | 证据 |
|:--|:--|:--|
| 只有 1 种结构模块 | `structure.frame`：1×1、高 1、`connection='orthogonal'`、`connects=['core','module']`、`reach=1`；`STRUCTURE_MODULES` 长度 1 | `assets/industrial/assembly-module.ts:41-54` |
| 机械层本体 | `kind='structure'`、`maxTorque=0`、`ports=[]`（不传动力/物料） | `assets/mechanical/parts.ts:310-324` |
| 组合节点 | 加工核心 + 结构模块 | `assembly-runtime.ts:22-26,126-156` |
| 结构边 | 同层**正交相邻**，且至少一端是结构模块；核心与核心直接相邻**不构成**结构关系 | `assembly-runtime.ts:24,190-212` |
| 组合门槛 | 连通组件中加工核心 **≥ 2** | `assembly-runtime.ts:25,294-297` |
| 跨层 | 不允许（`mixed-level` 校验） | `assembly-runtime.ts:444,450` |
| 唯一归属 | 一个核心只能属于一个组合（`member-in-other-assembly`） | `assembly-runtime.ts:438-440` |
| 放置前置 | 必须与同层核心/结构框架正交相邻 | `assembly-runtime.ts:479-498` |
| ID 稳定 | 有交集沿用旧 ID、合并保留最小 serial、组件消失即解除、ID 不复用 | `assembly-runtime.ts:26-29`（事实表 B §7.4） |

**"不提供新产能"的明确证据**

| 事实 | 证据 |
|:--|:--|
| `AssemblySnapshot` 只加只读管理字段（成员表、结构关系、相对位置、边界、`powerDemandTorque`），**不含速度/产能字段** | `assembly-runtime.ts:318-329`；单测断言 `__tests__/assembly-compat.test.ts:74-118`（事实表 B §7.3） |
| `powerDemandTorque` = 成员 `ratedLoadTorque` 之和，**仅用于查询/展示**；动力求解仍按真实零件 `loadTorque` 在 `power.ts` 里算 | `assembly-runtime.ts:328` |
| 组合不自动建物料连接；拆结构模块只解除组合、不动 MaterialLink | `assembly-compat.test.ts:122-167`（事实表 B §7.3） |
| 插件注释明确"不实现：整体移动、整体旋转、嵌套组合、科技树、新的加工/物流/动力系统" | `assets/industrial/assembly-system.ts:47` |

### 2.6 放置 / 旋转 / 安装 / 拆卸 / 回收规则与键位

**机械零件**

| 关注点 | 事实 | 证据 |
|:--|:--|:--|
| 进入机械模式 | 快捷栏选中槽位的物品能被 `partDefForItem` 解析 → 进入放置模式 | `assets/mechanical/mechanical.pack.ts:232-235,432-433` |
| 楼层来源 | 玩家当前所站、`active` 且 `buildable` 的支撑面所在层；无落脚支撑 → 不显示幽灵 | `mechanical.pack.ts:237-243` |
| 足迹 | 放置路径硬编码 `w=1,d=1` | `mechanical.pack.ts:255-256` |
| 合法性 | 复用 `validatePlacement`：建造区内、有同高可建支撑、不压资源、不与玩家/AABB 相交；再叠加 `overlapsPlayer` | `mechanical.pack.ts:258-269`；`assets/build/build.ts:80-123` |
| 左键 | 悬停空格 → 放置（合法才放）；悬停已有零件 → 选中 | `mechanical.pack.ts:459-487` |
| `R` | **只改下一次放置预览的朝向**（`rotation += 90`），不改已放置零件 | `mechanical.pack.ts:441` |
| `Esc` | 取消选中、隐藏幽灵 | `mechanical.pack.ts:442-448` |
| `Delete`/`Backspace` | 拆除选中零件，**返还 1 个物品**（立式带也只返 1） | `mechanical.pack.ts:449-452,349-357` |
| 已放置零件能否旋转 | **不能**；全仓库 `updatePlacement` 唯一调用者是接口盒 `U`（只对加工核心生效） | `assets/industrial/port.pack.ts:192-198,234`（事实表 A §5.3） |
| 拆除时缓冲物品 | 加工缓冲/溜槽在途物品下一帧 `flush` 回库存；盒与盒内物料由 PortRuntime 返还 | `production-runtime.ts:143-168`；`port.pack.ts:206-211`（事实表 A §5.4） |
| 无拆除工具/返还比例/升级拆解 | `mechanical.pack.ts` 全部输入仅上述 | `mechanical.pack.ts:418-489` |

**其它模式与交互键位**

| 键 | 作用 | 生效条件 | 证据 |
|:--|:--|:--|:--|
| `P` | 进入/退出结构框架放置模式 | 结构框架库存 > 0；楼层模式优先 | `assembly-system.ts:245-250,261-312`（事实表 B §7.4） |
| `T`/`O`/`K`/`L` | 安装接口盒到输入位/输出位 | 悬停加工核心 | `port.pack.ts:227-230` |
| `Y` / `J` / `H` | 拆盒 / 建连接 / 解该机器全部连接 | 同上 | `port.pack.ts:231-233` |
| `U` | 原地旋转加工核心 90° | 同上 | `port.pack.ts:234` |
| `C`（按住） | 靠近飞轮（2.2 m 内）摇柄储能 | 存在飞轮 | `assets/mechanical/runtime.ts:196-208` |
| `C`（刚按下） | 从库存向悬停机器投 1 件当前配方原料 | 悬停加工核心 | `assets/mechanical/runtime.ts:289-299` |
| `R`（悬停机器） | 切换该机器配方 | 悬停加工核心 | `assets/mechanical/runtime.ts:289-291` |
| 右键 | 机器：投料/取货；动力源：离合开关 | 悬停对应零件 | `assets/mechanical/runtime.ts:210-229,281-288` |
| `Tab` / `Esc` | 开/关背包（打开即 `app.pause()`） | 无 | `assets/frontend/frontend-ui.ts:271-322`（事实表 C §4.2） |

**输入互斥**：机械模式时 build 系统整体让出（`build.pack.ts:508-517`）；楼层/结构模式时机械系统整体让出（`mechanical.pack.ts:424-431`）；接口盒系统同样让出（`port.pack.ts:218-219`）。

### 2.7 当前原型供给机制（明确不是最终规则）

| 供给 | 明细 | 合计 | 证据 |
|:--|:--|--:|:--|
| 机械原型套件 | 轴 24、12 齿 6、24 齿 4、测试源 4、冲压机 5、溜槽 3、立式带 2、破碎机 3、熔炼炉 3、锻压机 1、飞轮 1、结构框架 0 | **56** | `assets/mechanical/parts.ts:356-370` |
| 接口盒套件 | 基础 4、输出 3、分流 1、合流 1 | **9** | `assets/industrial/port.pack.ts:51-58` |
| 结构框架套件 | 结构框架 | **4** | `assets/industrial/assembly-system.ts:51-53,96-99` |
| 锻压复制配方 | 8 条临时配方（§1.3 #6–#13），含 3 条核心复制 | **8** | `assets/production/recipes.ts:72-155` |

**"不是最终规则"的原文证据**

| 出处 | 原文要点 |
|:--|:--|
| `assets/mechanical/parts.ts:347-355` | "开局原型套件（数量有限，拆除返还）…更多加工核心可以从锻压机的新配方制造" |
| `assets/mechanical/parts.ts:368` | "结构框架不走快捷栏…由 assembly 插件单独发放原型数量" |
| `assets/industrial/port.pack.ts:52` | "开局原型套件：给足搭多核心生产线的最小盒数" |
| `assets/industrial/assembly-system.ts:95` | "原型供给…P2-E 会统一决定最终获取/解锁方式，这里明确标记为临时原型数量" |
| `docs/m20/P2-D-DESIGN.md:253-255` | "以上配方与开局数量属于**临时原型供给**，不是最终制造/解锁规则；P2-E 统一调整" |
| `docs/m20/P2-D-REPORT.md:254` | "结构框架/配方是临时原型供给：P2-E 统一决定机器获取与科技解锁" |

---

## 3. 动力系统

### 3.1 两个"动力源"：正式源 vs 调试件

| 维度 | `flywheel_source`（手摇飞轮储能机） | `power_source`（测试动力源） |
|:--|:--|:--|
| 定位 | **唯一正式动力源** | **调试件**（物品描述自述"不是正式动力来源"） |
| 能量模型 | `capacity 300 / windRate 45 / baseDrain 6 / loadDrain 14 / range 2.2` | **无**（无限能量） |
| 扭矩上限 | 140 N·m | 100 N·m |
| 额定转速 | 60 RPM（= 2π rad/s） | 60 RPM |
| 玩家操作 | 2.2 m 内按住 `C` 储能；右键离合启停；能量归零自动脱开输出 | 右键开关（逻辑启停） |
| 是否参与能量结算 | 是（每帧加减） | 否 |
| 证据 | `assets/mechanical/parts.ts:245-259`；`assets/mechanical/runtime.ts:196-208,281-288`；`assets/mechanical/runtime-state.ts:325-347`（事实表 A §4.1） | `assets/mechanical/parts.ts:208-221`；`assets/items/items.ts:132-139` |

飞轮能量结算：摇动时 `energy = min(300, energy + 45·dt)`；否则若离合挂上 `energy = max(0, energy − (6 + 14·min(1, demand/140))·dt)`；
跨 0 边界时把解算标脏，下一帧机器真停（`runtime-state.ts:325-347`，事实表 A §4.1）。能量耗尽 → 输出脱开、`powered=false`、加工进度冻结（`runtime-state.ts:218-237`；单测 `flywheel-energy.test.ts:32-141`）。

### 3.2 动力网络模型（已实现的全部规则）

| 规则 | 事实 | 证据 |
|:--|:--|:--|
| 传播介质 | 沿 `axial` 与 `gearMesh` 连接传播 | `assets/mechanical/power.ts:8` |
| 机器是终端 | 可到达，但**不继续向外传播** | `power.ts:249-250` |
| 单源 | 组件内多源 → `unsupported/multiple-sources` | `power.ts:8-14,186-197`（事实表 A §0.4） |
| 只支持树 | 任何闭环（哪怕传动比自洽）→ `unsupported/cyclic-network`，闭环检测在负载解算前 | `power.ts:10-11,256-260` |
| 状态/原因枚举 | `idle/powered/unsupported/stalled`；`no-source/multiple-sources/cyclic-network/source-overload/branch-overload` | `power.ts:17-23` |
| 速度模型 | 静态下垂：`speedFactor = 1 − demand/capacity`；`ω = ratedω × speedFactor × 传动比`；无惯量/摩擦/积分 | `power.ts:12-13,423-433` |
| 过载 | 源侧需求 ≥ 源容量 → **整网停转**；否则找最深超载传动件 → **只停该支路下游**，循环至无超载 | `power.ts:364-392` |
| 需求累加 | 逆 BFS 序自底向上：`demand[parent] += demand[child]×\|ratio\|`，再加自身 `loadTorque` | `power.ts:335-351`（事实表 A §4.1） |
| 拓扑重建时机 | 只有 `registry.revision` 变化（放置/拆除/旋转）才重建 | `runtime-state.ts:140-176`（事实表 A §4.1） |
| 无端口零件隔离 | 溜槽/结构框架 0 端口，不参与动力网络 | 事实表 A §3；`power.ts:133-134` |
| 齿轮比 | 外啮合 `ratio = −(teethA/teethB) × dot(axisA,axisB)`；12↔24 = −0.5 / −2 | `assets/mechanical/ports.ts:135-143`；单测 `mechanical-load.test.ts:60-109`（事实表 A §9.5） |

### 3.3 扭矩 / 能量 / 时间常量表

| 常量 | 值 | 单位 | 证据 |
|:--|--:|:--|:--|
| `TORQUE_SOURCE`（测试源） | 100 | N·m | `assets/mechanical/parts.ts:111` |
| `TORQUE_SHAFT`（轴 / 立式带） | 150 | N·m | `parts.ts:112,242` |
| `TORQUE_GEAR`（齿轮） | 50 | N·m | `parts.ts:113` |
| `TORQUE_MACHINE`（加工机器承载） | 50 | N·m | `parts.ts:114` |
| `MACHINE_LOAD`（冲压机） | 20 | N·m | `parts.ts:115` |
| `TORQUE_FLYWHEEL` | 140 | N·m | `parts.ts:116` |
| `CRUSHER_LOAD` / `SMELTER_LOAD` / `FORGE_LOAD` | 18 / 24 / 22 | N·m | `parts.ts:119-121` |
| 三核心总负载 | 64 | N·m | `__tests__/industrial-compat.test.ts:113-119`（事实表 B §3.2） |
| 飞轮能量容量 / 摇动注入 / 空载消耗 / 负载附加 / 半径 | 300 / 45 / 6 / 14 / 2.2 | 能量点、点·s⁻¹、m | `parts.ts:255` |
| 摇动垂直容差 | 2.5 | m | `assets/mechanical/runtime.ts:33,202-206`（事实表 A §4.2） |
| 额定转速 | 60（= 2π rad/s） | RPM | `parts.ts:217,254` |
| 状态步长上限 | 0.1（能量/角度）/ 0.25（加工） | s | `runtime-state.ts:304`；`production.ts:164` |
| 机器缓冲 | crusher 4/4、smelter 4/4、forge 6/4 | 件 | `parts.ts:270,283,296` |

### 3.4 动力系统的能力边界（已实现 / 未实现）

| 能力 | 状态 | 证据 |
|:--|:--|:--|
| 手摇飞轮储能 + 离合 + 自动脱开 | **已实现** | `parts.ts:245-259`；`runtime.ts:196-208`；单测 `flywheel-energy.test.ts` |
| 树状单源网络 + 齿轮比 + 速度下垂 + 两级过载 | **已实现** | `power.ts`；单测 `mechanical-power.test.ts`、`mechanical-load.test.ts` |
| 跨层传动（立式带 + 楼板开孔） | **已实现** | `parts.ts:144-154`；单测 `vertical-drive.test.ts` |
| 多源并联 / 并联负载分配 | **未实现**（显式 unsupported，注释写"并联路径的负载分配尚未建模"） | `power.ts:8-11,256-260` |
| 惯量 / 摩擦 / 动态负载 / 飞轮转子物理 | **未实现**（显式不做） | `power.ts:11-13` |
| 风力 / 水力 / 蒸汽动力 | **未实现**：`assets` 内无任何实现（`wind` 仅命中飞轮 `windRate`）；仅美术清单提到"蒸汽/锅炉/VFX" | `docs/design/ART-DIRECTION.md:30,63,65`（美术要求，非玩法）；事实表 A §7.1 |
| 电力 / 流体 / 气体 | **未实现** | 事实表 B §9.1；`docs/PROGRESS.md:53` |
| 测试动力源（无限能量、可开关） | **部分实现（调试件）** | `parts.ts:208-221`；`items.ts:132-139` |

---

## 4. 工业订单

### 4.1 订单"定义"是只读常量

| 字段/常量 | 值 | 证据 |
|:--|:--|:--|
| 标题 / 副标题 | `第一份工业订单` / `制造你的第一根传动轴。` | `assets/goal/order.ts:12-14` |
| 步骤 ID | `gather-ore/build-machines/connect-power/start-power/crush-ore/smelt-ingot/forge-shaft/complete` | `order.ts:17-25` |
| 实质步骤 | 前 7 个（不含 `complete`） | `order.ts:28` |
| 机器种类 | `crusher/smelter/forge` | `order.ts:31,122` |
| 阻塞码 | **10 种** | `order.ts:34-44` |
| 数量要求 | `ironOre 2 / crushedOre 2 / ironIngot 2 / shaft 1` | `order.ts:114-119` |
| 生产步骤→配方 | crusher→`crush-iron-ore`、smelter→`smelt-crushed-ore`、forge→`forge-shaft` | `order.ts:131-135` |
| **没有**的字段 | 订单 ID、奖励、时限、委托人、订单列表、交付点 | `order.ts` 全文；事实表 C §2.1 |

### 4.2 八步判定

| # | id | 标题 | 判定条件（代码） | 证据 |
|--:|:--|:--|:--|:--|
| 1 | `gather-ore` | 采集铁矿石 | `observation.ironOre >= 2`（**当前背包**矿石数） | `assets/goal/goal.ts:88-89` |
| 2 | `build-machines` | 建造生产机器 | 世界中三种机器零件都存在（不要求同网络） | `goal.ts:90-91` |
| 3 | `connect-power` | 建立机械动力连接 | 三机 + 动力源在同一 `orderNetwork`（非 unsupported） | `goal.ts:92-93` |
| 4 | `start-power` | 启动动力网络 | 网络 `powered` + `speedFactor>0` + 源 engaged + 三机均 powered 未 stalled | `goal.ts:94-95` |
| 5 | `crush-ore` | 完成矿石破碎 | 碎铁矿**相对基线增量** ≥ 2 | `goal.ts:96-97` |
| 6 | `smelt-ingot` | 完成铁锭熔炼 | 铁锭增量 ≥ 2 | `goal.ts:98-99` |
| 7 | `forge-shaft` | 完成传动轴锻压 | 传动轴增量 ≥ 1 | `goal.ts:100-101` |
| 8 | `complete` | 订单完成 | 前 7 步全锁存后自动推入，不单独判定 | `goal.ts:102-105,196-199` |

### 4.3 状态机语义

| 项 | 事实 | 证据 |
|:--|:--|:--|
| 状态对象 | `GoalState { baseline:{crushedOre,ironIngot,shaft}, completed: GoalStepId[] }`，纯可序列化 JSON | `goal.ts:46-51` |
| 无独立状态枚举 | 没有 `pending/active/done`，只有"已锁存步骤数组" | `goal.ts:47-51` |
| 当前步骤 | 第一个未 completed 的步骤；全完成取最后一步 | `goal.ts:170` |
| 推进 | 按 8 步顺序扫描，**遇第一个未满足即 break**（不能乱序推进） | `goal.ts:191-202` |
| latch | 已完成步骤跳过、**永不回退**（拆机/断电不撤销） | `goal.ts:32,194-195` |
| 基线 | 订单开始第一帧记录 `production.produced` 累计值；之后只按差值判定 | `assets/goal/goal-service.ts:132-149`；`goal-context.ts:90-96`（事实表 C §2.3） |
| 完成推导 | `completed.length >= GOAL_STEPS.length-1`（即 7）→ push `complete` 并 break | `goal.ts:196-199` |
| 显示进度 | 已锁存步骤显示 `required/required`（防止"✓ 0/2"） | `goal.ts:148-156` |
| HUD 快照 | `GoalSnapshot{title,subtitle,complete,currentStep,steps,blocker,focusPartId}` | `goal.ts:69-79,158-180` |

### 4.4 材料要求 / 生产目标 / 交付扣除

| 问题 | 答案 | 证据 |
|:--|:--|:--|
| 订单开始时是否要求预存材料 | **否**；第 1 步只是"当前背包 ≥2" | `order.ts:114-119`；`goal.ts:88-89` |
| 生产目标怎么算 | 按**相对基线增量**，不看库存、不看动画 | `goal.ts:96-101`；`goal-context.ts:90-96` |
| 完成时是否扣材料 | **完全没有**；第 8 步"交货"只是文案 | `order.ts:99-103`；`goal.ts:191-205`（无任何 inventory 调用） |
| 证明 | 单测：锻出轴后库存仍 24 根 | `__tests__/goal-e2e-order.test.ts:115-121`（事实表 C §2.4） |
| 是否存在交付点/收购站 | **不存在** | 见 §5.3 |

> 结论：订单是**纯只读观测式教程目标**——只读世界状态 + 累计产出，不消耗、不交付、不发奖励。

### 4.5 goal/goal-service 只读投影

| `GoalObservation` 字段 | 来源 | 证据 |
|:--|:--|:--|
| `ironOre` | `inventory.count(IRON_ORE)`（当前库存，不是累计采集） | `goal-service.ts:123` |
| `parts[]` | 机械快照 parts + powered/stalled | `goal-service.ts:84-93` |
| `machines[]` | `ProductionSnapshot.machines`（配方/进度/block/缓冲） | `goal-service.ts:94-104` |
| `sources[]` | `MechanicalSnapshot.sources`（engaged/energy/capacity） | `goal-service.ts:105-110` |
| `networks[]` | `MechanicalSnapshot.networks`（status/reason/成员/stalled/speedFactor） | `goal-service.ts:111-120` |
| `produced[]` | `ProductionSnapshot.produced`（运行时生命周期累计，拆机不清零） | `goal-service.ts:121` |

| 服务事实 | 内容 | 证据 |
|:--|:--|:--|
| 提供方式 | `ctx.provide('goalProgress', {snapshot, observation, state})` | `assets/mechanical/runtime.ts:84-90` |
| 每帧更新 | 机械 Update 每帧 `goalProgress.update({...})` | `runtime.ts:314-320` |
| 只读 | 不反向控制机械/生产；`state()` 返回副本 | `goal.ts:24-33`；`goal-service.ts:156-159` |
| 无恢复接口 | 只有 update/snapshot/observation/state，**没有 restore/setState** | `goal-service.ts:132-159` |
| 不在唯一 GameRead 中 | read 字段无 goal | `runtime.ts:128-170`；`docs/m20/P1-D-REPORT.md:196`（M5） |

### 4.6 可复用能力与职责边界（事实层）

| 可复用点 | 说明 | 证据 |
|:--|:--|:--|
| 纯函数状态机 + latch + 增量基线 | "按序锁存、不回退、相对基线"已存在且被测 | `goal.ts:187-205`；`goal-context.ts:46-52,90-96` |
| 只读观察投影 | "运行时快照 → 纯数据"干净边界 | `goal-service.ts:82-130` |
| 阻塞码 + 中文文案结构 | 10 种 code+message | `goal-blockers.ts:147-166`；`order.ts:34-44` |
| HUD 面板与协议管线 | 面板模板、签名去重、MessagePort、防御式解析 | `frontend-goal-panel.ts`；`game-ui-bridge*` |
| 库存校验/扣减 | `has` + 整笔原子 `remove` | `inventory.ts:55-58,96-115` |
| 稳定 ID 体系 | `CoreId/PortModuleId/RecipeId/ItemId` 已声明为"存档/科技树/市场会引用" | `docs/m20/P2-A-DESIGN.md:40-44` |
| **职责边界（现状）** | 订单=教学/模板（单张、硬编码、不扣料、无交付、无奖励）；进度完全由"生产累计增量"派生，而生产累计无持久化、无外部写入接口 | `order.ts` 全文；`goal-service.ts:132-159` |

---

## 5. 工程基础

### 5.1 科技相关代码 / 数据 / UI：**不存在**

| 检查项 | 结果 | 证据 |
|:--|:--|:--|
| `unlock\|解锁\|科技\|research\|techTree`（`assets/**`） | **8 处命中，全部是注释**，无一行解锁判定 | `assembly-system.ts:47,95`；`industrial/ids.ts:5`；`port.pack.ts:47`；`items.ts:105`；`recipes.ts:74,87,147` |
| `Tech` 类型 / 科技数据表 | 不存在 | 同上；无 tech 模块文件 |
| 科技 UI | 不存在（前端只有订单面板/快捷栏/背包） | `assets/frontend/frontend-ui.ts` 全文；事实表 C §4.3 |
| 物品/配方/接口盒/结构模块的"已解锁"字段 | **一律没有** | `items.ts:33-45`；`recipes.ts:19-29`；`port-module.ts:23-38`；`assembly-module.ts:20-39` |
| 配方过滤点 | `recipesFor(partId)` 无条件返回整表；`cycleRecipe` 循环全部 | `recipes.ts:177-179`；`production.ts:80-86` |
| 机器可用性判定 | `partDefForItem` 只按 itemId 反查；`place()` 只校验库存与空间 | `parts.ts:392-396`；`mechanical.pack.ts:302-326` |
| 官方结论 | P2-D "尚未实现（授权外）：科技树/解锁、工业市场与点数、机器最终获取规则…" | `docs/m20/P2-D-REPORT.md:275-278`；`docs/PROGRESS.md:26-27,53` |

### 5.2 持久化：**无持久化**（设计存在）

| 检查项 | 结果 | 证据 |
|:--|:--|:--|
| 存档/读档模块 | 不存在（无 save/persist 文件） | `assets` 内 0 命中（本次实测） |
| 存储调用 | 不存在：`localStorage/sessionStorage/indexedDB/storage./saveGame/loadGame` 在 `assets` 内 **0 命中** | 本次 grep 实测 |
| 序列化 | `serialize/deserialize/persist` 在 `assets` 内 **0 命中** | 本次 grep 实测 |
| 平台存储能力 | 初始化声明 `capabilities: []`（无 storage） | `assets/runtime/zaohua-platform-init.js:8` |
| 存档 UI/协议消息 | 不存在；UI 协议无 `save/*` | `assets/game-ui-bridge/protocol.ts:43-48` |
| 现存状态 | 全部在内存，刷新即重置 | `docs/design/SAVE-ARCHITECTURE.md:8-25`；`docs/PROGRESS.md:159` |
| 设计文档 | `docs/design/SAVE-ARCHITECTURE.md`（110 行）存在，但**只是设计**：14 类状态范围、6 个接口缺口、快照 v1 JSON、存储通道 | `SAVE-ARCHITECTURE.md:10-25,27-36,38-61` |

**6 个接口缺口（设计文档列出，代码全部未补）**：建筑无服务、机械无 restore、资源节点只读、玩家不可设位、无存档消息、无存储调用（`SAVE-ARCHITECTURE.md:27-36`）。

**对订单/科技树的直接后果**：订单状态与基线不落盘（`goal-service.ts:132-135`）；机械/生产/端口/组合全在内存（`docs/m20/P2-D-REPORT.md:245,288`）。

### 5.3 HUD / 背包 / 交付交互现状

| 界面/能力 | 现状 | 证据 |
|:--|:--|:--|
| 工业订单 HUD（左上） | DOM 面板，302 px 宽，8 步 + 当前目标 + 进度条 + 阻塞文案；主体 `pointer-events:none`，仅折叠按钮可点 | `assets/frontend/frontend-ui-styles.ts:71-74`；`frontend-goal-panel.ts` |
| 快捷栏（底部居中） | DOM 12 格，槽宽 `clamp(30px, min(4.2vw, (100vw-152px)/12), 46px)`，不换行 | `frontend-ui-styles.ts:5,9-13` |
| 背包（Tab 模态） | 列表 + 详情 + 拖拽绑定；打开即暂停游戏 | `assets/frontend/frontend-ui.ts:271-322` |
| 提示行 / 错误提示 | 只有"Tab 打开背包"；错误文本在背包标题栏内 3.5 s 消失 → 部分实现 | 事实表 C §4.3 |
| 库存 API | 无容量上限；单物品整笔原子；**无事件/订阅**；**无多物品事务** | `assets/inventory/inventory.ts:96-115,122-152`；事实表 C §6.2 |
| 建造菜单 / 键位面板 / 设置 / 暂停菜单 / 机械侧栏 | **未实现** | 事实表 C §4.3；`docs/m20/P2-D-REPORT.md:242-243,289` |

**"不存在提交物品交互"**

| 检查 | 结果 |
|:--|:--|
| `market/trade/sell/buy/shop/商店/市场/提交物品`（`assets/**/*.ts`） | 本次 grep 13 处命中，**全部不是"玩家交付"**：`deliver` 只出现在溜槽交接计数（`production/transport.ts:32,114`；`production-runtime.ts:109,369-374,415`），`市场` 只在 `industrial/ids.ts:5` 注释 |
| 收购站 / 交付点 / 箱子存入 / 邮件 / 奖励 | 不存在 |
| 订单"交货" | 只是完成态文案（`order.ts:99-103`），无扣料/移交 |

| 现有"物品从背包出去"的路径（均非交付） | 行为 | 证据 |
|:--|:--|:--|
| 悬停机器 `C` | 按当前配方从库存扣 1 件原料 | `mechanical/runtime.ts:289-299` |
| 选中物品 + 右键机器 | 投 1 件进输入缓冲 | `mechanical/runtime.ts:210-224` |
| 放置机械零件 | `has` → 放置事务 → `remove`，失败回滚 | `mechanical.pack.ts:302-332` |
| 安装接口盒 | T/O/K/L 安装扣 1 个盒 | `port.pack.ts:141` |
| 拆除机械/接口盒 | 返还物品（+盒内缓冲） | `mechanical.pack.ts:349-357`；`port.pack.ts:152-154` |
| 放置普通建筑 | **不消耗任何物品** | 事实表 C §5.2 |

### 5.4 UI 协议 v1 与唯一 GameRead 约束

| 项 | 事实 | 证据 |
|:--|:--|:--|
| 协议版本 | **1**；不匹配直接拒绝 | `assets/game-ui-bridge/protocol.ts:11,66-67` |
| 上行命令 | 5 种：`hello` / `state/request` / `hotbar/select` / `hotbar/bind` / `hotbar/unbind` | `protocol.ts:43-48` |
| 下行消息 | 2 种：`{type:'state',v,revision,items,hotbar,goal}`、`{type:'error',code,message}` | `protocol.ts:23-41` |
| 状态内容 | 只列库存 >0 物品；`hotbar.slots/selected`；`goal` 可为 `null`（mechanical 未就绪） | `protocol.ts:95-125` |
| 推送时机 | 收到 hello/state/request/热键命令后；每帧签名变化时 | `bridge.pack.ts:62-79,135-153`（事实表 C §4.2） |
| 暂停不走协议 | 打开背包直接 `app.pause()`，关闭 `app.resume()` + `input.clear()` | `frontend-ui.ts:271-322`（事实表 C §4.2） |
| **唯一 GameRead** | id `mechanical`；字段：`parts/machines/networks/production/ports/links/assemblies/inventory/player/ui` | `assets/mechanical/runtime.ts:103-178`（注册 `173-178`） |
| 约束 | **不得新增第二个 read**；新数据只能并入这一个 read | `docs/m20/P1-D-REPORT.md:196`（M5）；`docs/m20/P2-A-DESIGN.md:489`（事实表 B §10.5） |
| 当前 read 里没有的 | `goal`（订单快照）、`unlocked`（解锁集合，当然也不存在） | `runtime.ts:128-170` |

### 5.5 P2-A → P2-D 的数据边界与依赖关系

整条链路是"先有机械动力（M1.7）→ 再有加工链（M1.8）→ 再抽象出工业目录/稳定 ID（P2-A，只有类型与校验、无运行时）→ 再把接口盒变成真实物品并安装到安装位（P2-B）→ 再让物料在核心之间连接与分流合流（P2-C）→ 最后用结构框架把多核心组织成组合机械（P2-D）"。每一阶段的运行时能力都建立在上一阶段的真实零件与事务之上；P2-A 只贡献数据模型（`MachineEntity/MaterialLink/Assembly` 仅类型 + 校验函数），P2-B 起才有运行时（`PortRuntime`），P2-C 起才有连接运行时（`MaterialLinkRuntime`），P2-D 完全复用机械放置事务 `placePart()` 而不新建放置路径。

| 阶段 | 交付能力 | 数据/代码边界 | 对后续阶段的依赖 |
|:--|:--|:--|:--|
| M1.7 | 机械零件 + 动力网络 + 运动学原型 | `parts/ports/power/registry/runtime` | 后续一切机械与工业的基础 |
| M1.8 | 第一条生产链（破碎/熔炼/锻压/溜槽/飞轮/配方） | `production/`、`recipes.ts`、`flywheel_source` | 提供"有配方、有缓冲、有 block 原因"的机器语义 |
| M2.0-P1 | 订单 + HUD + 背包/快捷栏 + UI 协议 v1 | `goal/`、`frontend/`、`game-ui-bridge/` | 依赖 M1.8 的生产快照 |
| P2-A | 稳定 ID 体系 + 加工核心/安装位目录 + 运行时类型 | `industrial/ids, processing-core, catalog, port-module, runtime-model, integrity`（**仅类型/校验，无运行时**） | 派生自 `parts.ts`；为 P2-B/C/D 定契约 |
| P2-B | 接口盒真实物品 + 安装/拆卸 + 4 种盒定义 | `port.pack/port-runtime/port-slot-world/port-views` | 依赖 P2-A 安装位与 `PortModuleDef`；依赖机械放置事务 |
| P2-C | 物料连接 + 分流/合流 + 核心复制配方 | `link-runtime/port-flow`、`production-runtime` 编排 | 依赖 P2-B 的盒与安装位；依赖动力与加工 |
| P2-D | 结构框架 + Assembly 运行时 + 边界/选择 | `assembly-*`、`forge-structure-frame` | 依赖 `PRODUCTION_MACHINE_IDS`、`placePart()`、唯一 GameRead |

**依赖关系的硬证据**：P2-D 报告逐项列出"与既有系统兼容"（加工/物流/动力/空间/输入），并声明组合不新增产能（`docs/m20/P2-D-REPORT.md:164-170`）；
P2-A 明确"科技树 / 工业市场引用 `CoreId` / `RecipeId` / `ItemId`"（`docs/m20/P2-A-DESIGN.md:440`，§8.2 后续翻转点），并在 §9 扩展方式里登记"科技树解锁核心/接口盒 → 科技节点引用 `CoreId` / `PortModuleId`"（`:454`）；
唯一 GameRead 的装配点先注册 ports（P2-B）、再注册 links（P2-C）、再注册 assemblies（P2-D），字段只追加不替换（`assets/mechanical/runtime.ts:128-137`）。

---

## 6. 已有能力 vs 待开发能力总表

| # | 能力 | 现状 | 证据 | 科技树是否依赖 |
|--:|:--|:--|:--|:--|
| 1 | 19 件物品与 2 类分类 | 已实现（分类只有 resource/mechanical） | `items.ts:10,12-31` | 是（需要真实分类或新字段） |
| 2 | 13 条配方与配方表 | 已实现（无 unlock 字段） | `recipes.ts:19-29,158-174` | 是 |
| 3 | 单机加工状态机（单入单出、整笔扣料、block 原因） | 已实现 | `production.ts:16-36,162-253` | 间接（配方可见性影响它） |
| 4 | 3 个加工核心 + 6 个安装位 | 已实现 | `processing-core.ts:120-142,185-189` | 是（核心门控） |
| 5 | 4 种接口盒与安装/拆卸 | 已实现（分流/合流非占位） | `port-module.ts:74-111`；`port.pack.ts:127-157` | 是（端口门控） |
| 6 | 物料连接（1 件/步、2 m 定向、失效保留） | 已实现 | `link-runtime.ts:35-40,125-140` | 否 |
| 7 | 重力溜槽物流 | 已实现 | `transport.ts`（常量见事实表 B §6.3） | 否 |
| 8 | 机械动力网络（单源树、齿轮比、下垂、两级过载） | 已实现 | `power.ts:8-23,364-433` | 否 |
| 9 | 手摇飞轮储能 | 已实现（唯一正式动力源） | `parts.ts:245-259`；`runtime.ts:196-208` | 间接（若科技解锁动力源） |
| 10 | 测试动力源 | **部分实现（调试件）** | `parts.ts:208-221`；`items.ts:132-139` | 是（不应作为正式内容） |
| 11 | 冲压机 `machine` | **部分实现（M1.7 运动学原型，不加工）** | `parts.ts:222-233,402-407` | 是（占位物品最可能被替换/门控） |
| 12 | 结构框架 + Assembly | 已实现（仅组织关系，无新产能） | `assembly-runtime.ts:22-30,294-329` | 是（结构模块门控） |
| 13 | 放置/拆除/回收事务 | 已实现（放置扣 1、拆除返 1、失败回滚） | `mechanical.pack.ts:296-373` | 是（`place()` 是最强一致点） |
| 14 | 开局原型套件（56 + 9 + 4） | **部分实现（临时原型供给，非最终规则）** | `parts.ts:356-370`；`port.pack.ts:51-58`；`assembly-system.ts:51-53` | 是（必须被接管） |
| 15 | 锻压复制配方（8 条） | **部分实现（临时）** | `recipes.ts:72-155` | 是（配方门控对象） |
| 16 | 稳定 ID 体系 | 已实现（`core.*/port.*/structure.*/slot.*`） | `industrial/ids.ts`；`docs/m20/P2-A-DESIGN.md:40-44` | 是（科技节点应引用） |
| 17 | 订单 8 步状态机（latch + 基线增量） | 已实现（单张教程订单） | `goal.ts:39-51,187-205` | 间接（可复用模式） |
| 18 | 10 种阻塞码与 HUD 文案 | 已实现 | `order.ts:34-44`；`goal-blockers.ts:147-166` | 间接（可复用） |
| 19 | DOM HUD（订单面板/快捷栏/背包） | 已实现 | `frontend-ui.ts`；`frontend-ui-styles.ts:5-13,71-74` | 是（新面板/协议字段） |
| 20 | UI 协议 v1（5 命令 / 2 消息 / 单 `goal` 字段） | 已实现 | `protocol.ts:11,23-48` | 是（需扩字段/版本） |
| 21 | 唯一 GameRead `mechanical` | 已实现（无 goal、无 unlocked） | `runtime.ts:103-178` | 是（机器可读证据入口） |
| 22 | 库存增删查 | 已实现（无容量上限、无事务、无事件） | `inventory.ts:96-115,122-152` | 是（材料成本判定） |
| 23 | 交付/提交物品交互 | **未实现** | §5.3；`assets` grep 0 命中 | 是（若交付是解锁方式） |
| 24 | 科技数据 / 解锁判定 / 科技 UI | **未实现（0 行）** | §5.1；`docs/m20/P2-D-REPORT.md:275-278` | — |
| 25 | 存档 / 读档 / 序列化 | **未实现（0 行；设计存在）** | §5.2；`SAVE-ARCHITECTURE.md` | 是（解锁状态无处存） |
| 26 | 市场 / 点数 / 购买 | **未实现** | §5.3；`assets` grep 0 命中 | 取决于方案 |
| 27 | 风力/水力/蒸汽/电力/流体 | **未实现**（仅美术文档提及） | `docs/design/ART-DIRECTION.md:30,63,65` | 否（本阶段范围外） |
| 28 | 传送带/跨层物流/仓储容器 | **未实现** | 事实表 B §9.1；`docs/m20/P2-D-REPORT.md:251` | 否 |
| 29 | 多源并联 / 惯量 / 动力学 | **未实现**（显式不做） | `power.ts:8-14` | 否 |
| 30 | 组合整体移动/旋转/嵌套、承载/疲劳 | **未实现**（显式不做） | `assembly-system.ts:47`；`docs/m20/P2-D-REPORT.md:276,286` | 否 |

---

## 7. 与科技树的依赖关系（事实层：可挂点清单）

> 本节只列"代码里已存在、单入口"的位置与它们**现在做什么**、**是否含解锁判定（全部为否）**，不写设计决策。

### 7.1 配方门控点

| 挂点 | 现在做什么 | 含解锁判定 | 证据 |
|:--|:--|:--:|:--|
| `MACHINE_RECIPES` | 唯一配方数据源（13 条），按 `PartId` 分组 | 否 | `recipes.ts:158-174` |
| `recipesFor(partId)` | 无条件返回整表 | 否 | `recipes.ts:177-179` |
| `activeRecipe` / `cycleRecipe` | R 键循环全部配方；仅 `progress===0 && inputCount===0` 时可切 | 否 | `production.ts:62-86` |
| `ProductionRuntime.cycleMachineRecipe` | R 键运行时入口 | 否 | `production-runtime.ts:218-223`（事实表 B §10.1） |
| `INDUSTRIAL_CATALOG.recipesByCore` / `recipesForCore` | 只读派生视图（测试/工具/未来 UI） | 否 | `catalog.ts:108,140-142`（事实表 B §10.1） |
| `validateIndustrialCatalog` | 断言 `core.recipeIds == recipesFor`、配方字典序快照 | 否 | `industrial/integrity.ts:150-157`（事实表 B §10.1） |
| `Recipe` 类型 | 无 unlock/prototype/tier 字段 | 否 | `recipes.ts:19-29` |

### 7.2 机器门控点

| 挂点 | 现在做什么 | 含解锁判定 | 证据 |
|:--|:--|:--:|:--|
| `MECHANICAL_PART_IDS` / `MECHANICAL_ITEM_IDS` | 零件清单（12 项），顺序决定快捷栏绑定顺序，前 5 项被历史脚本依赖 | 否 | `parts.ts:327-345` |
| `PROTOTYPE_KIT` | 开局发放数量表（事实上的"机器可用性"） | 否 | `parts.ts:356-370` |
| `PROTOTYPE_KIT_SLOTS` | 11 个槽位绑定，5 号刻意留空 | 否 | `parts.ts:372-390` |
| `partDefForItem` | 物品 → 零件反查，决定能否进机械放置模式 | 否 | `parts.ts:392-396` |
| `place()` | 唯一放置事务：只校验 `inventory.has` + 几何合法 | 否 | `mechanical.pack.ts:302-332` |
| `canPlacePart()` | 只校验几何（结构模式复用） | 否 | `mechanical.pack.ts:335-339` |
| `PRODUCTION_MACHINE_IDS` / `isProductionMachine` | 加工核心集合（3 项） | 否 | `parts.ts:402-407` |
| `PROCESSING_CORES` | 3 个核心静态定义（派生） | 否 | `processing-core.ts:185-189` |

### 7.3 端口 / 结构门控点

| 挂点 | 现在做什么 | 含解锁判定 | 证据 |
|:--|:--|:--:|:--|
| `PORT_MODULES` | 4 种接口盒静态定义（按 `PortModuleId`） | 否 | `port-module.ts:74-111` |
| `installModule` + `PortRuntime.install` | 交互层先 `inventory.has` → install → remove；运行时只校验槽/模块/角色/绑定物品 | 否 | `port.pack.ts:127-143`；`port-runtime.ts:140-167` |
| `PORT_KIT` | 开局 9 个盒 | 否 | `port.pack.ts:51-58` |
| `STRUCTURE_MODULES` | 唯一结构模块 `structure.frame` | 否 | `assembly-module.ts:41-54` |
| `structurePlacementIssue` | 只校验"同层正交相邻" | 否 | `assembly-runtime.ts:479-498` |
| `placeFrameAt` | 结构放置事务（走 `mechanical.placePart`） | 否 | `assembly-system.ts:245-250`（事实表 B §10.3） |
| `STRUCTURE_KIT_COUNT` | 开局 4 个结构框架 | 否 | `assembly-system.ts:51-53,96-99` |
| `AssemblyRuntime.reconcile` | 每帧从真实零件推导组合；**没有任何门控点** | 否 | `assembly-runtime.ts:360-394`（事实表 B §10.3） |

### 7.4 GameRead / UI 协议 / 存档缺口

| 缺口 | 现状 | 证据 |
|:--|:--|:--|
| GameRead 单一入口 | 只有 id `mechanical`；字段 `parts/machines/networks/production/ports/links/assemblies/inventory/player/ui`；**无 goal、无 unlocked** | `assets/mechanical/runtime.ts:103-178` |
| 不得新增第二个 read | P1-D M5 明确警告 | `docs/m20/P1-D-REPORT.md:196` |
| UI 协议 v1 | 5 条命令 / 2 种消息；`UiStateMessage` 只有 `items/hotbar/goal` 三个业务字段 | `protocol.ts:23-48` |
| 前端解析 | `parseState` 防御式；malformed 整包回退初始化态 | `frontend-ui-protocol.ts:60-93`（事实表 C §8.2） |
| 存档缺口 | 6 个接口缺口全部未补；无快照/恢复/版本/迁移 | `SAVE-ARCHITECTURE.md:27-36` |
| 订单快照位置 | 不在 GameRead，只通过 `goalProgress` 服务 → bridge → 协议 `goal` 字段 | `goal-service.ts:28-33`；`bridge.pack.ts:49-58` |

---

## 8. 冲突与风险清单

| # | 冲突/风险 | 事实 | 影响 | 证据 |
|--:|:--|:--|:--|:--|
| C1 | **原型套件已全量发放** | 开局直接给 56 个零件 + 9 个接口盒 + 4 个结构框架，含 3 台破碎机/3 台熔炼炉/1 台锻压机/1 台飞轮 | 任何"解锁"当前都无意义；科技树与套件必须二选一或削套件 | `parts.ts:356-370`；`port.pack.ts:51-58`；`assembly-system.ts:51-53` |
| C2 | **锻压 10 条订单外配方** | 锻压机 11 条配方，订单只用第 1 条；其余 10 条（含 3 条核心复制、结构框架）可无限制造机器 | 绕过任何"机器获取"设计；复制配方使"限制数量"失效 | `recipes.ts:158-174`；`docs/m20/P2-D-REPORT.md:287`（R2） |
| C3 | **物品分类只有 2 类** | `resource \| mechanical`；接口盒/结构框架借 `mechanical` 通过"建筑让出输入"判定 | 科技树无法按"零件/模块/原料"分类过滤，需要新分类或新字段 | `items.ts:10,98-106`；`docs/m20/P2-B-REPORT.md:314` |
| C4 | **12 格快捷栏已满** | 套件绑定 11 格（0-4、6-11），5 号刻意留空 | 新物品无槽可绑；任何新增零件都要先做菜单 | `parts.ts:372-390`；`hotbar.ts:8`；`docs/PROGRESS.md:208` |
| C5 | **无交付交互** | `assets` 内无"提交物品"实现；订单"交货"仅是文案 | 若解锁依赖"交材料"，需从零做交互 + 多物品事务 + 状态 | §5.3；`order.ts:99-103` |
| C6 | **无存档** | 0 行实现；6 个接口缺口未补 | 解锁状态、订单基线、已交付材料刷新即丢 | §5.2；`SAVE-ARCHITECTURE.md:27-36` |
| C7 | **矿量上限 80** | 4 矿点 × 20；无无限资源、无购买、无掉落 | 依赖铁锭的解锁/制造成本会被总矿量硬约束 | `resource.ts:12-13,33-38` |
| C8 | **R 键双职责** | 同一帧既转放置预览（`mechanical.pack.ts:441`）又切配方（`runtime.ts:289-291`） | 切完配方后下一次放置会莫名转向；验收脚本需自行记账 | `docs/PROGRESS.md:70`；`docs/m20/P2-B-REPORT.md:310`（R1） |
| C9 | **C 键双职责** | 按住 C = 摇飞轮；刚按下 C = 投料；飞轮在待投料机器 2.2 m 内时同一次按键两件事 | 交互歧义 | `runtime.ts:197,294-299`（事实表 A §7.4） |
| C10 | **文档与实现不一致（摇柄键）** | `docs/m18/PLAN.md:76` 写"按住 F"，实现是 `C` | 文档误导后续设计与验收 | `runtime.ts:197`；事实表 A §7.3 |
| C11 | **文档与实现不一致（飞轮扭矩）** | `docs/m18/PLAN.md:75` 写 `maxTorque 100`，实现 `TORQUE_FLYWHEEL = 140` | 负载计算若按文档会错 | `parts.ts:116,253`；事实表 A §7.3 |
| C12 | **"同格叠放成链"不成立** | 任务书/口头说法与单测相反：同格叠放锚点差一格，**不成链** | 跨层方案若按此假设设计会失败 | `__tests__/vertical-drive.test.ts:138-146`（事实表 A §7.3） |
| C13 | **订单第 1 步口径缺陷** | 用"当前背包铁矿石"判定，全部投进机器会卡步骤 | 顺序敏感，玩家可能被卡住 | `goal.ts:88-89`；`docs/m20/P1-D-REPORT.md:201`（L4） |
| C14 | **订单快照不在 GameRead** | 机器可读投影只有 `mechanical`，无 goal | 若验收要求"从 read 读科技状态"，必须并入该 read | `runtime.ts:128-170`；`docs/m20/P1-D-REPORT.md:196` |
| C15 | **`speedMultiplier` 未接入** | 三个核心全 1，运行时无读取 | 无法只用数据做"不同核心不同速度" | `processing-core.ts:94-98`；事实表 B §9.2 |
| C16 | **齿轮/测试源/冲压机/飞轮不可再生** | 无任何配方产出 | 丢失或耗尽后只能重开；也是"限制数量"最硬的约束 | `recipes.ts:158-174` 输出集合 |
| C17 | **结构模式中不能拆零件** | P 模式让出机械输入 | 拆结构框架需先退出模式 | `docs/m20/P2-D-REPORT.md:246`；`mechanical.pack.ts:424-431` |
| C18 | **单源树状动力** | 多源与闭环一律 unsupported | 扩大产能只能扩树（加轴/齿轮），无并联冗余 | `power.ts:8-14,256-260` |
| C19 | **单物料单输出加工** | 运行时只取 `inputs[0]/outputs[0]` | 多输入/副产物配方无法运行，即使数据表允许多项 | `production.ts:181-182`；`recipes.ts:181-189` |
| C20 | **文档进度口径与代码不同步风险** | `docs/PROGRESS.md` 多处"未实现"清单与阶段报告重复维护 | 统计口径易漂移 | `docs/PROGRESS.md:26-27,53`；`docs/m20/P2-D-REPORT.md:275-278` |

---

## 9. 调查限制说明

| # | 限制 | 影响 |
|--:|:--|:--|
| 1 | **未运行任何门禁**：`pnpm test` / `typecheck` / `build` / `project play` 全部未执行 | "555 用例全绿"来自 `docs/m20/P2-D-REPORT.md:178,312`，**不是本次实测**；本次仅静态计数 555 |
| 2 | **未进入游戏**：所有行为结论来自代码阅读、单测断言与既有阶段报告 | 观感类事实（HUD 实际排布、动画、视觉辨识度）未经本次截图验证 |
| 3 | 未逐行复算物理/数值 | 扭矩/能量/速度结论引用常量定义与既有单测，未做独立数值仿真 |
| 4 | 前端只读源码与 CSS | 未核对真实 DOM 结构与浏览器渲染结果 |
| 5 | 事实表在仓库外（`E:\DeepseekHarness\m2-investigation\e0\`） | 不随仓库交付；关键结论已在本文件回填 `file:line` |
| 6 | 行号基于 `f0fd623` | 任何后续提交都会使行号漂移，复核需按 commit 检出 |
| 7 | 静态搜索可能漏掉动态字符串构造（如拼接的 ID） | 但"科技树/存档 0 实现"的结论同时被多份阶段报告独立佐证，可信度高 |
| 8 | 少数条目标注"（推断）"（如竖向齿轮啮合实际不可用、`speedMultiplier` 未来接入方式） | 推断均显式标注，不作为事实引用 |

---

## 调查结论

1. **物品 19 / 配方 13 / 零件 12 / 加工核心 3 / 安装位 6**，全部为静态数据驱动，结构稳定、可直接引用；唯一分类维度是 `resource|mechanical`，无法表达"零件/模块/原料"。
2. **没有任何科技树、解锁、市场、交付交互或存档的代码**：`assets` 内 8 处"科技/解锁"命中全是注释，持久化 0 行实现，交付 grep 0 实现。
3. **"玩家能不能用某物"目前只由两件事决定：库存 `has()` 与开局原型套件**（56 零件 + 9 接口盒 + 4 结构框架）；锻压机另有 10 条订单外配方（含 3 条核心复制）可无限再生产能力。
4. **动力系统是完整可玩的静态模型**（单源树、齿轮比、速度下垂、源/支路两级过载、飞轮能量池），但**无并联、无惯量、无风/水/蒸汽/电力**；测试动力源与冲压机是调试件/运动学原型。
5. **加工与物流是真实能力而非占位**：3 核 6 槽、单物料单输出批式状态机、接口盒原子转移、分流/合流轮询公平、连接失效保留恢复、多级串联无硬上限。
6. **组合机械只提供组织关系**：≥2 核心 + 同层正交相邻的结构框架 → 组合；成员保留自身 ID/状态/动力需求，`powerDemandTorque` 仅展示，**不产生新产能、不合并动力求解**。
7. **订单是纯只读教程目标**：8 步（7 实质 + 完成态）、10 种阻塞码、相对首帧基线增量判定、latch 不回退、**不扣材料、不交付、不奖励**；其"latch + 基线 + 只读投影 + 阻塞文案 + HUD 管线"是全仓库最接近"科技/解锁"的既有模式。
8. **工程化基础设施齐备但缺三层**：唯一 GameRead `mechanical` 与 UI 协议 v1 已成型（禁止第二个 read）；缺科技数据/UI/解锁判定、缺持久化（设计文档列出 6 个接口缺口）、缺交付交互。
9. **最硬的资源与空间约束**：矿量 80 上限、12 格快捷栏满（11 格已绑）、齿轮/测试源/冲压机/飞轮不可再生——任何"限制获取"的设计都会被这三条直接顶住。
10. **主要风险集中在"临时原型供给"与"文档漂移"**：原型套件 + 8 条临时配方 + 10 条订单外配方构成对抗解锁的既成事实；另有 4 处文档/实现不一致（C/ F 键、飞轮 100/140、同格成链、R 键双职责）需在引用文档时先核对代码。
