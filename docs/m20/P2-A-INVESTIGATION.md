# M2.0-P2-A 现有工程架构调查报告

- 阶段：M2.0-P2-A（工业对象与数据定义）第 1 步
- 日期：2026-11-08
- 调查基线：`main` @ `8cead63`（工作区 clean，见 §2）
- 方法：只按**实际调用关系**追踪，不按文件名推测。每个结论后面标了 `文件:行`，可复核。
- 结论：现有系统的数据边界基本清晰，**不需要为 P2-A 重构任何运行时模块**。P2-A 可以以
  「单向只读接入」的方式新增工业数据层，旧系统一行不改也不受影响。真正需要未来翻转的只有
  一处：`Recipe` 目前按「机器零件」索引，未来要按「加工工艺」索引（P2-D 处理）。

---

## 1. 调查目标

任务书 §5.2 要求查清 8 件事：物品定义在哪、配方如何定义与执行、机器如何创建与保存、
加工状态由谁管理、动力负载如何统计、生产结果如何进库存、测试与真实游戏验收入口在哪、
哪些可复用 / 哪些需最小调整。

本文逐条回答，并在 §6 给出与 P2 总体设计的映射与缺口。

---

## 2. 工程基线实测

| 项 | 实测值 |
|:--|:--|
| 分支 / HEAD | `main` / `8cead63`（`docs: 修正 D 报告测试文件计数表述`） |
| HEAD 之前 | `8366667`（P1-D 验收报告定稿）→ `6998706` → `d58b57d`（P1-D 最终验收基线） |
| 工作区 | clean（`git status --short` 无输出）；无 stash |
| tag | `m17c-baseline` / `m17c-final` / `m17c-rev1-wip` / `m17c-rev2-wip` / `m18-final` |
| 后台自动存档 | 计划任务 `ISLAND INDUSTRIA Git Autosave` Running（pid 19716，已在本阶段开始时暂停，见报告 §Git） |
| 单元测试 | `pnpm test` → **45 文件 / 422 用例全部通过**（2.0 s） |
| 类型检查 | `pnpm typecheck` → 通过（`tsc --noEmit`，无输出） |
| 工程检查 | `pnpm exec forgeax project check --json` → `ok: true` |
| 源码规模 | `assets/` 非测试源码 73 个 `.ts`，13,216 行；测试 45 个 `.test.ts`（另有 3 个共享 fixture） |

以上是把 P1-D 报告里「45 文件 / 422 用例」的数字在本机**重新跑出来**的结果，不是引用旧报告。

---

## 3. 逐项调查

### 3.1 物品定义与库存系统

**物品定义**：`assets/items/items.ts`

- `ItemId` 是 14 个字面量字符串的联合（`items.ts:12-26`），全部为 snake_case。
- `ItemDefinition`：`{ id, name, description, icon, maxStack, category }`（`items.ts:28-40`）。
- `ItemCategory` 只有 `'resource' | 'mechanical'` 两个值（`items.ts:10`）。
- `DEFINITIONS` 是 `ItemId → ItemDefinition` 的 `ReadonlyMap`（`items.ts:179-183`）；
  `getItemDefinition` 返回 `undefined`，`requireItemDefinition` 抛错（`items.ts:186-195`）。
- **静态定义与运行时状态已经分离**：物品定义是只读表；运行时只有 `ItemStack = { itemId, count }`。

**库存**：`assets/inventory/inventory.ts`

- `InventoryState = { stacks: ItemStack[] }`（`inventory.ts:14-16`），只存 `itemId + count`，
  名称/图标/`maxStack` 全部从物品定义反查（`inventory.ts:138`）。
- 纯逻辑：`inventoryAdd` 先补未满堆再按 `maxStack` 新开堆（`inventory.ts:64`）；
  `inventoryRemove` 是**整笔**语义，数量不足时不改状态（`inventory.ts:96`）。
- 服务对象 `createInventoryService()`（`inventory.ts:136`）在 `inventory.pack.ts:12`
  通过 `ctx.provide('inventory', …)` 注入引擎上下文；其他插件用 `inject: ['inventory']` 取用。

**结论**：物品与库存的「定义 / 运行时状态」边界已经是 P2 想要的样子，P2-A 不需要改。
唯一缺口是 `ItemCategory` 缺少「工业组件」这一类（接口盒将来成为真实物品时需要），
但那属于 P2-B 的物品接入，**本阶段不动**，登记为后续决策。

### 3.2 配方与机器加工系统

**配方**：`assets/production/recipes.ts`（纯数据、零引擎依赖）

- `Recipe = { id, label, inputs: RecipeIngredient[], outputs: RecipeIngredient[], seconds }`
  （`recipes.ts:19-29`）。`inputs/outputs` **本来就是数组**，多输入多输出在类型层已支持；
  真正的限制在运行时（见下）。
- 目前 5 条配方：`crush-iron-ore`、`smelt-crushed-ore`、`forge-shaft`、
  `forge-vertical-drive`、`forge-chute`（`recipes.ts:31-70`）。
- `seconds` 是「额定 60 RPM 下」的时长；`MACHINE_RECIPES` 以 **`PartId` 为键**
  （`recipes.ts:73-77`），`recipesFor(partId)` 是唯一查询入口（`recipes.ts:80`）。
- 便利函数 `primaryInputOf` / `primaryOutputOf` / `machineAccepts`（`recipes.ts:85-97`），
  它们是「当前运行时只支持单输入单输出」的显式化。

**执行**：`assets/production/production.ts`（纯逻辑状态机）

- `MachineState`：`{ partId(number), recipeIndex, progress, inputItem/inputCount,
  outputItem/outputCount, running, block, producedTotal }`（`production.ts:18-33`）。
  `partId` 是**运行时实体 id（number）**，不是 `PartId`；配方定义通过参数 `def` 传入。
- `tickMachine`（`production.ts:162-234`）是本作加工规则的唯一实现：
  - 动力不足 → `block='no-power'`，**进度冻结、不扣料**；
  - 开工时**整笔扣料**、整笔检查输出空间，绝不半途扣料；
  - 完成时输出缓冲满 → 进度停在 1.0，`block='output-full'`，**不丢产物**；
  - `producedTotal` 是真实累计产出（订单判定用它，不从动画推导）。
  - 注释里记录了一个真实事故：`dt=0` 时曾照常扣料导致物品凭空消失（`production.ts:167-171`）。
- 加工速率 = `rate × dt / recipe.seconds`，`rate` 由调用方注入（见 3.4）。

**结论**：配方数据类型已经够 P2-A 使用；`Recipe` 只有两处需要新层补充：
① 全局唯一的 `RecipeId` 注册表；② 配方 → **加工工艺**的归属（现在只按机器零件归属）。
后者是 P2-D「数据驱动加工」的翻转点，P2-A 只建立数据与校验，不改执行路径。

### 3.3 机器实体、放置与空间系统

这是本作最需要看清的一块，因为它决定了「什么是机器」。

**静态定义**：`assets/mechanical/parts.ts`

- `PartId`：11 个字面量（`parts.ts:10-21`）；`PartKind`：
  `shaft | gear | power-source | machine | transport`（`parts.ts:9`）。
- `MechanicalPartDef`（`parts.ts:55-75`）是一张表，同时承载了**四类语义**：
  ① 几何（`w/d/height`）；② 传动（`teeth`、`maxTorque`、`ratedRpm`）；
  ③ 动力负载（`loadTorque`）；④ 加工缓冲（`buffers`）与端口（`ports`）。
- `MECHANICAL_PART_DEFS`（`parts.ts:171-309`）是唯一真源；
  `partDefForItem`（`parts.ts:368`）从 `ItemId` 反查零件定义，是「物品 ↔ 可放置零件」的桥。
- `PRODUCTION_MACHINE_IDS = ['crusher','smelter','forge']`（`parts.ts:379`），
  `isProductionMachine`（`parts.ts:381`）是全项目判断「这台机器会不会加工物品」的唯一谓词。
  `machine`（冲压机）**故意不在其列**：它是 M1.7 运动学原型，不消耗也不产出物品。

**运行时实体**：`assets/mechanical/registry.ts` + `assets/mechanical/mechanical.pack.ts`

- `MechanicalPart = { id: number, def: MechanicalPartDef, placement: Placement }`（`parts.ts:77-81`）。
  **一个放置的零件 = 一个 `MechanicalPart`**，身份是 `id: number`，由
  `MechanicalRegistry.allocateId()` 单调递增分配（`registry.ts:19`）。
- `MechanicalRegistry`（`registry.ts:13`）是机械逻辑数据的唯一所有者：只存 part 与派生连接，
  不存 Entity、不建格占用表（`registry.ts:6-12` 的注释写明边界）。
- 放置事务 `place()`（`mechanical.pack.ts:295-326`）：
  `allocateId → registry.add → spatial.structures.register → views.add → inventory.remove →
  commitTopology`，任一步失败按逆序回滚（含退还库存物品）。
- 拆除 `remove()`（`mechanical.pack.ts:327-355`）：注销空间 → 销毁视图 → 移出 registry →
  **把零件物品退回库存**，再 commit。
- 空间占用：`SpatialIndex.registerStructure(id, aabb)`（`spatial/occupancy.ts:63`），
  机械零件的公开 id 是 `mech:<partId>`（`parts.ts:123-126`）。
  合法性检查在 `validatePlacement`（`build/build.ts:80`），包括支撑面、三维 AABB 碰撞、玩家占用。
- **没有存档**：registry / SpatialIndex / 视图全部在内存，刷新即重置（PROGRESS §7 已登记）。

**结论**：
- 机器实体的身份就是 `MechanicalPart.id`。P2-A 的 `MachineEntity` **必须复用这个数字 id**，
  否则就会出现两套实体身份 —— 这正是任务书 §5.4「不得引入重复状态」禁止的。
- 「加工核心」与「机械零件」在当前实现里是同一个东西（核心本体就是被放置的零件）。
  P2-A 必须把它们在**数据层**分成两个概念（核心定义 vs 零件定义），同时保持**同一身份**。

### 3.4 机械动力网络

**定义**：`assets/mechanical/ports.ts`（连接）+ `assets/mechanical/power.ts`（解算）

- 端口：`PartPortDef { id, role, axis, face, localCell, localY }`（`parts.ts:26-33`）；
  世界端口由 `portWorld()` 从 `Placement` 派生（`ports.ts:67`）。**端口不存储，只派生**。
- `Connection`（`ports.ts:19-27`）是**机械传动连接**：`{ id, aPartId, bPartId, aPortId,
  bPortId, kind: 'axial'|'gearMesh', ratio }`。注意：这是**动力连接，不是物料连接**。
- `buildConnections()`（`ports.ts:158-211`）按世界锚点分桶，锚点重合 + 法线相反 + 轴平行才成连接，
  每个端口最多一条；结果按 part/port 稳定排序。

**解算**：`assets/mechanical/power.ts` + `assets/mechanical/runtime-state.ts`

- `buildPowerTopology(parts, connections, revision)`（`power.ts:128`）只在 `revision` 变化时重建；
  连通分量、闭环检测（`cyclic-network`）、多源检测都在结构层做，**闭环在任何扭矩计算之前拒绝**。
- `solvePower(topology, parts, enabledSources)`（`power.ts:278`）：
  - 从源 BFS 建驱动树，机器是**动力终端**（可到达但不向外传播，`power.ts:246`）；
  - 负载：`loadOf(part) = part.def.loadTorque ?? 0`（`power.ts:107`），
    逆 BFS 后序把**子节点需求 × 传动比**累加到父节点（`power.ts:337-352`）。
    **因此「多台机器接在同一网络 = 负载相加」本来就是现有行为**，不需要新系统。
  - 速度下垂：`factor = 1 - 源侧需求/源容量`；需求 ≥ 容量 → 整网 `source-overload` 停转；
    传动件扭矩超过 `maxTorque` → 只停该支路（`branch-overload`）。
- `MechanicalRuntimeState`（`runtime-state.ts:126`）持有解算缓存：
  `sync(revision, parts, connections)`（`:140`）→ `ensureSolution`（`:218`）→
  `omegaOf / torqueOf / isStalled / speedFactorOf`（`:285-301`）。
- **加工速率**：`rateOf(partId) = |ω| / (2π)`（`runtime-state.ts:270-273`），
  即 `rate = 1` 对应 60 RPM。这个「60 RPM 基准」是隐式的，写在多处默认值里
  （`rpmOf` 默认 60，`parts.ts` 动力源 `ratedRpm: 60`）。

**结论**：P2-A **绝对不能**引入第二套动力模型。加工核心的「额定动力需求」必须直接是
`MechanicalPartDef.loadTorque`；「组合设备需求 = 各核心需求之和」由现有 `solvePower` 自然给出。
P2-A 只把这些数值在工业数据层**显式复述并校验一致**，不改计算规则。

### 3.5 现有物料运输系统

**存在**：`assets/production/transport.ts` + `ProductionRuntime` 的运输段。

- 重力溜槽 `ChuteState = { item: ChuteItem|null, delivered }`（`transport.ts:29-33`），
  每格同时最多 1 件，`t ∈ [0,1]` 是沿本格朝向的进度，1.2 m/s 匀速（`transport.ts:17`）。
- 堵塞时物品停在 `0.92` 等待，**不复制、不消失**（`transport.ts:19`）。
- 交接在 `ProductionRuntime.handoff()`（`production-runtime.ts:256-295`）：
  下一格是溜槽 → 传给它；是加工机器 → `insertInput`；**末端没有东西 → 交给玩家库存**
  （这是本作唯一的仓储）。
- 机器产物推给相邻溜槽：`pushMachineOutputs()`（`production-runtime.ts:236-254`），
  方向 = 本地 +X 经 `rotation` 旋转后的世界方向。**注意是固定 +X，不是玩家选的**。
- 机器物料的**输入侧没有固定面**：任何指向机器的溜槽都能投料，玩家还可以悬停按 C 直接投料
  （`runtime.ts:404-409`）。

**结论**：现有物流是「溜槽 + 末端进库存」，**没有接口盒、没有核心间直连、没有传送带**。
P2-A 不实现任何新物流，只定义 `PortModule` / `PortInstance` / `Connection`（物料）的数据形状。
需要特别记两点，都会影响 P2-B：
1. 机器输出方向在运行时是**固定 +X**，接口盒/安装位必须与它一致，否则数据与行为会分叉。
2. 机器输入侧当前**没有固定面**；P2-B 一旦引入固定安装位，就是对现有玩法的**收紧**，
   必须显式决策（是保留「任意相邻溜槽都能投料」，还是只走接口盒）。

### 3.6 GameRead、生产状态与订单系统

**唯一读投影**：`assets/mechanical/runtime.ts`

- `registerRead({ id: 'mechanical', … })`（`runtime.ts:278`）是**全项目唯一的 GameRead**。
  注释明确写了「多 read 会让历史 playthrough 的 `play.advance()` 抛 state-unavailable」
  （`runtime.ts:183-185`）—— 这是硬约束，P2-A 不得新增第二个 read。
- `snapshotOf()`（`runtime.ts:229-277`）返回：机械快照（源/网络/零件/机器）+ `production` +
  `inventory` + `player` + `ui`（楼层模式/建造目标/悬停/选中/快捷栏）。
- 每帧顺序（`runtime.ts:364` 起）：`state.sync` → `production.sync` → 输入处理 →
  `state.step(delta)` → 写 `PowerReading` → `production.tick(delta)` → `goalProgress.update`。

**生产状态所有者**：`ProductionRuntime`（`production-runtime.ts:92`）

- `machines: Map<partId, MachineState>`、`chutes: Map<partId, ChuteState>`、
  `producedTotals: Map<ItemId, number>`（运行时生命周期累计）。
- `sync(parts)`（`:105`）：新增零件建状态；**零件消失时把缓冲/在途物品交回库存**（永不销毁物品）。

**订单系统（M2.0-P1）**：`assets/goal/*`

- `goal.ts` 是八步状态机；输入是纯数据 `GoalObservation`（`goal/observation.ts:58-71`）；
  订单步骤只读 `production.produced` 相对**首帧基线**的增量（`goal.ts:72-78`、`runtime.ts:154-187`）。
- `goalProgress` 服务由 `createGoalProgress()` 产出（`runtime.ts:154`），
  `yield ctx.provide('goalProgress', …)` 只暴露 `snapshot/observation/state` 三个只读方法。
- 边界在注释里写死：目标系统**不认识**引擎、库存服务或机械运行时，只接收纯数据快照
  （`goal.ts:20-26`）。这是 P2-A 想复用的同一个模式。

**结论**：GameRead 只有一处，且是「纯 JSON 投影」；P2-A 不新增 read、不改 `mechanical` 投影。
订单状态机不接触工业数据层，P2-A 也不碰它。

### 3.7 测试与真实游戏验收入口

| 类型 | 位置 | 说明 |
|:--|:--|:--|
| 单元/集成测试 | `assets/__tests__/**/*.test.ts` | `vitest.config.ts` 的 `include` 只收这里；`pnpm test` = `forgeax project test` |
| 纯逻辑测试风格 | 例：`__tests__/production.test.ts` | 直接 import 纯模块，不启动引擎 |
| 共享 fixture | `__tests__/goal-e2e-fixtures.ts`、`goal-fixtures.ts`、`support-fixtures.ts` | 真实运行时 rig（不是 mock） |
| 真实游戏 Playthrough | `scripts/*.mjs`，由 `pnpm exec forgeax project play <script> --json` 驱动 | 真实浏览器 + 真实输入 + 读 GameRead/DOM |
| P1 订单验收入口 | `scripts/m20-first-order.mjs`（+ `m20-order-lib.mjs`、`m20-order-phase-a/b.mjs`） | 0/8 → 8/8 的完整八步 |
| M1.8 生产链回归 | `scripts/m18c-production.mjs` | 采矿→破碎→熔炼→锻压→扩建 |
| M1 历史回归 | `scripts/playthrough.mjs`、`m17b/m17c-*.mjs` | 基础建造/运动学/过载/闭环 |
| 类型检查 | `pnpm typecheck` → `tsc --noEmit` | `tsconfig.json` 的 `include` 覆盖 `assets/**/*.ts` |
| 工程检查 / 构建 | `forgeax project check --json` / `project build` | |
| 提交门禁 | 全局 git hook `C:/Users/Admin/.dsh/git-hooks/pre-commit` | **代码文件 > 20 KB 拒绝提交**（Markdown/资产不检查） |

**结论**：新数据层用纯逻辑单测即可完整覆盖；真实游戏回归复用现成 4 条脚本。
新建文件必须控制 < 20 KB，否则提交会被 hook 拒绝。

---

## 4. 关键调用链路（实际追踪，不是推测）

### 4.1 「一个物品怎么变成机器」

```
hotbar 选中 itemId
  → mechanical.pack.ts selectedItem() = partDefForItem(itemId)        (parts.ts:368)
  → 鼠标指向格 → placementFor() + validatePlacement()                 (build.ts:80)
  → place(def, placement)                                             (mechanical.pack.ts:295)
      allocateId → registry.add({id, def, placement})
                 → spatial.structures.register('mech:<id>', aabb)
                 → views.add(createPartView(...))
                 → inventory.remove(def.itemId, 1)      ← 物品在这里消耗
                 → registry.rebuildConnections() → commitTopology()
```

### 4.2 「一台机器怎么开始加工」

```
mechanical.partAt(cell, level)  ← 遍历 spatial.structures，按 'mech:<id>' 反查 registry
ProductionRuntime.sync(parts)   → 对 isProductionMachine(def) 建 MachineState          (:105)
每帧：runtime.ts
  state.sync → solvePower → omegaByPart
  production.setPowerReading(partId, {powered: |ω|>0, rate: |ω|/2π})
  production.tick(delta) → tickMachine(state, {def, powered, rate, delta})              (production.ts:162)
```

### 4.3 「产物怎么进库存」

```
tickMachine 完成周期 → state.outputItem/outputCount += out
  → pushMachineOutputs(): 本地 +X 相邻格是溜槽 → acceptItem(chute)
  → handoff(): 下一格是溜槽 → 传；是机器 → insertInput；末端无物 → options.addItem()
  → ProductionRuntimeOptions.addItem = (itemId,count) => inventory.add(itemId,count)   (runtime.ts:206)
```

**物品所有权在任何时刻只在三处之一**：机器缓冲 / 溜槽在途 / 玩家库存
（`production-runtime.ts:32-34` 注释）。这条规则 P2-A 不得破坏。

### 4.4 「动力怎么算到机器头上」

```
buildPowerTopology(parts, connections, revision)  只读结构                         (power.ts:128)
solvePower(topology, parts, enabledSourceIds)
  → 每台 machine 的 loadOf() = def.loadTorque，逆 BFS 累加到源
  → speedFactorByComponent = 1 - 需求/容量
  → omegaByPart = ratedOmega × factor × relativeOmega
    → rateOf(part) = |ω|/2π  → 加工速率
```

### 4.5 「订单怎么知道玩家真做出来了」

```
首帧：createGoalState(observation) 记录 produced 基线                          (goal.ts / runtime.ts:154)
每帧：assembleGoalObservation(真实快照) → evaluateGoal(state, observation)      (runtime.ts:101)
订单步骤 5/6/7：deltaOf(context, itemId) >= required，只认 production.produced 增量
```

---

## 5. 可复用 / 需最小调整 / 需重构

### 5.1 可直接复用（P2-A 不改一行）

| 模块 | 复用方式 |
|:--|:--|
| `items/items.ts` | `ItemId` / `ItemDefinition` 直接作为工业物品定义；`requireItemDefinition` 做完整性校验 |
| `inventory/inventory.ts` | 库存语义不变；工业数据层只读它的 `maxStack` 等定义 |
| `production/recipes.ts` | `Recipe` 类型直接用；P2-A 在其上建 `RecipeId` 索引，不改配方数据 |
| `production/production.ts` | `MachineState` / `tickMachine` 完全不动；P2-A 不复制加工状态 |
| `production/transport.ts` | 不动；P2-A 只定义新物流的**数据形状**，不实现 |
| `mechanical/parts.ts` | `PartId` / `MechanicalPartDef` / `PRODUCTION_MACHINE_IDS` 作为真源；工业层派生并校验 |
| `mechanical/ports.ts` | 现有 `Connection` 是动力连接，**原样保留**；物料连接另立类型，不共用名字 |
| `mechanical/power.ts` | 完全不动；工业层只引用 `loadTorque` 数值 |
| `mechanical/registry.ts` | 完全不动；`MachineEntity` 复用 `MechanicalPart.id` 身份空间 |
| `goal/*` | 完全不动；订单与工业数据层无耦合 |

### 5.2 需要最小调整

**P2-A 内：无。** 这是本阶段最重要的结论 —— 新增数据层是纯增量，旧系统零改动。

**后续阶段需要的最小调整（提前登记，本阶段不做）**：

| 阶段 | 调整点 | 原因 |
|:--|:--|:--|
| P2-B | `PartPortDef` / 端口派生需支持「物料端口」与「安装位」 | 现在端口只服务动力传动 |
| P2-B | 接口盒成为真实物品 → `items.ts` 增加 `ItemCategory` 值 + `icons.ts` | 当前 `category` 只有 resource/mechanical |
| P2-C | `ProductionRuntime.handoff` 增加「核心→核心」直连分支 | 现在只认溜槽/机器/末端进库存 |
| P2-D | `MACHINE_RECIPES` 从「按 PartId」改为「按加工工艺」 | 数据驱动加工的前提 |
| P2-D | `MechanicalPartDef` 的加工字段（`loadTorque/buffers`）迁到加工核心定义 | 现在混在机械零件表里 |
| P2-E | 科技树 / P2-F 市场 | 全新，本阶段不涉及 |

### 5.3 需要较大重构（本阶段发现即记录，不动手）

| 问题 | 影响 | 处置 |
|:--|:--|:--|
| `MechanicalPartDef` 同时承载几何/传动/动力/加工四类语义 | P2-D 要数据驱动加工时，容易改出「一个对象承担所有职责」，正是任务书 §5.3 警告的反模式 | P2-A 先把「加工核心」概念在数据层独立出来，P2-D 再把字段真源迁过去；**不现在重构** |
| 加工速率基准 60 RPM 是散落的隐式常量 | 未来引入不同额定转速的核心时容易算错 | P2-A 在数据模型里显式记录「`rate = 1` ⇒ 60 RPM」，并提供一致性测试；不引入新常量去替换现有实现 |
| 机器输入侧无固定面 | P2-B 的接口盒安装位会收紧现有玩法 | **需用户决策**（见 §7-Q1），不擅自决定 |

---

## 6. 现有系统 ↔ P2 总体设计的映射

任务书 §5.3 列的 8 个概念，逐条对照现有代码：

| 任务书概念 | 现有对应 | 缺口 | P2-A 要做的事 |
|:--|:--|:--|:--|
| **Item** 工业物品定义 | `ItemDefinition` + `ItemId`（`items.ts`） | 缺「工业组件」分类 | 复用；只做完整性校验，不扩分类 |
| **Recipe** 加工配方 | `Recipe` + `MACHINE_RECIPES`（`recipes.ts`） | 无全局 `RecipeId` 索引；按机器而非按工艺归属 | 建派生注册表 + 校验；工艺归属显式化 |
| **ProcessingCore** 加工核心定义 | 隐含在 `MechanicalPartDef`（crusher/smelter/forge） | 概念不存在，加工语义与几何/传动混在一起 | **新建**独立定义 + 稳定 ID |
| **PortModule** 接口盒定义 | **不存在** | 全新 | **新建**纯数据定义（不绑定物品、不实现安装） |
| **MachineEntity** 世界机器实体 | `MechanicalPart {id, def, placement}` | 概念不存在，与「机械零件」同义 | **新建**运行时类型 + 只读投影；身份复用 `partId` |
| **PortInstance** 已安装接口实例 | **不存在** | 全新 | **只定义类型**（安装逻辑归 P2-B） |
| **Connection** 真实物料连接 | 现有 `Connection` 是**动力**连接（`ports.ts`） | 物料连接不存在；**名字冲突** | **另立物料连接类型**，不复用 `Connection` 这个名字 |
| **Assembly** 组合机械管理 | **不存在** | 全新 | **只定义类型**（管理逻辑归 P2-D） |

映射结论：
- 8 个概念中 2 个（Item、Recipe）**已存在**，P2-A 只补索引与校验；
- 1 个（ProcessingCore）**已隐式存在但未独立**，P2-A 把它显式化；
- 3 个（PortModule、PortInstance、Assembly）**完全不存在**，P2-A 只建数据/类型，不建系统；
- 2 个（MachineEntity、Connection）**名字与现有概念冲突或同义**，P2-A 必须用**不同名字**区分，
  这是最容易出错、也最需要写进设计说明的一点。

---

## 7. 发现的问题与风险（不阻塞 P2-A）

| 编号 | 问题 | 影响 | 处置 |
|:--|:--|:--|:--|
| **Q1** | 机器**输入侧**当前没有固定面（任意相邻溜槽可投料 + 悬停 C 投料）；P2-B 引入固定安装位会收紧玩法 | 影响玩家建线方式 | **P2-A 只定义安装位数据结构与一套默认布局，标注为 P2-B 可调整；P2-B 开始前需用户确认「是否保留任意相邻投料」**。不阻塞本阶段 |
| **Q2** | `docs/ROADMAP.md` 写的顺序是「M2 体验完整度 → M3 工业深度」，与本次「M2.0-P2 工业系统」授权不一致 | 文档漂移 | 按用户本次授权执行；本阶段**不改 ROADMAP**，只在报告里登记，等用户定稿 |
| **Q3** | 输出方向在运行时是**固定 +X**（`pushMachineOutputs`） | 安装位若与它不一致，数据与行为会分叉 | P2-A 的默认安装位与 +X 一致，并加**一致性测试**锁死 |
| **Q4** | `ItemCategory` 只有 resource/mechanical | 接口盒成为物品时无法归类 | P2-B 处理；P2-A 的 `PortModuleDef.itemId` 暂为 `null` 并加测试防误接 |
| **Q5** | 加工速率基准 60 RPM 是隐式常量（散落在 `rpmOf` 默认值、`rateOf` 公式） | 引入不同额定转速核心时易错 | P2-A 显式记录 + 一致性测试；暂不重构 |
| **Q6** | 无存档：所有状态在内存 | 工业对象将来必须可序列化 | P2-A 保证新增的**静态定义全部冻结、运行时类型全部纯 JSON**，不引入不可序列化字段 |
| **Q7** | 现有 `Connection`（动力）与任务书 `Connection`（物料）同名 | 极易混用 | P2-A 物料连接命名区分（见设计说明），并在测试里断言两者字段不兼容 |
| **Q8** | 提交钩子限制单文件 20 KB | 数据层文件必须拆分 | P2-A 按职责拆成 6 个文件，均 < 20 KB |

---

## 8. 调查结论

1. **不需要为 P2-A 重构任何现有运行时模块。** 物品、配方、加工状态机、动力网络、运输、
   GameRead、订单系统都有清晰的边界，可以直接在上面加一层纯数据的工业对象定义。
2. **现有系统的「静态定义 / 运行时状态」分离已经是 P2 想要的形态**，尤其是
   `GoalObservation`（纯数据输入边界）和 `MechanicalSnapshot`（纯 JSON 读投影）两个先例，
   P2-A 的工业数据层沿用同一模式。
3. **最容易犯的错误是制造重复身份与重复状态**：
   - 机器实体不能另起 ID 空间（必须复用 `MechanicalPart.id`）；
   - 加工核心的额定动力不能另算（必须引用 `loadTorque`）；
   - 物料连接不能复用动力 `Connection` 的名字与语义。
   这三条已写进设计约束，并用测试守住。
4. **真正需要在后续阶段翻转的只有「配方按机器索引」→「配方按工艺索引」**（P2-D），
   P2-A 只把这个归属关系显式数据化，不改执行路径。
5. 有一个玩法层面的问题（Q1：机器输入是否固定面）需要在 **P2-B 开始前**由用户拍板；
   它不影响 P2-A 的数据模型，故本阶段不阻塞、只在报告中登记。

---

## 附：复核命令

```bash
git log --oneline -5
git status --short
pnpm test
pnpm typecheck
pnpm exec forgeax project check --json
```
