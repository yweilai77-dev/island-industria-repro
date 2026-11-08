# M2.0-P2-A 实施完成报告

- 阶段：M2.0-P2-A（工业对象与数据定义）
- 日期：2026-11-08
- 开工基线：`8cead63`（`main`，工作区 clean）
- 完成代码 HEAD：`2d8fcf5`（本报告与 PROGRESS 更新随后单独提交）
- 授权范围：仅 P2-A；未进入 P2-B 及后续阶段
- 结论：**P2-A 范围内的内容全部完成**。新增 `assets/industrial/` 纯数据层（6 个源文件 +
  3 个测试文件），现有运行时**一行未改**，`pnpm test` 48 文件 / 460 用例全绿，
  类型检查 / 工程检查 / 构建全绿，构建产物与 P1-D 基线**逐字节一致**，
  M2.0-P1 订单与 M1.8 生产链真实游戏 Playthrough 均通过。

> 本报告严格区分五种状态：**已实现并测试** / **仅完成设计（类型或文档）** /
> **已预留但未实现** / **明确未实现** / **建议后续处理**。见 §9。

---

## 1. 阶段目标与完成口径（逐条对照任务书 §5）

| # | 任务书要求 | 本阶段结果 | 证据 |
|:--|:--|:--|:--|
| 1 | 现有工程定向调查（8 项），必须追踪实际调用关系 | **完成** | [P2-A-INVESTIGATION.md](P2-A-INVESTIGATION.md)，每条结论带 `文件:行` |
| 2 | 设计 8 个工业对象的数据定义 | **完成** | [P2-A-DESIGN.md](P2-A-DESIGN.md) §3 + `assets/industrial/*` |
| 3 | 与现有系统接入（兼容、渐进、不重复状态） | **完成**：单向只读接入，零运行时改动 | 本报告 §6 |
| 4 | 测试与验收（8 类） | **完成** | 本报告 §7 |
| 5 | 交付物 1–10（报告、设计、清单、关系图、兼容、测试、校验、Git、风险） | **完成** | 本报告 §2 索引 |
| 6 | 禁止事项 §六 13 条 | **全部遵守** | 本报告 §10 |

任务书 §5.3 的 8 个概念，逐条落地情况：

| 概念 | 本阶段状态 |
|:--|:--|
| Item | **已存在，零改动**（复用 `items.ts`；完整性校验覆盖配方引用） |
| Recipe | **已存在 + 新增派生视图**（全局 ID 索引、工艺归属、完整性校验） |
| ProcessingCore | **已实现并测试**（`core.crusher/smelter/forge`，数值从现有真源派生） |
| PortModule | **已实现（纯数据）并测试**（`port.through/splitter/merger`，未绑物品、未接入游戏） |
| MachineEntity | **类型 + 只读投影已实现并测试**（身份复用 `MechanicalPart.id`） |
| PortInstance | **仅类型 + 校验函数**（安装归 P2-B） |
| Connection（物料） | **仅类型 + 校验函数**，命名 `MaterialLink` 避免与动力 `Connection` 冲突 |
| Assembly | **仅类型 + 构造校验**（管理归 P2-D） |

---

## 2. 交付物索引（任务书 §八）

| # | 交付物 | 位置 |
|:-:|:--|:--|
| 1 | 现有工程架构调查报告 | [docs/m20/P2-A-INVESTIGATION.md](P2-A-INVESTIGATION.md) |
| 2 | 工业对象数据模型设计说明 | [docs/m20/P2-A-DESIGN.md](P2-A-DESIGN.md) |
| 3 | 实际修改文件清单及职责说明 | 本报告 §4 |
| 4 | 关键对象关系图 | 本报告 §5（另有 [DESIGN §4](P2-A-DESIGN.md) 的完整版） |
| 5 | 新旧系统兼容说明 | 本报告 §6 + [DESIGN §8](P2-A-DESIGN.md) |
| 6 | 测试报告 | 本报告 §7 |
| 7 | 类型检查、项目校验和构建结果 | 本报告 §8 |
| 8 | Git 提交记录和工作区状态 | 本报告 §12 |
| 9 | 未解决问题与后续风险清单 | 本报告 §11 |
| 10 | P2-A 实施完成报告 | 本文件 |

---

## 3. 开工前后的工程状态

| 项 | 开工时 | 完成时 |
|:--|:--|:--|
| 分支 / HEAD | `main` / `8cead63` | `main` / 见 §12（两个提交） |
| 工作区 | clean，无 stash | clean（本报告提交后） |
| 测试 | 45 文件 / 422 用例通过 | **48 文件 / 460 用例通过** |
| 类型检查 | 通过 | 通过 |
| 工程检查 | `ok: true` | `ok: true` |
| 构建 | 208 artifacts / 21,631,533 B | **208 artifacts / 21,631,533 B（完全一致）** |
| 后台 autosave | Running（pid 19716） | 已暂停 → 完成后恢复（见 §12） |

> 开工前的 422/45 是把 P1-D 报告里的数字**重新跑出来**核对的结果，不是引用。

---

## 4. 实际修改文件清单及职责

**新增 9 个文件，修改 0 个既有文件**（`git diff --stat` 为空，`git status` 只有 untracked）。
所有代码文件均 < 20 KB（提交钩子要求）。

### 4.1 源码：`assets/industrial/`（6 个文件，960 行）

| 文件 | 行数 | 职责 |
|:--|--:|:--|
| `ids.ts` | 130 | 定义类稳定 ID 的类型与格式（`CoreId` / `PortModuleId` / `PortSlotId` / `RecipeId`）、运行时复合键（实体 ID、接口实例键、物料连接 ID、组合机械 ID）、工艺/方向/接口盒种类枚举。零依赖。 |
| `processing-core.ts` | 185 | `ProcessingCoreDef` + `PortSlotDef`。3 个加工核心全部从 `parts.ts` / `recipes.ts` / `production.ts` **派生**（额定动力、缓冲、几何、配方），唯一新写的是安装位布局；深度冻结。 |
| `port-module.ts` | 104 | 3 种接口盒（直通/分流/合流）的纯数据定义与查询。`itemId` 一律 `null`（P2-B 才绑物品）。无运行时。 |
| `catalog.ts` | 157 | 唯一只读工业目录：核心、接口盒、配方派生视图（含 `process` 与 `coreIds`）、安装位全局索引，以及按 ID 反查的 6 个函数。 |
| `runtime-model.ts` | 171 | 运行时类型 `MachineEntity` / `PortInstance` / `PortEndpoint` / `MaterialLink` / `Assembly`，加 5 个纯函数：`machineEntityOf`（只读投影）、`portInstanceOf`、`materialLinkBetween`、`validatePortInstance`、`validateMaterialLink`、`createAssembly`。**没有任何注册表/服务/每帧系统。** |
| `integrity.ts` | 263 | 完整性校验器：ID 格式与唯一性、与现有真源逐项一致、接口盒未绑物品、安装位方向与面约束、配方合法、静态定义不得混入运行时字段。返回问题列表，不抛错。 |

### 4.2 测试：`assets/__tests__/`（3 个文件，38 个用例，487 行）

| 文件 | 用例 | 覆盖 |
|:--|--:|:--|
| `industrial-catalog.test.ts` | 15 | 完整性零问题 + 校验器**能报错**（4 个负向用例）、ID 格式/唯一性/命名空间、四类索引可反查、定义深度冻结与改写抛错 |
| `industrial-compat.test.ts` | 12 | 核心派生字段 = 零件定义、核心集合 = `PRODUCTION_MACHINE_IDS`、配方列表与**顺序** = `recipesFor`、配方对象未被复制、工艺归属、**真实 `solvePower` 报告三核心负载之和 64 N·m**、产物方向 = 本地 +X、安装位不占动力端口面、物品数仍 14、接口盒未绑物品 |
| `industrial-runtime-model.test.ts` | 11 | 机器实体投影与身份复用、非加工机器返回 undefined、不携带加工/动力字段、`placement` 是复制值、运行时对象可变且每次新建、接口盒与安装位校验、物料连接方向校验、`Assembly` 成员校验 |

### 4.3 文档（2 个文件，900 行）

| 文件 | 职责 |
|:--|:--|
| `docs/m20/P2-A-INVESTIGATION.md` | 现有工程架构调查报告（8 类系统 + 5 条调用链 + 复用/调整/重构清单 + 8 概念映射 + 8 项风险） |
| `docs/m20/P2-A-DESIGN.md` | 工业对象数据模型设计说明（ID 规范、8 个对象、关系图、归属表、兼容与翻转点、扩展性论证、被否方案） |
| `docs/m20/P2-A-REPORT.md` | 本报告 |
| `docs/PROGRESS.md` | 追加 P2-A 进度快照（§13） |

---

## 5. 关键对象关系图（简版）

```
静态定义（冻结、只读、不进存档）
  ItemDefinition ◄─ ItemId
      ▲ 1:1 (partDefForItem)
  MechanicalPartDef ◄─ PartId        [已存在]
      │ ├ 几何 / 传动 / loadTorque / buffers
      ▼  派生并校验一致
  ProcessingCoreDef ◄─ CoreId = "core.crusher"     [新增]
      ├ corePartId ──► PartId        （身份桥：核心本体 = 可放置零件）
      ├ process / speedMultiplier / ratedLoadTorque / buffers / 几何
      ├ recipeIds ──► Recipe ──► RecipeDefinition（+process, +coreIds）
      └ portSlots[] ──► PortSlotDef ◄─ PortSlotId = "slot.crusher.in.pz"
  PortModuleDef ◄─ PortModuleId = "port.through"   [新增，itemId = null]

运行时状态（纯 JSON、可变、可序列化）
  MechanicalPart { id, def, placement }            [已存在，registry 拥有]
      │ 投影（同一 id）
      ▼
  MachineEntity { entityId, coreId, placement, ports[], assemblyId }   [新增类型]
      ├─► PortInstance { slotId, moduleId }        （P2-B 实现安装）
      ├─► MaterialLink { id, from{}, to{} }        （P2-C 实现传递）
      └─► Assembly     { id, memberIds[] }         （P2-D 实现管理）

  ⚠ 不进 MachineEntity、仍归现有系统：
     加工状态 → MachineState(production.ts) / 动力 → PowerSolution(power.ts)
     库存 → InventoryState / 在途物品 → ChuteState
```

完整版（含每个字段与约束）见 [P2-A-DESIGN.md §4](P2-A-DESIGN.md)。

---

## 6. 新旧系统兼容说明

### 6.1 结论：P2-A 在物理上不可能改变已验收行为

四条相互独立的证据：

1. **零改动**：`git diff --stat` 对既有文件为空。`items.ts` / `inventory.ts` / `recipes.ts` /
   `production.ts` / `transport.ts` / `parts.ts` / `ports.ts` / `power.ts` / `registry.ts` /
   `runtime.ts` / `mechanical.pack.ts` / `goal/*` 全部一字未改。
2. **零反向依赖**：`grep` 全仓，除 3 个新测试文件外，**没有任何模块 import `assets/industrial/`**。
   依赖方向只有 `industrial → 现有模块`。
3. **零运行时入口**：没有新增 Cordis 插件、没有新增 `ctx.provide`、没有新增 GameRead、
   没有改 `forge.json#roots`、没有改 `mechanical` 投影。
4. **构建产物逐字节一致**：208 个 artifact / `21,631,533 B` 与 P1-D 基线**完全相同**，
   说明新模块根本没进运行时包（无人引用，被 tree-shaking 掉）。

### 6.2 数据一致性：不复制、只派生 + 校验

| 工业数据 | 真源 | 保证方式 |
|:--|:--|:--|
| 额定动力 `ratedLoadTorque` | `MechanicalPartDef.loadTorque` | 派生 + `integrity.ts` 等值断言 + `industrial-compat.test.ts` |
| 缓冲 `buffers` | `partDef.buffers`（经 `inputCapacity/outputCapacity`） | 同上 |
| 几何 `footprint/height` | `partDef.w/d/height` | 同上 |
| 配方 `recipeIds` | `recipesFor(corePartId)`（含**顺序**） | 同上 |
| 配方对象本体 | `recipes.ts` 常量 | 直接引用同一对象，测试断言 `toBe` |
| 动力需求求和 | 现有 `solvePower` 逆 BFS 累加 | 用**真实 solver** 跑三核心网络，断言 `demand = 64` |

因此「组合机器动力需求 = 各核心需求之和」**不是新功能**，是现有行为的显式化；
P2-A 没有引入第二套动力、库存或生产状态。

### 6.3 与已验收成果的关系

| 已验收成果 | 影响 |
|:--|:--|
| M1.8 机器加工 / 动力 / 跨层 / 溜槽 | 无（代码未改，Playthrough 通过） |
| M2.0-P1 八步订单状态机与 `GoalSnapshot` | 无（代码未改，Playthrough 8/8 通过） |
| 中文 HUD | 无（未改 `frontend/*`、未改 HUD） |
| GameRead「唯一 read」约束 | 遵守：没有新增第二个 read |

---

## 7. 测试报告

### 7.1 全量单元/集成测试

| 检查 | 命令 | 开工基线 | 完成时 |
|:--|:--|:--|:--|
| 单元/集成测试 | `pnpm test` | 45 文件 / 422 用例通过 | **48 文件 / 460 用例通过** |

新增 **3 个文件 / 38 个用例**（+9.0%），其余 422 个用例**全部保持通过**，没有修改任何既有测试。

### 7.2 任务书 §5.5 要求的 8 类覆盖

| # | 要求 | 覆盖情况 |
|:-:|:--|:--|
| 1 | 现有物品定义和库存回归 | 既有 `mechanical-items` / `inventory` 用例全绿；P2-A 另断言物品数仍为 14 |
| 2 | 现有配方和加工行为回归 | 既有 `production` / `transport` 用例全绿；P2-A 断言配方对象与顺序未被改动 |
| 3 | 现有机器实体创建与放置回归 | 既有 `mechanical-registry` / `build` / `occupancy` / `space` 用例全绿（代码未改） |
| 4 | 现有机械动力网络回归 | 既有 `mechanical-power` / `mechanical-load` / `vertical-drive` 用例全绿；P2-A 用真实 solver 验证三核心负载求和 64 N·m |
| 5 | M2.0-P1 第一张工业订单回归 | 单测全绿 **+ 真实游戏 Playthrough 172 步通过**（见 §7.3） |
| 6 | 新增工业对象 ID 唯一性和数据完整性 | `industrial-catalog.test.ts` 15 用例 + `integrity.ts` 全量校验零问题；含 4 个**负向**用例证明校验器不空转 |
| 7 | 静态定义与运行时状态没有错误混用 | `industrial-catalog` 的冻结/改写抛错 + `integrity` 的运行时字段检查 + `industrial-runtime-model` 的「不携带加工/动力字段」 |
| 8 | 类型检查、构建、项目校验 | 见 §8，全部通过 |

### 7.3 真实游戏回归（在最终代码上跑）

| # | 脚本 | 结果 | steps | 耗时 | console / page |
|:-:|:--|:--|--:|--:|:--|
| 1 | `scripts/m20-first-order.mjs` | **通过**（0/8 → 8/8） | 172 | 101.4 s | 0 / 0 |
| 2 | `scripts/m18c-production.mjs` | **通过**（采矿→破碎→熔炼→锻压） | 133 | 109.3 s | 0 / 0 |

两次 `project play` 均返回 `passed: true`、`rendered: true`；截图已人工打开核对：
中文订单 HUD 显示 0/8、当前目标与阻塞提示正常，快捷栏 12 格、世界与网格正常渲染，
无 HUD 重叠/裁切。截图目录：`artifacts/play/scripts/m20-first-order/`、
`artifacts/play/scripts/m18c-production/`（`artifacts/` 按约定不入库）。

> 说明：P2-A 没有改动画/渲染/HUD，这两条回归的作用是**证明"没影响"**，
> 不是"新功能验收"。P2-A 没有任何玩家可见的新功能。

---

## 8. 类型检查、工程校验与构建

| 检查 | 命令 | 结果 |
|:--|:--|:--|
| 类型检查 | `pnpm typecheck`（`tsc --noEmit`） | 通过，无输出 |
| 工程检查 | `pnpm exec forgeax project check --json` | `{"ok":true,...}` |
| 生产构建 | `pnpm exec forgeax project build` | 成功：208 artifacts / 21,631,533 B |
| 单测 | `pnpm test` | 48 文件 / 460 用例通过 |

> 构建产物与 P1-D 基线（208 / 21,631,533 B）**完全一致**，是新模块未进入运行时包的直接证据。

---

## 9. 状态清单（已实现 / 仅设计 / 未实现）

### 9.1 已实现并测试

- 定义类稳定 ID 规范与校验（`ids.ts`）
- 3 个加工核心定义（派生、冻结、校验一致）
- 每个核心 1 输入 + 1 输出安装位定义（ID 编码、方向、面、容量、高度、格内偏移）
- 3 种接口盒纯数据定义（直通 1/1、分流 1/2、合流 2/1；未绑物品）
- 配方全局索引 + 工艺归属（`process` / `coreIds`）
- 唯一只读工业目录与 6 个反查函数
- `MachineEntity` 只读投影（身份复用 `partId`）
- `PortInstance` / `MaterialLink` / `Assembly` 的**构造与校验函数**
- 完整性校验器（ID、真源一致、安装位约束、配方、静态/运行时混用）

### 9.2 仅完成设计（有类型，无运行时）

| 对象 | 只有什么 | 缺什么 |
|:--|:--|:--|
| `MachineEntity` | 类型 + 投影函数 | 真正的运行时持有者（P2-B 由机器实体状态持有） |
| `PortInstance` | 类型 + `validatePortInstance` | 安装/拆卸、占位、接口盒物品消耗（P2-B） |
| `MaterialLink` | 类型 + `validateMaterialLink` | 建立/拆除连接、实际传料、堵塞背压（P2-C） |
| `Assembly` | 类型 + `createAssembly` | 成员管理、整体操作、连接模块拆装（P2-D） |
| `ProcessingCoreDef.speedMultiplier` | 字段（当前恒 1） | 参与到加工时长计算（P2-D） |
| 安装位默认布局（输入 = `pz`，输出 = `px`） | 数据 | P2-B 的可视化模型与最终布局确认 |

### 9.3 明确未实现（授权边界内不做）

接口盒实际安装、加工核心自由拼接、多核心间物流连接、新传送带、组合机械结构模块、
动力网络规则修改、科技树 UI/解锁、工业市场/收购/采购/任务点数、新机器与新配方、
玩家 HUD 修改、液体/气体物流、磨损/碰撞/材料疲劳物理模拟。

---

## 10. 禁止事项核对（任务书 §六 13 条）

| # | 禁止事项 | 遵守情况 |
|:-:|:--|:--|
| 1 | 实现接口盒实际安装 | ✅ 未实现（仅类型 + 校验函数，无安装代码） |
| 2 | 实现加工核心自由拼接 | ✅ 未实现 |
| 3 | 实现多核心之间物流连接 | ✅ 未实现（仅 `MaterialLink` 类型） |
| 4 | 实现新的传送带系统 | ✅ 未实现（未改 `transport.ts`） |
| 5 | 实现组合机械结构模块 | ✅ 未实现（仅 `Assembly` 类型） |
| 6 | 修改机械动力网络计算规则 | ✅ 未改 `power.ts` / `runtime-state.ts` |
| 7 | 实现科技树 UI 或解锁 | ✅ 未实现 |
| 8 | 实现工业市场/收购/采购/任务点数 | ✅ 未实现 |
| 9 | 实现新一批工业机器和大量新配方 | ✅ 未新增任何机器或配方（物品仍 14 个、配方仍 5 条） |
| 10 | 修改玩家 HUD | ✅ 未改 `frontend/*` / `hud.ts` |
| 11 | 引入液体、气体物流 | ✅ 未引入 |
| 12 | 引入磨损/碰撞/材料疲劳物理模拟 | ✅ 未引入 |
| 13 | 擅自修改已验收的 M1.8 / M2.0-P1 玩法 | ✅ 代码零改动 + 两条 Playthrough 通过 |
| — | 未经批准启动 P2-B 或后续阶段 | ✅ 未启动 |
| — | 启动子代理 / 把任务拆给其他 Agent | ✅ 全程单 Agent 完成，未使用子代理 |

---

## 11. 未解决问题与后续风险

### 11.1 需要用户决策（不阻塞 P2-A，但 P2-B 开始前需要答复）

| 编号 | 问题 | 两个选项 | 建议 |
|:--|:--|:--|:--|
| **Q1** | 现有机器**输入侧没有固定面**（任意相邻溜槽都能投料，玩家还能悬停按 C 直接投料）。P2-B 引入固定安装位会**收紧**现有玩法。 | ① 保留「任意相邻溜槽仍可投料 + 悬停 C 投料」，接口盒是**增强**；② 只允许通过接口盒投料，取消旧路径 | **①**。M1.8 已验收的自动化路径不能被新架构废掉；接口盒应该是「让产线更规整」，不是「不装就不工作」。若选 ②，必须同步改 `production-runtime.ts` 的 `handoff` 与悬停投料，属于已验收玩法变更，需单独授权 |

### 11.2 已知风险与后续处理（按阶段归属）

| 编号 | 风险 | 影响 | 建议阶段 |
|:--|:--|:--|:--|
| R1 | 安装位默认布局（输入 `pz` / 输出 `px`）是**数据选择**，尚无 3D 模型支撑 | P2-B 可能要改面或加位 | P2-B。只改 `PORT_SLOT_LAYOUT_BY_PART` 一处，模型不变 |
| R2 | `ProcessingCoreDef` 的 `speedMultiplier` 目前恒 1、不参与计算 | 是「预留字段」，不是已生效功能 | P2-D 接入 `tickMachine` |
| R3 | 加工速率基准 60 RPM 仍是散落的隐式常量（`rpmOf` 默认值、`rateOf` 公式） | 引入不同额定转速核心时易错 | P2-D。P2-A 只在文档中显式记录，未引入新常量去替换现有实现 |
| R4 | 配方仍按「机器零件」索引，而非「加工工艺」 | 数据驱动加工的前提未满足 | P2-D 翻转（会改运行时，需单独授权） |
| R5 | `MECHANICAL_PART_DEFS` 同时承载几何/传动/动力/加工四类语义 | P2-D 迁移时容易改出「一个对象承担所有职责」 | P2-D；P2-A 已把加工概念在数据层独立出来 |
| R6 | 无存档；工业对象将来必须可序列化 | 现在无直接影响 | 与 M2 存档 P0 绑定。P2-A 已保证静态定义冻结、运行时类型纯 JSON |
| R7 | `docs/ROADMAP.md` 写的是「M2 体验完整度 → M3 工业深度」，与本次「M2.0-P2 工业系统」授权不一致 | 文档漂移，可能误导后续判断 | **未擅自修改 ROADMAP**；等用户定稿后再同步 |
| R8 | 工业数据层目前**没有任何运行时消费者**（只有测试 import） | 若 P2-B 迟迟不开始，会被误认为死代码 | 已在本报告与 DESIGN §8.1 写清：这是 P2-A 的**刻意选择**（任务书 §5.4 禁止提前建空壳系统） |
| R9 | `MachineEntity.ports` / `assemblyId` 恒为空 / null | 字段已预留但无人写入 | P2-B / P2-D；已标「仅设计」 |
| R10 | 提交钩子 20 KB 上限 | 未来数据表变大时会被拒 | 已按职责拆成 6 个源文件（最大 11,966 B），P2-B 继续拆 |

### 11.3 建议的下一步（不擅自执行）

1. **回答 Q1**（机器输入面是否收紧）——影响 P2-B 的安装位规则。
2. 授权 P2-B 后，按 DESIGN §8.2 的翻转点推进：接口盒物品化 → 安装位运行时 → `PortInstance` 有归属。
3. P2-B 同期补 `ItemCategory` 的「工业组件」分类与图标（会动 `items.ts` / `frontend/icons.ts`，需明确授权）。
4. 若要尽早降低 R4 风险，可在 P2-C 结束时把「配方按工艺索引」作为独立小步先做掉。

---

## 12. Git 提交记录与工作区状态

### 12.1 提交记录

| 提交 | 类型 | 内容 |
|:--|:--|:--|
| `f44cbd0` | feat | 工业对象数据层 6 个源文件 + 3 个测试文件（9 files, +1,497） |
| `2d8fcf5` | docs | 架构调查报告 + 数据模型设计说明（2 files, +896） |
| 见 `git log` | docs | 本报告 + `docs/PROGRESS.md` 更新 |

- 提交方式：**人工有意义提交**，未使用后台 autosave 代提交，未使用 `--no-verify`。
- 开工时 HEAD `8cead63`；本次提交历史线性追加，未改写任何历史、未 `reset`、未 `rebase`。
- 后台 autosave 在开工时**暂停**（避免把工作拆成无意义的 autosave 提交，也避免与人工提交抢暂存区）；
  **任务结束后已恢复**。

### 12.2 工作区状态

- 完成时 `git status --short` 无输出（clean），无 stash，无未提交改动。
- `artifacts/`（Playthrough 截图、`play.json`）按 `.gitignore` 约定不入库。

### 12.3 变更规模

```
git diff --stat 8cead63..HEAD
 assets/industrial/            6 files,  960 lines
 assets/__tests__/industrial-* 3 files,  487 lines
 docs/m20/P2-A-*.md            3 files
 docs/PROGRESS.md              1 file（追加）
 既有文件改动：0
```

---

## 13. PROGRESS 更新

已在 [docs/PROGRESS.md](../PROGRESS.md) 顶部追加 P2-A 快照：阶段结论、测试/构建数字、
新增数据层边界、以及「P2-A 无玩家可见新功能」的说明，避免把数据地基误读成玩法交付。

---

## 14. 完成判定

| 判据 | 结果 |
|:--|:--|
| 任务书 §5 全部 4 步完成 | ✅ |
| 交付物 1–10 齐备 | ✅ |
| 8 个工业对象都有明确职责/ID/归属/静态-运行时边界 | ✅ |
| 旧系统一行未改，已验收玩法无回归 | ✅（零 diff + 两条真实游戏 Playthrough + 构建产物字节一致） |
| 完整回归全绿 | ✅ 48 文件 / 460 用例 + typecheck + check + build |
| 未越界进入 P2-B 或后续阶段 | ✅ |
| 未擅自创建里程碑 tag | ✅ 未创建任何 tag |

**P2-A 到此结束。等待用户验收与 P2-B 授权。**
