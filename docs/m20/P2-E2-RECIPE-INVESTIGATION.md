# M2.0-P2-E2 配方输入机制调查报告（飞轮偏差 + 多输入最小扩展）

- 工作包：M2.0-P2-E2 · B1（配方与飞轮偏差调查）；基线 `84bb8f6`。
- 结论：**本轮不实现多输入**。现状确实不支持多材料配方；本报告给证据、最小扩展方案与影响评估，是否申请授权由 Lead 决定。

---

## 1. 结论摘要

1. **12 铁锭版飞轮与「10 铁锭 + 2×24T 齿轮」版在材料核算上等价，但工艺流程上不等价，不能视为同一配方。**
   - 材料：`forge-gear-24` 为 1 铁锭 → 1 个 24T 齿轮，2 个齿轮 = 2 铁锭，10 + 2 = 12，与 `forge-flywheel` 的 12 铁锭完全等值。
   - 工艺：原设计要经过齿轮中间品——额外 2 次齿轮锻压周期（各 5 s）+ 齿轮缓冲/运输/接口盒占用；现实现直接消耗铁锭，**跳过了齿轮中间品与额外加工时间**。因此不能把 12 铁锭版当作原设计的等价实现。
2. 现状**无法表达**原设计：机器输入缓冲、接口盒缓冲、多条物料连接传递三个环节都是「单物料类型」模型（见 §2）。
3. 若要把原设计做对，最小方案是**「每个输入安装位一条单类型输入槽」**（§3 方案 B）：给锻压机增加第二个输入安装位，机器输入缓冲按槽位拆分；接口盒与 MaterialLink 语义保持不变。预估 5 个源文件 + 1 条数据 + 8–12 个测试文件，约 250–350 行（含测试）。
4. E0 §7 配方表与现有 `MACHINE_RECIPES` **逐条一致**（§5），没有设计外配方；`recipeId` 稳定，数组下标只是存档兼容字段。
5. 方案 B 触及工业目录数据（新增安装位）、只读投影（多槽输入）与存档字段，**属于设计变更**；按任务书「不得未经确认改变原设计或扩大配方系统」，本轮只交方案不实施。

---

## 2. 现状与代码证据（为什么现在确实不支持）

### 2.1 配方数据本身支持多输入，但运行时只取第一条

- `Recipe.inputs` 是数组（`assets/production/recipes.ts:19-29`），数据结构上允许多材料；但派生函数明确只取第一个：
  - `primaryInputOf = recipe.inputs[0]`（`recipes.ts:244-246`）
  - `primaryOutputOf = recipe.outputs[0]`（`recipes.ts:248-251`）
- `tickMachine` 只用 `inSpec / outSpec` 两个单值（`assets/production/production.ts:244-249`）。
- 飞轮配方因此被简化为 12 铁锭（`recipes.ts:179-185`），注释已记录该决策（`recipes.ts:157-162`，E1 报告 §9 K4）。

### 2.2 机器输入缓冲是单槽

`MachineState`（`production.ts:33-51`）只有：

| 字段 | 行号 | 语义 |
|:--|:-:|:--|
| `inputItem: ItemId \| null` | 41 | 当前缓冲里**唯一**的原料类型 |
| `inputCount: number` | 42 | 该类型的件数（容量 4/6，`DEFAULT_INPUT_CAPACITY` `production.ts:53`，`def.buffers?.input` `production.ts:56-58`） |

- `insertInput` 只接受 `acceptedInputOf`（= 当前配方 `inputs[0]`）这一种物品，且不同物品拒绝混装：`production.ts:158-175`（拒绝条件在 167-169 行）。
- 周期开始时整笔扣料后清空/递减该单槽：`production.ts:260-274`。因此**同一时刻机器缓冲里不可能有两种材料**。

### 2.3 接口盒（输入位）也是单物料类型

- `InstalledPort.itemId: ItemId | null` + `count`（`assets/industrial/port-runtime.ts:22-32`）。
- `accept()` 拒收不同物品：`port-runtime.ts:188-196`（判断 `port.count > 0 && port.itemId !== itemId` 在 191 行）。
- `drain()` 只把盒里那一种物料推进机器：`port-runtime.ts:204-215`；服务契约 `PortService.drain(partId, tryInsert)` 只传 `itemId`（`assets/industrial/ports.ts:23`，唯一实现 `assets/industrial/port-flow.ts:51`）。
- 关键限制：每台加工核心**只有一个输入安装位**——`PORT_SLOT_LAYOUT_BY_PART` 中 crusher/smelter/forge 都是「1 输入(nz) + 1 输出(px)」（`assets/industrial/processing-core.ts:120-141`），安装位容量从机器缓冲派生（`processing-core.ts:144-153`）。因此「两种材料各用一个输入盒」这条路当前也不存在。

### 2.4 MaterialLink 传递保持单类型

- `MaterialLinkRuntime.moveOne()` 要求目标盒为空或与源同类型：`assets/industrial/link-runtime.ts:115-134`（类型检查 125 行）。
- 连接只做「源接口缓冲 → 目标接口缓冲」1 件原子转移，**连接本身不存料**（`link-runtime.ts:10-17,277-330`），这一条是好性质，扩展时应保留。

### 2.5 上游读取也假设单槽

- 机器快照只有 `inputItem/inputCount` 两个单值（`production-runtime.ts:92-107`），目标观测同步（`goal/observation.ts:24-39`）；`ProductionRuntime.tick()` 的 drain 顺序见 `production-runtime.ts:253-288`。

### 2.6 已发现的真实缺陷

「整笔扣料」要求 `inputCapacity >= inputs[0].count`。修复前锻压机输入缓冲为 6（`assets/mechanical/parts.ts:296`），
而 `forge-smelter`=7、`forge-processing-core`=8、`forge-flywheel`=12，这三条重配方**永远无法开工**：

- 实测（tsx 直调 `insertInput/tickMachine`）：投 8 锭只收 6，40 帧后 `block=no-input`、`progress=0`、产出 0。
- 后果：T3.2 要交 crusher+smelter+forge（`tech/nodes-stage3.ts:37-42`），三台都造不出 → `line-diagnostics` 永不可解锁（E1「T3.2 已解锁待消费」从未真跑通）。
- 修复（Lead `4a03621`）：forge input 6→12；新增 `recipe-capacity.test.ts` 契约测试；本包补 12 铁锭飞轮真实加工回归。

**结论：不扩展是无法表达「10 铁锭 + 2 齿轮24」的。** 这不是配方表缺一条数据的问题。

---

## 3. 最小扩展方案（本轮不实现）

### 3.1 两个候选与取舍

| 方案 | 做法 | 改动面 | 主要风险 |
|:--|:--|:--|:--|
| **A：多类型单缓冲** | `MachineState.inputs[]`；接口盒缓冲改 Map；连接去掉类型约束 | 生产+接口盒+连接三层 | 连接不再校验类型 → **错料被送进下游盒并卡住**，需再加「目标配方是否接收」过滤，反而更复杂 |
| **B：每输入位单类型槽（推荐）** | 锻压机加第二个输入安装位；机器输入缓冲按槽拆分；**接口盒/MaterialLink 语义不变** | 状态机+安装位数据+读投影 | 玩家要装两个输入盒、接两条上游链路（原设计本就要求两条材料来源） |

方案 B 更小、且保留现有三条不变量（单类型盒、类型不匹配不传递、连接不存料）。以下按 B 展开。

### 3.2 状态字段（`assets/production/production.ts`）

```ts
export interface MachineInputStack {
  itemId: ItemId | null;
  count: number; // 0..slot.capacity（输入位容量，锻压机 6）
}

export interface MachineState {
  // 新增：按输入安装位索引（0 = nz，1 = pz）。旧单输入配方只用 [0]。
  inputSlots: MachineInputStack[];
  // 兼容保留（只读派生）：第一个非空槽 / 或 [0] 槽，供旧读投影与旧测试使用。
  inputItem: ItemId | null;
  inputCount: number;
  // 其余字段不变：recipeId / recipeIndex / progress / outputItem / outputCount / running / block / producedTotal
}
```

- **槽位数量**：由 `def.buffers.inputSlots`（新增可选字段，缺省 1）或安装位数量决定；锻压机 = 2，破碎机/熔炼炉 = 1。
- **容量**：沿用每个输入安装位的 `capacity = inputCapacity(def)`（`processing-core.ts:146`），不新增第二套容量概念。
- **兼容字段**：`inputItem/inputCount` 继续由 `inputSlots` 派生（旧配方只有槽 0），避免一次性改爆 30+ 处读取点；后续再逐步迁移。

### 3.3 四个函数的最小改动

| 函数 | 现状 | 改动 |
|:--|:--|:--|
| `insertInput`（158-175） | 只接受 `inputs[0].itemId`，单槽混装拒绝 | 增加可选 `slotIndex`：手动投料按「该物品在 `recipe.inputs` 里的下标」路由；槽容量独立；同槽不同物品仍拒绝 |
| `tickMachine`（225-297） | 检查/扣除 `inSpec` 单值 | 改为遍历 `recipe.inputs` 与对应槽：全部满足才开工，整笔扣除全部槽；输出逻辑不变（仍取 `outputs[0]`，本阶段不做副产物） |
| `flushMachine`（300-316） | 返回 1 条输入 + 1 条输出 | 返回每个非空输入槽 + 输出槽（拆机不丢料的不变量保持） |
| `snapshot`（`production-runtime.ts:399-437`） | `inputItem/inputCount` | **追加** `inputs: readonly {itemId,count}[]`（只读投影）；旧字段保留（= 第一个非空槽），不新增 GameRead |

### 3.4 接口盒与 MaterialLink 语义（保持不变）

- 输入盒仍是**单类型**缓冲（`port-runtime.ts:188-215` 不改语义）；玩家给锻压机装两个输入盒即可，各接一条上游链路。
- 需要改的只有 `drain` 的调用约定：把「盒装在哪个安装位」传给机器，让机器知道推进到哪个槽：
  - `PortService.drain(partId, tryInsert(slotId, itemId))`（`ports.ts:23`、`port-flow.ts:51`）
  - `PortRuntime.drain` 遍历 `inputBoxesOf(partId)` 时带上 `port.slot.id`（`port-runtime.ts:204-215`）
- `MaterialLink` 完全不变：每条连接仍单类型、类型不匹配不传递（`link-runtime.ts:125,278-330`）；分流/合流轮询不变。
- 安装 UX：`freeInputSlotOf` 已经按「第一个空闲输入位」选择（`port-runtime.ts:88-91`），第二次按 T 会自动装到第二个输入位，不需要新交互。

### 3.5 旧配方兼容

- 旧配方（`inputs.length === 1`）只用槽 0，`insertInput` 默认槽 0，行为与现在逐位一致，`production.test.ts` 既有断言应全部保持。
- `recipeId` 是权威身份，多输入只改 `forge-flywheel` 的 inputs、不改 id，历史存档不会漂移；不新增任何设计外配方。

### 3.6 存档字段（E3/P0 对接）

```ts
// v2（多输入）序列化单元
{ recipeId, progress, producedTotal, outputItem, outputCount,
  inputs: [{ itemId, count }, ...] } // 长度 <= 输入位数量
```

- v1 → v2 迁移：`inputItem/inputCount` → `inputs: [{itemId,count}]`，其余字段同名。
- 当前项目还没有存档落盘（E1 报告 K3），所以本次只需在 `MachineState` 变化时同步 E3 存档服务的字段形状，**没有线上存档要迁移**。

### 3.7 受影响测试清单与改动量估算

| 文件 | 影响 |
|:--|:--|
| `production.test.ts` / `tech-recipe-order.test.ts` | 手工构造 `inputItem/inputCount`；兼容字段保留后基本不动，仅补「槽 0」断言 |
| `goal-fixtures.ts` / `goal-e2e-*` | `GoalMachineObservation` 单值输入 → 多槽 |
| `port-runtime.test.ts` / `port-flow.test.ts` / `link-flow.test.ts` | `drain` 签名（slotId） |
| `production-batch.test.ts` / `diagnostics.test.ts`（本次新增） | 补 `inputs` 断言 / 多槽条件展示 |
| `mechanical-runtime` 快照类测试 | 快照追加 `inputs` |

估算：**源文件 5 个**（`production.ts`、`production-runtime.ts`、`processing-core.ts` 安装位数据、`ports.ts` + `port-flow.ts` + `port.pack.ts` 的 drain 传参、`recipes.ts` 飞轮配方改回原设计）+ **1 条安装位数据** + **8–12 个测试文件**，约 250–350 行改动（含测试）。方案 A 预估 12–15 个文件、450–600 行，且引入错料风险。

---

## 4. 风险

1. **设计变更需授权**：新增锻压机第二输入安装位改变了工业目录数据；飞轮配方改回 10+2×24T 是把 E1 的简化还原为 E0 原设计。
2. **UI/协议消费方**：诊断/前端服务视图按单输入字段读数；多输入需只读投影追加 `inputs` 数组（增量字段、不改旧字段名），E2 UI 与 E3 终局面板要同步展示。
3. **玩家操作成本**：飞轮要给锻压机装 2 个输入盒 + 2 条上游链路，多一步、拉长 T2.4 时长，需 E3 数值平衡复核。
4. **不做多输入的代价**：飞轮与 E0 §4.9 不一致，玩家体验不到「齿轮 → 飞轮」材料链；作为已知偏差（K4）在验收文档诚实保留。
5. **不扩大配方系统**：仍只支持「多输入、单输出主产物」，不做副产物/多输出/替代配方（留 M3）。

---

## 5. E0 §7 配方表核对（齐全性 / recipeId 稳定性 / 设计外配方）

对照 `docs/m20/P2-E0-DEMO-PROGRESSION.md:280-307` 与 `assets/production/recipes.ts:31-236`：

| E0 §7 设计项 | E0 行 | 现状 recipeId | 定义 | 入/出 | 秒 | 结论 |
|:--|:-:|:--|:--|:--|:-:|:--|
| 破碎铁矿 | 284 | `crush-iron-ore` | `recipes.ts:31-37` | 1→1 | 4 | ✅ |
| 熔炼铁锭 | 287 | `smelt-crushed-ore` | `recipes.ts:39-45` | 1→1 | 6 | ✅ |
| 锻压单件 11 条（轴/立带/溜槽/基础盒/输出盒/分流盒/合流盒/三核心/结构框架） | 291-301 | `forge-shaft` … `forge-structure-frame` | `recipes.ts:48-155` | 2→1 … 8→1 | 4-10 | ✅ 逐条一致 |
| 批量 3 条 | 302 / 339 | `forge-batch-shaft` / `-interface-box` / `-structure-frame` | `recipes.ts:188-210` | 4→2 / 6→3 / 6→2 | 7/9/8 | ✅ |
| 齿轮 12T | 303 | `forge-gear-12` | `recipes.ts:163-169` | 1→2 | 4 | ✅ |
| 齿轮 24T | 303 | `forge-gear-24` | `recipes.ts:171-177` | 1→1 | 5 | ✅ |
| 飞轮 | 304 | `forge-flywheel` | `recipes.ts:179-185` | **12→1**（设计 10+2×24T） | 12 | ⚠️ 材料简化（K4） |

- **齐全性**：E0 §7 列出的 17 条锻压配方 = 现有 `MACHINE_RECIPES.forge` 的 17 条（`recipes.ts:216-235`），一条不缺、一条不多；破碎/熔炼各 1 条（`recipes.ts:214-215`），与设计一致。
- **设计外配方**：无。现有 19 条配方全部来自 E0 §7 / 科技树设计 §4；未发现任何「为测试临时加的配方」。
- **recipeId 稳定性**：身份是 `Recipe.id` 字符串（`recipes.ts:19-22`），不是数组下标；`MachineState.recipeId` 才是权威（`production.ts:35-40`），`recipeIndex` 只是旧断言/旧快照的兼容字段（`production.ts:36-38`）。新增配方一律追加在列表末尾（`recipes.ts:157-162, 187-210`、`production.test.ts:161-183` 的契约测试守护），历史下标不变。
- **解锁关系**：齿轮（T1.1 `tech:gear-manufacture`）、飞轮（T2.4）、批量 3 条（T3.1 `tech:batch-processing`）在 `assets/tech/nodes-stage3.ts:23-27` 等节点中登记；未解锁不可加工（`production.ts` 门控，见 E1 报告 §5）。
- **结论**：除飞轮材料简化外，配方表与 E0 设计一致；**不建议再新增任何配方**，缺口只有「多输入能力」这一项。

---

## 6. 建议（交 Lead 决策）

1. **本轮（E2）保持 12 铁锭简化版**，不扩大配方系统；把本报告 §3 作为授权申请材料。
2. 若 Lead/用户同意实现原设计，建议按 **方案 B** 单独开一个小工作包（不含副产物/多输出），顺序：安装位数据 → MachineState 多槽 → drain 传参 → 读投影追加 `inputs` → 飞轮配方改回 10+2×24T → 测试与真实游戏验收。
3. 在验收文档/Game UI 中把 K4 作为**已知偏差**保留，明确「材料等价、工艺不等价」，不得表述为「与原设计一致」。

---

## 7. 相关证据

- `assets/__tests__/production-batch.test.ts`：3 条批量配方走真实 `tickMachine/ProductionRuntime` 的契约、守恒与重配方回归（18 例）。
- 本报告只做调查与方案设计，未修改任何配方/运行时。
