# M2.0-P2-A 工业对象数据模型设计说明

- 阶段：M2.0-P2-A（工业对象与数据定义）第 2 步
- 日期：2026-11-08
- 依据：[P2-A-INVESTIGATION.md](P2-A-INVESTIGATION.md)（现有工程架构调查）
- 代码：`assets/industrial/`（新增，本阶段唯一新增的代码目录）
- **本文件区分三件事**：已实现（有代码 + 有测试）、仅完成设计（有类型，无运行时）、尚未实现。

---

## 1. 设计目标与硬边界

### 1.1 目标

为「玩家自己制造、放置、安装、连接工业部件来构建机器与生产线」建立**稳定的数据地基**，
使 P2-B（接口盒安装）、P2-C（自由组合与内部物流）、P2-D（数据驱动加工与组合机械）
可以在不改动已经验收的 M1.8 / M2.0-P1 行为的前提下继续扩展。

P2-A 只做三件事：

1. 给 8 个工业概念**命名**并分配**稳定 ID**；
2. 明确**静态定义**与**运行时状态**的分界，以及每个数据的**归属**；
3. 用**完整性校验 + 测试**锁死这些定义与现有运行时数据的一致性。

### 1.2 硬边界（任务书 §六）

不实现：接口盒安装、核心拼接、核心间物流、传送带、组合机械结构模块、
动力网络规则修改、科技树、工业市场、新机器/新配方、HUD 修改、液体气体、物理模拟。

不改变：`items.ts` / `inventory.ts` / `recipes.ts` / `production.ts` / `transport.ts` /
`parts.ts` / `ports.ts` / `power.ts` / `registry.ts` / `runtime.ts` / `goal/*` 的**任何一行**。

> **这是本阶段最重要的设计约束**：新数据层是**纯增量**，方向是
> `assets/industrial/* → 现有模块`（单向只读接入），现有模块**永不 import** `assets/industrial/`。
> 因此 P2-A 在物理上不可能改变已验收行为。翻转时机见 §8。

---

## 2. 命名与稳定 ID 规范

### 2.1 稳定 ID 的定义

「稳定」= **一旦发布就不再修改**；新增对象只能追加新 ID。理由：将来存档、科技树、
市场数据都会引用这些 ID；改名等于存档失效。

### 2.2 格式

| 概念 | 类型 | 格式 | 示例 |
|:--|:--|:--|:--|
| 加工核心 | `CoreId` | `core.<name>` | `core.crusher` |
| 接口盒 | `PortModuleId` | `port.<name>` | `port.through` |
| 安装位 | `PortSlotId` | `slot.<coreName>.<in\|out>.<face>` | `slot.crusher.in.pz` |
| 配方 | `RecipeId` | 沿用 `Recipe.id`（kebab） | `crush-iron-ore` |
| 机器实体 | `MachineEntityId` | **复用** `MechanicalPart.id`（number） | `7` |
| 接口实例键 | `PortInstanceKey` | `<entityId>:<slotId>` | `7:slot.crusher.in.pz` |
| 物料连接 | `MaterialLinkId` | `link:<fromKey>>` + `<toKey>` | `link:7:slot.crusher.out.px>8:slot.smelter.in.pz` |
| 组合机械 | `AssemblyId` | `assembly:<n>` | `assembly:1` |

- `CoreId` / `PortModuleId` / `PortSlotId` 用 TypeScript **模板字面量类型**表达
  （`\`core.${string}\``），编译期就能挡住「把 PartId 当 CoreId 用」。
- `RecipeId` 沿用现有 `Recipe.id` 的字符串，**不改造、不迁移**（已验收的订单判定与测试依赖它）。
- 所有**定义类**新 ID（`CoreId` / `PortModuleId` / `PortSlotId` / `RecipeId`）必须匹配
  `/^[a-z][a-z0-9]*(?:[.\-][a-z0-9]+)+$/`（小写、至少两段）；`ids.ts` 提供
  `isStableId` / `assertStableId`，完整性校验会对每个定义 ID 跑一遍。
  运行时复合键（`20:slot.crusher.in.pz`、`link:…->…`、`assembly:1`）不是定义 ID，
  不要求匹配该格式；它们的格式由对应的构造函数保证。
  现有机械零件 `PartId`（`crusher`）是单段 snake_case，属于既有 ID 空间，不由本规则约束。

### 2.3 为什么给核心加 `core.` 前缀，而不是直接用 `crusher`

现有 `PartId` 里已经有 `'crusher'`。如果 `CoreId` 也用 `'crusher'`，两个概念在类型层
完全无法区分，P2-D 一定会有人把零件的字段写到核心上。加前缀后：

- `core.crusher` → 加工核心（工艺/速度/动力需求/安装位）
- `crusher` → 机械零件（几何/传动/可放置物品）

两者通过 `ProcessingCoreDef.corePartId` 显式连接，而不是靠同名"心照不宣"。

---

## 3. 八个对象：职责、ID、归属、静态/运行时

### 3.1 Item（工业物品定义）— **已存在，复用，本阶段不修改**

| 项 | 内容 |
|:--|:--|
| 现有定义 | `assets/items/items.ts`：`ItemDefinition { id, name, description, icon, maxStack, category }` |
| 稳定 ID | `ItemId`（14 个字面量，snake_case） |
| 数据归属 | 静态只读表 `DEFINITIONS`；运行时只有 `ItemStack {itemId, count}`（`inventory.ts`） |
| 静态/运行时 | 已经是分离的（物品定义 vs 堆叠数量） |
| P2-A 的动作 | **零改动**。只在完整性校验里确认配方引用的 `ItemId` 都存在 |

> 未实现/后续：`ItemCategory` 目前只有 `resource | mechanical`，接口盒成为真实物品时
> 需要新增分类（P2-B）。P2-A **不提前**加未使用的分类值。

### 3.2 Recipe（加工配方）— **已存在，P2-A 补索引与工艺归属**

| 项 | 内容 |
|:--|:--|
| 现有定义 | `assets/production/recipes.ts`：`Recipe { id, label, inputs[], outputs[], seconds }` |
| 稳定 ID | `RecipeId` = 现有 `recipe.id`（`crush-iron-ore` / `smelt-crushed-ore` / `forge-shaft` / `forge-vertical-drive` / `forge-chute`） |
| 输入输出表达 | `RecipeIngredient { itemId: ItemId, count: number }`；**数组**，类型层已支持多输入多输出 |
| 加工时间 | `seconds` = **额定速率（rate = 1.0，即 60 RPM）下的秒数**；实际时长 = `seconds / rate` |
| 数据归属 | 静态表 `MACHINE_RECIPES`；运行时 `MachineState` 只存 `recipeIndex` 与进度，不复制配方内容 |
| 静态/运行时 | 配方是静态的；运行时只存「当前第几条 + 进度 + 缓冲」 |
| P2-A 的动作 | 新增**派生只读视图** `RecipeDefinition { id, recipe, process, coreIds }`，并校验全局唯一 |

**新增的显式语义**：配方归属**加工工艺**（`process`），不再只归属某台机器。
当前实现是「一配方一机器」，所以由加工核心反推就能得到 `process`；
P2-D 会把它翻转为配方自带的字段（见 §8）。

> 未实现/后续：运行时仍只支持单输入单输出（`primaryInputOf` / `primaryOutputOf`）。
> 类型层不限制，运行时限制记录在此，P2-C/D 决定是否扩展。

### 3.3 ProcessingCore（加工核心定义）— **本阶段新建（已实现的数据）**

职责：一门**加工工艺的载体**——决定加工什么、多快、要多少动力、有哪些安装位。
**不含**：世界位置、实时进度、缓冲内容、已装接口、所属组合机械（那些属于运行时）。

```ts
interface ProcessingCoreDef {
  readonly id: CoreId;                    // "core.crusher"
  readonly label: string;                 // "破碎机"
  readonly corePartId: PartId;            // "crusher" —— 身份桥：核心本体当前就是一个零件
  readonly process: ProcessKind;          // "crushing" | "smelting" | "forging"
  readonly speedMultiplier: number;       // 1 = 按 recipe.seconds；>1 更快（P2-D 才参与计算）
  readonly ratedLoadTorque: number;       // N·m，额定动力需求（= MechanicalPartDef.loadTorque）
  readonly buffers: BufferSpec;           // 输入/输出缓冲容量（= partDef.buffers）
  readonly footprint: { w: number; d: number };
  readonly height: number;
  readonly recipeIds: readonly RecipeId[];
  readonly portSlots: readonly PortSlotDef[];
}
```

**关键设计：`ratedLoadTorque` / `buffers` / 几何 / `recipeIds` 全部从现有真源派生，
不手写第二份数值。** 理由：

- 任务书 §5.4「不得为了新架构引入重复的库存、生产或动力状态」；
- 现有 `solvePower` 已经把同一网络内所有机器的 `loadTorque` 相加，
  「组合机器动力需求 = 各核心之和」**本来就是现有行为**（`power.ts` 逆 BFS 后序累加）；
- 派生 + 完整性校验（`integrity.ts`）保证两边永远一致，且 P2-A 零行为变化。

唯一**新写**的是 `portSlots`（机器表面预留安装位），因为现有系统没有这个概念。

### 3.4 PortSlot（机器表面安装位）— P2-A 新建，属于 `ProcessingCoreDef` 的一部分

```ts
interface PortSlotDef {
  readonly id: PortSlotId;                // "slot.crusher.in.pz"
  readonly role: PortSlotRole;            // 'input' | 'output' —— 物料方向
  readonly face: Face;                    // 复用 parts.ts 的 Face（px/nx/py/ny/pz/nz）
  readonly localCell: { gx: number; gz: number };  // 与机械端口同一本地坐标约定
  readonly localY: number;                // 安装高度（米，相对层底）
  readonly capacity: number;              // 该位同一时刻可承载件数（派生自缓冲容量）
}
```

**为什么不是独立对象**：任务书 §5.3 的对象表里没有「机器模型」这一项，而安装位天然属于
「某个核心本体的表面」。所以 P2-A 把安装位作为 `ProcessingCoreDef` 的内嵌数据，
不新增第 9 个概念（避免为了抽象而抽象）。将来若出现「可换外壳的同一核心」，
再引入独立的 `MachineModelDef` 并把 `portSlots` 移过去即可，不影响 ID 规范。

**安装位 ID 的标识方式**（任务书要求）：`slot.<coreName>.<in|out>.<face>`。
可读、可 grep、与实体 id 拼接成运行时唯一键 `"7:slot.crusher.in.pz"`。

**与现有行为的强制一致（必须锁死）**：

| 约束 | 原因 | 校验 |
|:--|:--|:--|
| `output` 安装位必须在 `px` 面 | 运行时 `pushMachineOutputs()` 固定把产物推到本地 +X（`production-runtime.ts:236-254`） | `integrity.ts` 断言 |
| 安装位所在面**不得**与机械动力端口同面 | 三台机器的动力输入都在 `nx`（`MACHINE_INPUT_PORTS`），接口盒不能盖住传动轴 | `integrity.ts` 断言 |
| `localY` 使用 `PORT_HEIGHT`（0.5） | 与机械端口同一高度约定（`parts.ts:92`） | 默认值 + 测试 |

当前默认布局（**P2-B 可调整，属于数据改动，不影响模型**）：

| 核心 | 输入位 | 输出位 | 说明 |
|:--|:--|:--|:--|
| `core.crusher` | `slot.crusher.in.pz`（容量 4） | `slot.crusher.out.px`（容量 4） | `nx` 被动力输入占用，物料从 +Z 进 |
| `core.smelter` | `slot.smelter.in.pz`（容量 4） | `slot.smelter.out.px`（容量 4） | 同上 |
| `core.forge` | `slot.forge.in.pz`（容量 6） | `slot.forge.out.px`（容量 4） | forge 输入缓冲 6 |

> **待用户确认（P2-B 开始前，不阻塞 P2-A）**：现有机器**输入侧没有固定面**
> （任意相邻溜槽都能投料，玩家还能悬停按 C 直接投料）。一旦 P2-B 引入固定安装位，
> 就是对现有玩法的收紧。两个选项：① 保留「任意相邻溜槽仍可投料」，接口盒是增强；
> ② 只允许通过接口盒投料。P2-A 只提供数据和默认布局，**不替用户决定这条规则**。

### 3.5 PortModule（接口盒定义）— P2-A 新建（**数据定义，未接入游戏**）

```ts
type PortModuleKind = 'through' | 'splitter' | 'merger';
interface PortModuleDef {
  readonly id: PortModuleId;              // "port.through"
  readonly label: string;                 // "基础直通盒"
  readonly kind: PortModuleKind;
  readonly inputs: number;                // 输入端数量
  readonly outputs: number;               // 输出端数量
  readonly fitsSlotRoles: readonly PortSlotRole[];  // 可安装到哪种机器安装位
  readonly itemId: ItemId | null;         // P2-B 才绑定真实物品；P2-A 一律 null
}
```

| ID | 名称 | 输入 | 输出 | 可装位 | 说明 |
|:--|:--|--:|--:|:--|:--|
| `port.through` | 基础直通盒 | 1 | 1 | input, output | 一个输入一个输出 |
| `port.splitter` | 分流盒 | 1 | 2 | output | 把机器产物分到两条下游 |
| `port.merger` | 合流盒 | 2 | 1 | input | 把两路来料合入一台机器 |

**为什么 `itemId` 是 `null`**：任务书 §3.2 要求接口盒必须是**真实制造、放置、安装的物品**，
但那属于 P2-B。P2-A 如果现在就把接口盒注册成 `ItemId`，会连带改动
`ITEM_IDS` / 物品定义 / 前端图标 / 快捷栏（12 格已满）——这既超出 P2-A 范围，
也违反「不得修改玩家 HUD」。所以 P2-A 用 `null` **显式标记未接入**，
并用测试断言「所有接口盒的 `itemId` 都是 `null`」，防止有人提前接错。

`fitsSlotRoles` 的语义：
- 装在 `output` 位：机器 → 模块 → 下游（through / splitter）
- 装在 `input` 位：上游 → 模块 → 机器（through / merger）

### 3.6 MachineEntity（世界中的机器实体）— P2-A **仅类型 + 只读投影（已实现）**

```ts
type MachineEntityId = number;            // == MechanicalPart.id，同一身份空间
interface MachineEntity {
  readonly entityId: MachineEntityId;
  readonly coreId: CoreId;
  readonly placement: Placement;          // 复用 grid.ts
  readonly ports: readonly PortInstance[]; // 已安装接口（P2-A 恒为空数组）
  readonly assemblyId: AssemblyId | null;  // 所属组合机械（P2-A 恒为 null）
}
```

**三条硬规则**（P2-A 用测试锁死）：

1. **身份复用**：`entityId` 就是 `MechanicalPart.id`。绝不另建实体 ID 空间——
   否则 registry / SpatialIndex / 视图 / 存档会出现两套身份。
2. **不持有加工状态**：加工进度、缓冲内容仍在 `MachineState`（`production.ts`），
   由 `ProductionRuntime` 拥有。`MachineEntity` 只描述「这是一台什么机器、在哪、装了哪些接口」。
3. **不持有动力状态**：转速、扭矩、停转仍在 `power.ts` 的 `PowerSolution` 与
   `MechanicalSnapshot`。`MachineEntity` 不复制任何动力字段。

只读投影函数（已实现、已测试）：

```ts
machineEntityOf(part: MechanicalPart): MachineEntity | undefined
// 非加工机器（轴/齿轮/动力源/溜槽）→ undefined
// 加工机器 → { entityId: part.id, coreId, placement, ports: [], assemblyId: null }
```

### 3.7 PortInstance（机器实际安装的接口实例）— P2-A **仅类型**

```ts
interface PortInstance {
  readonly slotId: PortSlotId;    // 装在哪一个预留安装位
  readonly moduleId: PortModuleId; // 装的是哪种接口盒
}
// 运行时唯一键："<entityId>:<slotId>"，由 portInstanceKey() 生成
```

运行时归属：**将来由 P2-B 的机器实体状态持有**，P2-A 不建注册表、不建服务。
`runtime-model.ts` 只提供 `portInstanceKey()` 与 `validatePortInstance(core, instance)`
（校验安装位存在、模块可装在该位），供 P2-B 直接复用。

> 未实现：安装/拆卸、安装位占位、接口盒物品消耗 —— 全部 P2-B。

### 3.8 Connection（真实物料连接）— P2-A **仅类型**

> ⚠ **命名冲突警告**：`assets/mechanical/ports.ts` 里已有一个 `Connection`，
> 那是**机械动力连接**（`ratio` 是传动比）。两者语义完全不同，P2-A **不复用该名字**，
> 新类型叫 `MaterialLink`。

```ts
interface PortEndpoint {
  readonly entityId: MachineEntityId;
  readonly slotId: PortSlotId;
}
type MaterialLinkId = `link:${string}`;
interface MaterialLink {
  readonly id: MaterialLinkId;
  readonly from: PortEndpoint;    // 必须是 output 位
  readonly to: PortEndpoint;      // 必须是 input 位
}
```

`runtime-model.ts` 提供 `materialLinkBetween(from, to)`（生成规范 ID）与
`validateMaterialLink(link, fromCore, toCore)`（校验方向、角色、非自连）。

> 未实现：连接的建立/拆除、实际传递物料、堵塞与背压 —— P2-C。
> P2-A 也**不**做「连接合法性预览」「可视化线缆」。

### 3.9 Assembly（未来组合机械的管理对象）— P2-A **仅类型**

```ts
type AssemblyId = `assembly:${string}`;
interface Assembly {
  readonly id: AssemblyId;
  readonly memberIds: readonly MachineEntityId[];  // 成员核心，去重
}
```

设计约束（任务书 §3.4，长期方向）：

- 组合机械**不合并**成员的核心 ID；每个成员保留自己的 `entityId`、加工状态、接口、
  缓冲、动力需求（这些本来就在各自的对象里，`Assembly` 只存成员关系）。
- 组合机械只负责**成员关系、相对位置、整体操作**。
- 拆卸连接模块后应恢复为独立核心，而不是销毁重建——所以 `Assembly` 只是
  `memberIds` 的集合，成员的生命周期与它**无关**。

P2-A 只定义类型 + `createAssembly()`（校验成员唯一、非空）。
**没有任何运行时管理逻辑**（P2-D）。

---

## 4. 对象关系图

```
┌─ 静态定义（全部冻结 Object.freeze()，只读、无运行时状态） ────────────────┐
│                                                                        │
│  ItemDefinition  ◄── ItemId                                            │
│      ▲ (1:1, partDefForItem)                                          │
│      │                                                                │
│  MechanicalPartDef ◄── PartId          [已存在: assets/mechanical]      │
│      │  ├ 几何 w/d/height ───────────────┐                             │
│      │  ├ 传动 teeth/maxTorque/ratedRpm  │                             │
│      │  ├ 动力 loadTorque ───────────────┤  派生 + 校验一致             │
│      │  └ 加工 buffers ──────────────────┤                             │
│      ▼                                   ▼                             │
│  ProcessingCoreDef ◄── CoreId          [新增: assets/industrial]        │
│      ├ corePartId ──► PartId  (身份桥: 核心本体 = 可放置零件)            │
│      ├ process: ProcessKind                                            │
│      ├ speedMultiplier / ratedLoadTorque / buffers / footprint/height   │
│      ├ recipeIds ──┐                                                   │
│      └ portSlots ──┼──► PortSlotDef ◄── PortSlotId                     │
│                     │      role input|output, face, localCell, localY   │
│                     │                                                  │
│  Recipe ◄── RecipeId ──► RecipeDefinition (派生视图: process, coreIds)  │
│                                                                        │
│  PortModuleDef ◄── PortModuleId                                        │
│      kind through|splitter|merger / inputs / outputs / fitsSlotRoles    │
│      itemId = null (P2-B 才绑物品)                                      │
└────────────────────────────────────────────────────────────────────────┘
                              │ 单向只读引用（现有模块不反向依赖）
                              ▼
┌─ 运行时状态（纯 JSON、不可冻结、可序列化） ─────────────────────────────┐
│                                                                        │
│  MechanicalPart { id, def, placement }        [已存在: registry 拥有]    │
│      │ 投影（共享同一 id）                                              │
│      ▼                                                                 │
│  MachineEntity { entityId, coreId, placement, ports[], assemblyId }     │
│      │                                                                 │
│      ├──► PortInstance { slotId, moduleId }   (P2-B 实现安装)           │
│      ├──► MaterialLink { id, from{}, to{} }   (P2-C 实现传递)           │
│      └──► Assembly     { id, memberIds[] }    (P2-D 实现管理)           │
│                                                                        │
│  ⚠ 以下状态**不**进入 MachineEntity，仍归现有系统所有：                    │
│     · 加工进度/缓冲  → MachineState            (production.ts)          │
│     · 转速/扭矩/停转 → PowerSolution           (power.ts)               │
│     · 库存数量       → InventoryState          (inventory.ts)           │
│     · 物品在途       → ChuteState / 机器缓冲    (transport.ts)           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. 静态定义 vs 运行时状态

| 判据 | 静态定义 | 运行时状态 |
|:--|:--|:--|
| 何时产生 | 编译期常量，模块加载即确定 | 玩家操作/每帧推进产生 |
| 是否可变 | `Object.freeze()` 深度冻结 | 可变 |
| 能否存盘 | 不存盘，从代码重建 | 必须可序列化为纯 JSON |
| 归属 | `assets/industrial/*` 静态表 | `MechanicalPart` / `MachineEntity` / `MachineState` 等 |
| 示例 | `core.crusher`、`slot.crusher.in.pz`、`Recipe.seconds` | `entityId=7`、`progress=0.42`、`ports=[…]` |

**本阶段用测试守住的三条混用禁令**：

1. 静态表里**不得**出现运行时字段（`entityId` / `partId`(number) / `progress` /
   `ports` / `assemblyId`）——`integrity.ts` + 测试检查。
2. 运行时对象**不得**指向可变的静态表内部数组——`machineEntityOf` 每次返回新对象，
   测试断言修改返回值不影响定义。
3. 定义对象**不可被改写**——测试断言 `Object.isFrozen()` 且赋值会抛错（ESM 严格模式）。

---

## 6. 数据归属表

| 数据 | 归属 | 谁可写 | 谁可读 |
|:--|:--|:--|:--|
| 物品定义 | `items.ts` `DEFINITIONS` | 无（常量） | 全部 |
| 配方定义 | `recipes.ts` `MACHINE_RECIPES` | 无（常量） | 全部 |
| 加工核心定义 | `industrial/processing-core.ts` `PROCESSING_CORES` | 无（冻结） | 全部 |
| 接口盒定义 | `industrial/port-module.ts` `PORT_MODULES` | 无（冻结） | 全部 |
| 工业目录（索引） | `industrial/catalog.ts` `INDUSTRIAL_CATALOG` | 无（冻结） | 全部 |
| 机械零件实例 | `MechanicalRegistry` | 仅 `mechanical.pack.ts` 事务 | 全部（只读 `parts()`） |
| 机器实体视图 | 派生（`machineEntityOf`） | 不存储 | 派生产生 |
| 加工状态 | `ProductionRuntime` | 仅 `ProductionRuntime` | 快照 |
| 动力状态 | `MechanicalRuntimeState` / `power.ts` | 仅 runtime | 快照 |
| 库存 | `InventoryService` | 仅服务方法 | 服务方法 |
| 接口实例 / 物料连接 / 组合机械 | **尚未有归属**（P2-B/C/D） | — | — |

---

## 7. 输入/输出、时间、动力的表达方式（汇总）

| 语义 | 表达 | 位置 |
|:--|:--|:--|
| 配方输入 | `RecipeIngredient { itemId: ItemId, count: number }[]` | `recipes.ts`（已存在） |
| 配方输出 | 同上 | `recipes.ts`（已存在） |
| 加工时间 | `Recipe.seconds`（rate = 1.0 时）；实际 = `seconds / rate` | `recipes.ts` + `production.ts:215` |
| 核心速度 | `ProcessingCoreDef.speedMultiplier`（新；P2-D 才参与计算） | `industrial/processing-core.ts` |
| 额定动力需求 | `ProcessingCoreDef.ratedLoadTorque`（= `MechanicalPartDef.loadTorque`） | 派生并校验 |
| 组合设备动力需求 | 现有 `solvePower` 对同网络机器 `loadTorque` 求和 | `power.ts:337-352`（**不改**） |
| 缓冲容量 | `ProcessingCoreDef.buffers`（= `partDef.buffers`） | 派生并校验 |
| 安装位物料方向 | `PortSlotDef.role: 'input' \| 'output'` | 新增 |
| 接口盒流量 | `PortModuleDef.inputs / outputs`（端口数量） | 新增 |

---

## 8. 与现有系统的接入方式

### 8.1 本阶段：单向只读接入（零行为变化）

```
assets/industrial/*  ──只读 import──►  items.ts / recipes.ts / parts.ts / production.ts / grid.ts
assets/industrial/*  ◄──永不 import──  以上任何模块
```

- 新层读取现有真源（物品定义、配方、零件定义、缓冲容量、几何），派生自己的视图；
- 现有模块**完全不认识**新层，因此 P2-A 不可能改变已验收行为；
- 没有新增 Cordis 插件、没有新增 GameRead、没有新增服务、没有改 `mechanical` 投影；
- 校验在**测试**里跑（`pnpm test`），不在引擎启动路径上跑。

### 8.2 后续翻转点（登记，本阶段不做）

| 阶段 | 翻转内容 | 为什么现在不翻 |
|:--|:--|:--|
| P2-B | 接口盒成为真实物品；`PortInstance` 有真实归属 | 需要先定物品/HUD 方案（快捷栏已满） |
| P2-C | `ProductionRuntime.handoff` 增加「核心↔核心」直连分支 | 需要先有安装位与接口实例 |
| P2-D | `MACHINE_RECIPES` 从「按 PartId」改为「按 ProcessKind」；`ProcessingCoreDef` 成为加工字段真源；`MechanicalPartDef` 只留几何/传动 | 这是唯一会改现有运行时的翻转，必须单独授权 |
| P2-D | `Assembly` 真实管理成员关系 | 需要多核心拼接先成立 |
| P2-E/F | 科技树 / 工业市场引用 `CoreId` / `RecipeId` / `ItemId` | 后续阶段 |

---

## 9. 扩展方式（设计兼容性论证）

| 未来需求 | 现有模型如何容纳 | 需要改什么 |
|:--|:--|:--|
| 多输入多输出的加工核心 | `Recipe` 已是数组；`ProcessingCoreDef.buffers` 可扩成按槽；`portSlots` 可加多个 slot | P2-C/D 改运行时缓冲模型 |
| 一个核心接多个接口盒 | `portSlots` 是数组；`PortInstance[]` 是数组 | 无（P2-B 直接实现） |
| 多个核心组合成组合机械 | 每个核心保留自己的 `entityId` / 状态；`Assembly.memberIds` 只存关系 | P2-D 加管理逻辑，不改身份模型 |
| 组合机械整体操作 | `Assembly` 聚合成员 | P2-D |
| 不同动力需求的核心 | `ratedLoadTorque` 每核心独立；现有 `solvePower` 求和 | 无 |
| 不同处理速度的核心 | `speedMultiplier` 已预留 | P2-D 接入计算 |
| 科技树解锁核心/接口盒 | 科技节点引用 `CoreId` / `PortModuleId` | P2-E |
| 存档 | 静态定义不进存档；运行时类型全是纯 JSON | 无（P2-A 已保证） |
| 换外壳的同一核心 | 届时引入 `MachineModelDef`，把 `portSlots` 移过去 | 一次数据迁移，ID 规范不变 |

---

## 10. P2-A 实际实施范围（与交付报告一致）

| 内容 | 状态 |
|:--|:--|
| 8 个概念的职责/ID/归属/静态运行时边界 | **已实现**（`assets/industrial/ids.ts` + 各定义模块 + 本文） |
| 加工核心定义（3 个，派生） | **已实现并测试** |
| 安装位定义（每核心 1 进 1 出，默认布局） | **已实现并测试** |
| 接口盒定义（3 种，纯数据，未接入） | **已实现并测试** |
| 配方全局索引 + 工艺归属 | **已实现并测试** |
| 工业目录 + 完整性校验 | **已实现并测试** |
| `MachineEntity` 投影 + 静态/运行时分离 | **已实现并测试** |
| `PortInstance` / `MaterialLink` / `Assembly` | **仅类型 + 校验函数**，无运行时实现 |
| 接口盒安装 / 核心拼接 / 内部物流 / 传送带 | **未实现**（P2-B/C） |
| 组合机械管理 / 数据驱动加工 | **未实现**（P2-D） |
| 科技树 / 工业市场 / 新机器 / 新配方 / HUD | **未实现**（后续阶段） |

---

## 11. 被否方案（为什么不这么做）

| 方案 | 否决理由 |
|:--|:--|
| 现在就重写 `MechanicalPartDef`，把加工字段迁到 `ProcessingCoreDef` | 会改现有机器生产行为，违反 §5.4；且 P2-A 授权不含数据驱动加工 |
| 让 `CoreId` 直接等于 `PartId`（都用 `"crusher"`） | 两个概念在类型层无法区分，正是任务书 §5.3 警告的「混成一个对象」 |
| 把安装位做成独立顶级对象/系统 | 任务书对象表没有这一项；且 P2-A 不应提前建空壳系统 |
| 接口盒现在就注册成真实物品 | 连带改动物品表/图标/快捷栏/HUD，超出 P2-A，且违反禁止事项 §10 |
| 物料连接复用 `ports.ts` 的 `Connection` | 语义冲突（传动比 vs 物料流向），必然误用 |
| `MachineEntity` 另起全局实体 ID 空间 | 产生两套身份，registry/SpatialIndex/存档都要维护映射，违反「不得引入重复状态」 |
| `MachineEntity` 直接持有 `MachineState` 引用 | 重复状态；加工状态必须只有一个所有者（`ProductionRuntime`） |
| 新增第二个 GameRead 暴露工业数据 | 现有代码注释明确「多 read 会让历史 playthrough 抛 state-unavailable」 |
