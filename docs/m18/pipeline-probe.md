# M1.8 生产线接入点调查报告（pipeline-probe）

> 调查方式：**严格只读**（读文件 / grep / 只读命令），未修改任何游戏代码。
> 调查范围：物品、库存、UI 桥、GameRead 投影、读数/视觉、采集与资源、存档、机械键位。
> 约定：`文件:行号` 均为当前 HEAD（`076eb20`）实测；**【事实】**= 代码/文档已经如此，**【建议】**= 本次调查给出的方案。
> 结论先行，细节在后文各节；第 9 节是可直接照做的接入清单，第 10 节是硬规则冲突与风险。

---

## 0. 结论先行（TL;DR）

1. **新增一个物品要改的地方比想象中多但不难**：核心是 `assets/items/items.ts` 的三处（`ItemId` 联合、`ITEM_IDS`、定义表），其余（库存/背包/UI 桥）**自动兼容**；真正的"同步清单"是 **2 个测试文件的长度断言** 与 **前端 `icons.ts` 的图标分支**。若是机械零件物品，还要连带改 `parts.ts` 的 5 处（`PartKind`/`PartId`/`MECHANICAL_PART_DEFS`/`MECHANICAL_PART_IDS`/`PROTOTYPE_KIT`）。证据见 §1。
2. **库存语义对机器消耗友好**：`inventoryRemove` 是**单物品整笔事务**（不足返回 `false` 且不改变状态，`inventory.ts:96-115`）；但**没有多物品事务**——多输入配方必须自己先 `has` 全部再 `remove`。**把机器输入/输出缓冲塞进玩家库存会产生 5 个真实副作用**（详见 §2.3；最关键的 3 个：机器占用的物品出现在背包、机器花光最后 1 个时快捷栏绑定被自动解除、每帧缓冲变化触发全量 UI 广播）。建议独立缓冲。证据见 §2。
3. **UI 桥不能简单"再加一个插件发消息"**：`bridge.pack.ts` **独占了 `port.onmessage`**（`:74-75`、`:134`），且它**在挂载顺序上早于 mechanical**（`scene-owner.pack.ts:62` vs `:65-67`），所以机器/生产状态要么走 **world resource 解耦**（项目已有先例 `build/target.ts:7` + `build.pack.ts:204`），要么由生产插件**自己持有同一个 port 的 `postMessage`**（只发不收）并新增消息类型。DOM UI 只能在前端 root（AGENTS.md:44-45）。证据见 §3。
4. **GameRead 可以注册多个 read，但会破坏现有 playthrough**：`play.state()`/`play.waitFor()`/`play.advance()` 在不传 id 时要求**恰好一个 read**，多个会直接抛 `state-unavailable`（`play-Q4ZMD5L4.mjs:382-389`）；而 `play.advance()` 内部**总是**读一次投影（`:516-521`），现有 6 个脚本共 **29 次** `play.advance(...)` 都没传 `read`。**最小方案：不新增 read，把生产/库存折叠进现有 `mechanical` 快照**，或同步改脚本传 id。证据见 §4。
5. **读数最小改法是"扩数据 + 加一行/一根进度条"**：`readout.ts` 是单个相机锚定面板（`readout.ts:80-99`），不是每机器一套；在 `readout-status.ts` 加 `progress/outputCount` 字段、在 `readout.ts` 加 1 个进度条 Box + 2 位数字即可，不会触发性能文档里"每台机器一套 Box 读数"的风险；但**持续进度放 3D 读数不适合**（只在悬停/选中时显示，`runtime.ts:89-95`），持续面板应走 DOM。证据见 §5。
6. **"可持续重复的生产线"在当前资源量下做不到**：4 个矿点 × 20 = **总储量 80**（`resource.ts:13,33-38`，测试也锁死 80，`resource.test.ts:90-94`），**矿点不会再生**（`resource.pack.ts:163-176` 只有扣减）。80 个矿石烧完生产线就永久停摆（除非刷新）。而且 3D 矿石计数只画 2 位（`harvest.pack.ts:237-239`），总量超过 99 会**静默显示错误**（`splitDigits(120,2)` 只取前两位）。证据见 §6。
7. **存档是 M1.8 的前置，不是后置**：`SAVE-ARCHITECTURE.md` 明确"首条生产链动工前补完 P0"（`:103-110`），而生产链会新增"机器输入/输出/进度/储能"四类状态，快照格式 v1（`:38-73`）里**没有**这几类。另外 `grantKit` 的 `KIT_GRANTED_KEY` 不落盘会重复发套件（`SAVE-ARCHITECTURE.md:21`；`mechanical.pack.ts:49,120-132`）。证据见 §7。
8. **快捷栏 8 格不够 5+5 个零件，而且 `grantKit()` 会直接崩**：新增 5 个零件后零件类型总数 10 > `HOTBAR_SLOT_COUNT=8`（`hotbar.ts:4`）；`grantKit` 用 `kitSlots.forEach((id,index)=>hotbar.bind(index,...))`（`mechanical.pack.ts:122-127`），一旦 bind 索引 ≥8，`assertSlot` 抛 `RangeError`（`hotbar.ts:23-27`）→ **整个游戏启动失败**。已绑定的 1-5 号槽位还被旧 playthrough 脚本硬编码（`scripts/m17a-playthrough.mjs:35-40` 等），不能随意改顺序。证据见 §8。
9. **"机器到机器运输"没有现成通道**：现有连接只认动力端口（`ports.ts:109-116`），物品没有实体、没有传送带系统。最小做法是**在相邻机器的缓冲区之间做纯逻辑转移**（按 `Placement` 邻接判断），不需要新实体/物理。证据见 §9-C。
10. **文档与代码有一处键位矛盾**：`DEMO-CHECKLIST.md:25` 写"机械零件 `X` 拆除并返还库存"，但机械系统的拆除键实际是 `Delete`/`Backspace`（`mechanical.pack.ts:412-415`）；`X` 只在普通建造分支里拆建筑（`build.pack.ts:576-578`）。证据见 §8.1。

---

## 1. 物品系统

### 1.1 现有数据模型【事实】

`assets/items/items.ts` 是唯一物品注册表（只读）：

| 位置 | 内容 |
|:--|:--|
| `items.ts:6` | `ItemCategory = 'resource' \| 'mechanical'` |
| `items.ts:8-14` | `ItemId` 联合：`iron_ore / shaft / gear_12 / gear_24 / power_source / machine`（6 个） |
| `items.ts:16-28` | `ItemDefinition { id, name, description, icon, maxStack, category }` |
| `items.ts:30-37` | `ITEM_IDS` 常量表（`as const satisfies Record<string, ItemId>`，**不校验穷尽性**） |
| `items.ts:39-46` | `IRON_ORE_DEFINITION`（被测试直接 import） |
| `items.ts:48-89` | `MECHANICAL_DEFINITIONS`（5 个机械物品） |
| `items.ts:91-94` | `DEFINITIONS: ReadonlyMap<ItemId, ItemDefinition>`（真正查表处） |
| `items.ts:97-106` | `getItemDefinition`（未注册返回 undefined）/`requireItemDefinition`（抛错） |
| `items.ts:109-112` | `isMechanicalItem`：只按 `category === 'mechanical'` 判定 |
| `items.ts:115-117` | `itemDefinitions()`：定义表快照（**背包列表顺序 = 这里的插入顺序**） |

### 1.2 所有使用点（grep 结果，按"新增物品会不会被漏掉"分类）

| 文件:行 | 用法 | 新增物品是否必须改 |
|:--|:--|:--|
| `items/items.ts:8-14` | `ItemId` 联合 | **必须**（否则 TypeScript 不接受新 id） |
| `items/items.ts:30-37` | `ITEM_IDS` | **必须**（项目约定统一从这里取 id） |
| `items/items.ts:39-46 / 48-89` | 定义对象 | **必须**（资源物品放 `IRON_ORE_DEFINITION` 旁或新建数组；机械物品加进 `MECHANICAL_DEFINITIONS`） |
| `items/items.ts:91-94` | `DEFINITIONS` 表 | **必须**（漏了会"编译通过、运行抛 unknown item id"） |
| `mechanical/parts.ts:2,100-164` | 机械零件定义（`itemId` 绑定） | 仅机械零件物品需要 |
| `mechanical/parts.ts:174-176` | `MECHANICAL_ITEM_IDS` | 由 `MECHANICAL_PART_IDS` 派生，自动 |
| `mechanical/parts.ts:187-192` | `partDefForItem` | 自动（遍历派生） |
| `game-ui-bridge/protocol.ts:2-5,12-20` | `CatalogItem`、`itemDefinitions` 导出 | 不需要改；新物品自动进 state |
| `game-ui-bridge/protocol.ts:78-80` | `hotbar/bind` 校验 `getItemDefinition` | 不需要改（新物品自动合法） |
| `game-ui-bridge/protocol.ts:92-119` | `buildStateMessage`（只列 `total>0`） | 不需要改 |
| `game-ui-bridge/protocol.ts:132-139` | `stateSignature` 遍历**全部**定义 | 不需要改，但每帧成本 +1 项（见 §3.2） |
| `game-ui-bridge/bridge.pack.ts:45-46,97-105` | `itemDefinitions()`/`getItemDefinition`/`count>0` | 不需要改 |
| `frontend/frontend-ui.ts:152,178,223` | `itemIconSvg(item.icon)` | 图标键未注册会显示占位图（见下） |
| `frontend/icons.ts:71-87` | `itemIconSvg` switch | **必须**（否则显示 `PLACEHOLDER_SVG` 的问号图标，不报错） |
| `frontend/frontend-ui-protocol.ts:58-79` | 纯字符串透传，不校验 ItemId | 不需要改 |
| `inventory/inventory.ts:138,142,147` | `requireItemDefinition` 取 maxStack/校验 | 不需要改 |
| `build/input-mode.ts:7-9` | `isMechanicalItem` | 不需要改；但**新物品的 category 决定建造/机械模式行为**（见 §8.2） |
| `mechanical/runtime.ts:8,72` | `isMechanicalItem`（右键启停前置） | 不需要改 |
| `harvest/harvest.ts:112` | `inventory.add(ITEM_IDS.IRON_ORE, ...)` | 不影响新物品；新物品的"产出入口"要自己写 |
| `harvest/harvest.pack.ts:234` | 3D HUD 只统计 `IRON_ORE` | 可选：想让铁锭也有 3D 计数才要改（2 位上限，见 §6.3） |
| `assets/__tests__/inventory.test.ts:37` | `expect(itemDefinitions()).toHaveLength(6)` | **必须**改（否则测试红） |
| `assets/__tests__/mechanical-items.test.ts:14` | `expect(itemDefinitions()).toHaveLength(6)` | **必须**改 |
| `assets/__tests__/ui-bridge.test.ts:53,77,86` | 用 `itemDefinitions()` 构造消息 | 不需要改（无长度断言） |
| `assets/__tests__/mechanical-ports.test.ts:34-35` | 锁 `PROTOTYPE_KIT.shaft=24 / machine=5` | 只有改套件数量才要改 |

> **【事实】类型安全盲区**：`ITEM_IDS` 用 `satisfies Record<string, ItemId>`（`items.ts:37`），只保证"值合法"、**不保证"ItemId 的每个成员都有定义"**；`DEFINITIONS` 是普通 `Map`（`:91`），也没有穷尽性检查。所以"加了 `ItemId` 忘了加定义"能通过 `pnpm typecheck`，只在运行时 `requireItemDefinition` 抛 `unknown item id`（`:104`）。**新增物品时唯一可靠的检查是 §1.2 的清单 + `requireItemDefinition` 单测。**

### 1.3 新增物品的最小清单（以 `iron_ingot` 为例）

1. `items.ts:8-14`：`ItemId` 加 `'iron_ingot'`。
2. `items.ts:30-37`：`ITEM_IDS` 加 `IRON_INGOT: 'iron_ingot'`。
3. `items.ts:39-46` 附近：加 `IRON_INGOT_DEFINITION`（`category: 'resource'`、`maxStack: 999`、`icon: 'iron_ingot'`、中文名/描述）。
4. `items.ts:91-94`：把定义放进 `DEFINITIONS`。
5. `frontend/icons.ts:71-87`：加 `case 'iron_ingot'` 与对应 SVG（不加以不报错，只显示占位问号）。
6. `__tests__/inventory.test.ts:37`、`__tests__/mechanical-items.test.ts:14`：`6 → 7`。
7. （可选）无其他必改点：背包/快捷栏/UI 桥/库存/存档全部由定义表驱动，自动出现。

> **【建议】** 若 `iron_ingot` 要参与生产链，建议**不要**把铁锭定义为 `category: 'mechanical'`：`isMechanicalItem` 会把它当成"选中即进入机械模式"，从而让普通建造让出输入（`build.pack.ts:489-497`），而它又不是零件（`partDefForItem` 返回 undefined），结果选中铁锭时**建造和机械两边都不响应**（见 §8.2）。定义为 `resource` 后，选中它同样是"普通建造被 `selectedHotbarItem !== null` 挡住"（`build.pack.ts:612`），本质仍是空操作——所以**铁锭默认不应绑定进快捷栏**。

---

## 2. 库存（InventoryService）

### 2.1 语义表【事实】

实现在 `assets/inventory/inventory.ts`，服务在 `inventory.pack.ts:8-15` 注册为 `ctx.provide('inventory')`，类型增强在 `inventory.ts:154-158`。

| 方法 | 语义 | 失败/异常路径 |
|:--|:--|:--|
| `add(itemId, count=1)` | 先补已有未满堆、再按 `maxStack` 开新堆；**无总容量上限**；返回实际加入数量（合法时恒等于参数） | 数量非非负整数 → 抛 `InvalidItemCountError`（`:29-33`）；未知 itemId → `requireItemDefinition` 抛错（`:138`） |
| `remove(itemId, count=1)` | **单物品整笔移除**；从第一堆开始扣、空堆删除；成功返回 `true` | `count=0` 返回 `true` 无操作（`:98`）；数量不足 → **返回 `false` 且不改状态**（`:99-100` 先查总数，`:109-113` 才动堆）；数量非法/未知 id → 抛错 |
| `count(itemId)` | 所有堆之和；**不校验** itemId 是否注册（未知返回 0） | 无 |
| `has(itemId, count=1)` | `count(itemId) >= count`；`count=0` 恒 true | 数量非法/未知 id → 抛错（`:146-149`） |
| `stacks()` | 只读快照副本（`inventorySnapshot`，`:118-120`），外部改不动内部 | 无 |

纯逻辑层还导出 `inventoryCount / inventoryHas / inventoryAdd / inventoryRemove / inventorySnapshot`（`:46-120`），供测试与 pack 复用。

### 2.2 "整笔失败不改状态"对机器消耗意味着什么

**【事实】** `inventoryRemove` 的原子性只到**单个 itemId**：

- 好事：机器每周期消耗 `1×iron_ore` 时，`remove` 失败（矿石不够）→ 库存一个都不扣，机器可以安全地"本周期不工作"，不会出现"扣了一半"。
- **坑**：多输入配方（例如以后"2 铁矿石 + 1 煤"）没有跨物品事务。先 `remove(ore,2)` 成功、再 `remove(coal,1)` 失败 → 矿石白扣。**【建议】** 生产逻辑统一采用 **"先 `has` 全部输入 → 再 `remove` 全部"** 的两段式；因为引擎各系统在同一线程的 `Update` 里跑，同一帧内不存在并发修改，`has`+`remove` 之间不会被打断。
- **坑**：`remove` 的 `false` 是预期分支（不是异常），调用方不能 `throw`，否则会打断同一 `Update` 链上后续系统。
- 产出侧 `add` **只会因非法数量/未知 id 抛错**，没有"背包满了"的失败路径（`:64-90` 无容量判断），所以"先扣料后产出"不会出现"扣了料产不出"的中间态。

### 2.3 机器输入/输出缓冲 vs 8 格快捷栏/背包

**数据模型层面不冲突**：库存是 `stacks: {itemId,count}[]`（`inventory.ts:14-16`）——**没有格子概念、没有容量**；快捷栏是独立的 8 槽绑定（`hotbar.ts:4,8-13`），只是 `ItemId | null` 的视图。所以"把机器缓冲放进库存"**不会挤占 8 格**。

**行为层面有 5 个真实副作用【事实】**：

1. **玩家可见/可取**：`buildStateMessage` 把 `inventory.count(id)` 汇总成 `total` 发给前端（`protocol.ts:92-111`），机器里的原料/产物会直接显示为"玩家持有"。
2. **快捷栏会被机器卸掉**：`bridge.pack.ts:121-129` 每帧执行 `hotbar.dropUnavailable(countOf)`；机器吃掉最后 1 个矿石的瞬间，玩家绑定的铁矿石槽位被**自动解除**（`hotbar.ts:66-81`）。
3. **机器忙时绑不回来**：`hotbar/bind` 要求 `inventory.count(itemId) > 0`（`bridge.pack.ts:102-105`），机器把原料吃光后玩家无法把该物品重新拖到快捷栏。
4. **UI 全量广播被刷爆**：`stateSignature` 把**每个**定义的 count 拼成签名字符串（`protocol.ts:132-139`），`bridge.pack.ts:127-128` 只要签名变化就发全量 state。机器缓冲若每帧变化 → 每帧一次全量消息（正好命中 `PERFORMANCE-BUDGET.md:50` 的"每帧重建 UI 状态消息"风险）。
5. **存档语义混在一起**：`SAVE-ARCHITECTURE.md:48` 的 inventory 快照只有玩家堆叠；机器缓冲混进去后读档无法区分"玩家物品"和"机器里正在加工的物料"。

**【建议】** 机器用**独立缓冲**：在 `production` 状态里放 `input: {itemId,count}[]` / `output: {itemId,count}[]`（纯数据，纯 JSON，可存档），只在"产物出机器"时调用 `inventory.add`（或由运输/玩家取走）。UI 想展示机器内物品时走独立消息（§3），不要复用玩家库存。

---

## 3. UI 桥（Engine ↔ Browser）

### 3.1 现有协议【事实】

Engine 侧 `assets/game-ui-bridge/protocol.ts`：

- `UI_PROTOCOL_VERSION = 1`（`:10`）。前端有一份**独立同值常量** `PROTOCOL_VERSION = 1`（`frontend/frontend-ui-protocol.ts:3`）——**两个文件各写一遍，必须手工保持一致**。
- `UiStateMessage`（`:22-31`）：`{ v, type:'state', revision, items: CatalogItem[], hotbar: { slots, selected } }`；`CatalogItem` 含 `id/name/description/icon/maxStack/total`（`:12-20`）。
- 前端→引擎命令（`:40-45`）：`hello / state/request / hotbar/select / hotbar/bind / hotbar/unbind`，`parseUiCommand` 严格校验 `v` 与参数（`:60-89`）。
- `buildStateMessage`：**只列 `total > 0` 的物品**（`:92-111`），背包顺序 = `itemDefinitions()` 顺序。
- `stateSignature`：所有物品 count + hotbar revision（`:132-139`）。

引擎侧桥接插件 `assets/game-ui-bridge/bridge.pack.ts`：

- `inject: ['world','inventory','hotbar','executionBootstrapHost']`（`:30`），`port = ctx.executionBootstrapHost.port`（`:35`）。
- `port.onmessage` **单点赋值**（`:74-75`），命令处理 switch 在 `:82-112`，出错回 `error` 消息（`:65-72`）。
- 每帧系统 `Update`（`:119-136`）：`dropUnavailable` → 比较 `stateSignature` → 变化才 `sendState()`（全量）。

前端消费 `assets/frontend/frontend-ui.ts`：

- `port.onmessage`（`:392-410`）：先处理 `error`，再 `parseState`（`frontend-ui-protocol.ts:58-79`，校验 `type==='state'`、`v`、`slots.length===8`），`revision <= ui.revision` 丢弃，最后 `render()`。
- 快捷栏 `renderHotbar`（`:142-160`）用 `itemIconSvg(item.icon)` + `item.total` 画图标/数量；背包 `renderList`（`:162-209`）/详情 `renderDetail`（`:211-238`）；拖拽绑定（`:305-345`）与点击绑定（`:351-361`）最终都发 `hotbar/bind`（`:344,357`）。
- **打开背包会 `app.pause()`**（`:252-302`），关闭才 `resume`。→ **进度条不能放背包模态里**，否则暂停后进度不更新。

### 3.2 要显示"机器状态/加工进度/产能"，最小怎么加

**【事实】两个硬约束**：

- **同一个 `MessagePort` 只能有一个 `onmessage` 语义的接收方**：`bridge.pack.ts:75` 直接 `port.onmessage = ...`，任何第二个插件再赋值会**覆盖桥接**；另外桥接在清理时把 `port.onmessage = null`（`:134`）。想接收新命令，只能改 `bridge.pack.ts` 的 switch，或改用 `port.addEventListener('message', ...)`（可共存）并自行清理。
- **桥接挂载顺序早于 mechanical**：`scene-owner.pack.ts` 的子插件顺序里 `game-ui-bridge` 在 `:62`，`mechanical` 在 `:65`、`mechanical-runtime` 在 `:67`。所以桥接**不能**直接 `inject: ['mechanical']`（注入的服务必须在它之前 provide）。

两种可行方案：

| 方案 | 做法 | 改动量 | 时序/风险 |
|:--|:--|:--|:--|
| **A. state 扩展（推荐先做）** | 把机器/生产摘要折进现有 `state` 消息：`UiStateMessage` 加可选 `production` 字段（`:22-31`），`buildStateMessage` 填值，前端 `parseState` 加默认值、`render` 加面板 | 中：`protocol.ts` + `bridge.pack.ts` + `frontend-ui-protocol.ts` + `frontend-ui.ts` | 桥接拿数据：推荐**world resource 解耦**（见下），不用改挂载顺序；**必须做节流/只发状态变化**，否则每帧全量 |
| **B. 新消息类型（进度专用）** | 生产插件自己 `inject: ['executionBootstrapHost']` 拿同一个 port，**只 `postMessage`** `{v:1,type:'production-state',...}`；前端 `onmessage` 加一个分支 | 小：新插件 + 前端一个分支 | 不需要改桥接/顺序；不共享 `revision`（各自节流），**不会**影响 `hello`/state 流程；旧前端遇到未知 type 直接忽略（`frontend-ui.ts:396-401` + `parseState` 返回 undefined），向后兼容 |

**world resource 解耦先例【事实】**：`build/target.ts:7` 定义 `BUILD_TARGET_STATE_KEY`，`build.pack.ts:203-204` 每帧 `world.insertResource(...)`，`grid/grid-overlay.pack.ts:19` 读同一个 key。用它把"生产状态快照"从生产系统传给桥接，**不需要服务注入、不需要改挂载顺序**。`bridge.pack.ts` 已有 `world`（`:32`），在每帧系统里读资源即可。

**【建议】**

- 机器"状态/配方/产能"这类**低频**信息 → 方案 A（并入 state，随库存签名一起发）。
- "加工进度"这类**连续**信息 → 方案 B，且**按百分比变化 ≥1% 或 ≥10Hz 节流**，只发一台/当前选中机器的摘要；不要每帧发。
- 面板位置按 `UI-SPEC.md:82`（右上角"机械/生产信息"），DOM 由前端 root 创建；**Engine Worker 里不要出现 `document`/DOM**——`gameHost.uiRoot` 只在呈现 realm 存在（`game-context.d.ts:73-78`），硬规则见 `AGENTS.md:44-45`。

### 3.3 协议版本的注意事项【事实/建议】

- 前端用 `message.v !== PROTOCOL_VERSION` 严格拒绝（`frontend-ui-protocol.ts:59`）。**加字段**不用升版本（`parseState` 忽略未知字段）；**改语义/删字段**才升，且必须同时改 `protocol.ts:10` 与 `frontend-ui-protocol.ts:3` 两处常量。
- `hotbar.slots.length !== 8` 会被前端判为非法（`frontend-ui-protocol.ts:62`）→ 若扩快捷栏，前端 `SLOT_COUNT`（`:4`）、后端 `HOTBAR_SLOT_COUNT`（`hotbar.ts:4`）、协议校验（`protocol.ts:51-53`）、前端按键范围（`frontend-ui.ts:385`）四者要一起改。

---

## 4. GameRead 投影（`ctx.gameHost.gameProjection`）

### 4.1 API 位置与签名【事实】

**本项目当前唯一注册点**：`assets/mechanical/runtime.ts:40-45`

```ts
const unregisterRead = ctx.gameHost?.gameProjection?.registerRead({
  id: 'mechanical',
  title: 'Mechanical state',
  read: () => state.snapshot() as unknown as GameProjectionValue,
});
yield () => unregisterRead?.();
```

类型定义（在本工程 `node_modules` 内，实际路径与任务给的略有差异——没有嵌套的 `node_modules/@forgeax/engine` 重复层，或 `@forgeax+engine` 目录）：

- `node_modules/@forgeax/engine/node_modules/@forgeax/engine-app/dist/game-context.d.ts:34-48`
  - `GameReadDef { id: string; title: string; description?; read: () => GameProjectionValue | Promise<...> }`
  - `GameProjectionRegistrar { registerAction(def): ()=>void; registerRead(def): ()=>void }`
- 同文件 `:8-10`：`GameProjectionValue` 是 **JSON 形状**（`null|boolean|number|string|array|object`）——**不能放 EntityHandle/Map/类实例**。
- 同文件 `:95-99`：`gameProjection?` 是"**Optional Play-only projection seam**……deliberately absent outside a host that can clear registrations on disposal"——**生产/发布运行时可能没有这个字段**，所以 `runtime.ts` 用了可选链；任何"给 UI 用"的数据**不能只依赖 read 投影**。
- 同文件 `:41-43`：注册只在"fresh transient world"的 bootstrap 期有效，run 结束即丢弃 → 注册必须放在 `ctx.effect` 里并返回 unregister（`runtime.ts:45` 已这样做）。

实现侧：

- `node_modules/@forgeax/engine/node_modules/@forgeax/engine-devkit/dist/host/game-projection-source.d.ts:2`：注入页面的源码里 `gameProjectionDefinitions` 是 **`Map`，按 `id` 去重，重复 id 直接 `throw new Error('forgeax: duplicate game projection id ...')`**；`registerRead` 返回的清理函数只在"当前 entry 仍是自己"时删除。
- `node_modules/@forgeax/engine/node_modules/@forgeax/engine-devkit/dist/chunk-FI3L5X3D.mjs:2516-2523`：`__forgeaxGameInspection.list()` 返回**所有** read 的 id 数组；`read(id)` 按 id 取结果（找不到抛错）。

### 4.2 能否注册多个 read（inventory / production / transport）？

**技术上可以**：注册器是 Map，不限制数量；`list()` 会列出全部（`:2516`）；重复 id（含与 action 重名）会抛错（`game-projection-source.d.ts:2`）。

**但有代价【事实】**：`project play` 的 `play.state()` / `play.waitFor()` / `play.advance()` 在**不传 id** 时走 `resolveRead`（`play-Q4ZMD5L4.mjs:382-389`）：

```js
if (reads.length !== 1) throw new PlayHelperError("state-unavailable",
  reads.length === 0 ? "The game registers no read projection..."
                     : `Several read projections are registered (${reads.join(", ")}); pass the id.`);
```

- `play.state(read?)` 文档注释："defaults to the only read"（`play.d.ts:70`）。
- `play.advance(seconds, options)` 文档："Game read projection id returned afterwards; defaults to the only registered read"（`play.d.ts:41-44`），实现里 **`advance` 结束必然 `readState(options.read)`**（`play-Q4ZMD5L4.mjs:516-521`）。
- `waitFor(predicate, { read })`（`play.d.ts:26-30`）同理。

**现有脚本影响【事实】**：6 个脚本共 **29 次** `play.advance(...)` 没有传 `read`（`m17b-playthrough.mjs` 10 次、`m17c-branch-overload.mjs` 4 次、`m17c-cyclic.mjs` 1 次、`m17c-overload.mjs` 5 次、`m17c-playthrough.mjs` 4 次、`m17c-reconnect.mjs` 5 次）。**只要再注册第二个 read，这些调用会在 advance 成功后抛 `state-unavailable`，回归证据全红。**

### 4.3 建议

- **【建议，最小改动】不新增 read id**：把生产/库存信息**折叠进现有 `mechanical` 快照**（`runtime-state.ts:15-67` 的 `MechanicalSnapshot` 加 `production` / `machines[].progress` / `machines[].buffers` 字段）。这样 `play.state('mechanical')`、`play.advance()` 全部继续工作，旧断言不受影响（新增字段是加法）。
  - 代价：快照会变大；如果生产系统不在 `MechanicalRuntimeState` 里（见 §9-B），可以把它做成 `runtime.ts` 里组合两个来源的 `read` 函数。
- **【建议，若要拆 id】** 新增 `inventory` / `production` read 的同时，把所有 `play.advance(s)` 改成 `play.advance(s, { read: 'mechanical' })`，`play.state()` 一律传 id；并新增一个"多 read 回归"脚本明确覆盖。**不要**只为新 read 改脚本而漏掉 29 处 advance。
- **【事实】** read 的返回值必须能 `JSON.stringify`；`inventory.stacks()` 是 `{itemId,count}[]`，可以直接放（Map 需要转数组/对象）。

---

## 5. 读数 / 视觉

### 5.1 三个文件的结构【事实】

**`assets/mechanical/readout-status.ts`（纯逻辑，85 行，可单测）**

- `:10-18` `ReadoutStatus` 8 态：`powered / loaded / disabled / idle / source-overload / branch-overload / cyclic / unsupported`。
- `:20-29` `STATUS_TEXT`（英文短词，供 5×5 点阵字模）。
- `:31-39` `ReadoutTarget { rpm: number|null; torque: number|null; capacity: number; status }` ← **要显示进度/产物，加字段就在这里**。
- `:58-73` `readoutStatusOf`：只做"解算结果 → 显示状态"的映射，不重算物理。
- `:76-85` `readoutTargetOf`：组装 `ReadoutTarget`；无解算数据时 `rpm/torque` 为 null（显示 `—`）。

**`assets/mechanical/readout.ts`（渲染，272 行）**

- `:26-41` 布局常量：固定面板锚点（相机局部坐标 `[-0.34, 0.30, -0.95]`）、3 行数字（RPM / 负载 / 承载）、`ROW_STEP=0.075`。
- `:44-68` 5×5 点阵 `GLYPHS`（只含 A B C D E H I L M N O P R S T U V W Y `/` `·` `—` `?`，**没有 G/F/J/K/Q/X/Z，也没有文字形式的数字**）。
- `:80-99` 创建：整个游戏**只有一个**读数面板根实体（`ChildOf` 相机），5 种状态材质。
- `:113-139` `spawnBox` + `spawnDigit`：**每个数字 7 段 = 7 个 Box 实体**；当前 3 组 × 3 位 = 63 个段实体。
- `:157-165` `setNumber`：只支持 3 位，**上限 999**。
- `:196-206` `rebuildText`：文本（RPM / `/` / `N·M` / 状态词 / `—`）用 5×5 点阵逐格 spawn。
- `:228-260` `update(target)`：`lastKey`（`:255`）只含 rpm/torque/capacity/status，变化才重建文本。

**`assets/mechanical/animation.ts`（74 行）**

- `:51-57` `applySpin`：按零件世界轴做四元数自转（`view.spinner`）。
- `:60-74` `applyMachinePose`：把 `MachinePose` 写到曲柄销/连杆/冲头；**写死 `DEFAULT_MACHINE_GEOMETRY`**（`machine.ts:19-25`），只对 `kind==='machine'` 调用（`runtime.ts:84-86`）。

### 5.2 显示"加工进度条 / 产物数量"的最小改法

**【建议】**（从改动小到大）：

1. **纯数据**：`readout-status.ts:31-39` 的 `ReadoutTarget` 加两个可选字段，例如
   `progress: number | null`（0–1）与 `outputCount: number | null`；在 `readoutTargetOf`（`:76-85`）里从生产状态透传。
2. **一行进度条**（最省实体）：`readout.ts` 复用现有 `spawnBox`，在 `STATUS_Y` 上方加一根底槽 + 一根填充条，`update` 里按 `progress` 改填充条 `Transform.scale[0]`（1 个实体，无重建）。**这是最省的显示方式**（对比：3 位七段数字 = 21 个实体）。
3. **产物数量**：加一个 2 位数字组（`spawnDigit`×2，14 个实体）；`update` 里用现成 `setNumber`（注意它上限 999、按 3 位清位逻辑写死，2 位要单独写或传 2 个 digit）。
4. **文字**：若要用文字（如 `INGOT`），必须在 `GLYPHS`（`:44-68`）补字模，否则 `?`（`:183`）。
5. 把生产数据接到 `runtime.ts:51-58` 的 `readoutFor`，在 `:95` 传给 `readout.update`。

**【事实/风险】**：`PERFORMANCE-BUDGET.md:45-46` 明确把"3D 读数用 Box 实体拼装"列为**第 1 号性能风险**，"工厂里多台机器同屏时实体与 draw call 线性增长"。当前实现是**单面板**（只显示选中/悬停目标，`runtime.ts:89-95`），所以再加一行是常数级增长，**不会**触发该风险；但**千万不要**把读数改成"每台机器一套面板"。

**【建议·更优】** 按 `UI-SPEC.md:84`（"世界内 3D 文字统一改为 DOM 覆盖层或世界内铭牌，二者只留一种"），持续性的生产信息（选中机器的进度/产物/产能）应走 **DOM 面板 + UI 桥**（§3）；3D 读数只保留"转速/扭矩/状态"这种紧贴机械的即时反馈。

### 5.3 其他视觉接入点

- `applySpin` 要求 `view.spinner` 存在；新零件若只是静态机体（熔炉、溜槽），`createPartView` 可以不设 spinner，`runtime.ts:83` 的 `applySpin` 会直接跳过（`animation.ts:52`）。
- 新机器的运动：`animation.ts:60-74` 目前只有"曲柄滑块"一套；破碎机可复用曲柄姿态，熔炉/溜槽不需要姿态。**若要新姿态，建议在 `machine.ts` 加纯函数 + `animation.ts` 加一个 `applyXxxPose`，不要塞进 `runtime.ts`**（文件体积钩子 20KB，见 AGENTS.md "提交前钩子"）。
- 幽灵/选中/放置反馈由 `visuals.ts` 统一生成（`createPartView` 的 kind 分支 `:137-211`：shaft / gear / power-source / **else=冲压机**）。**注意**：新增零件若走 `kind:'machine'`，会直接落到 else 分支、长得和冲压机一模一样；要区分外观必须在 `visuals.ts:194-211` 前按 `part.def.id` 分支。

---

## 6. 采集与资源

### 6.1 数据模型【事实】

- `assets/resource/resource.ts:10` `ResourceType = 'iron-ore'`（只有一种）。
- `:12-13` `IRON_ORE_MAX_AMOUNT = 20`；注释"四处共 80"。
- `:33-38` `IRON_ORE_NODES` 4 处 2×2 矿点（A(-5,4) / B(4,-5) / C(-13,-7) / D(10,10)）。
- `:84-89` 运行期 `ResourceNode { ...spec, entity, amount, depleted }`。
- `:91-106` `ResourceNodesService { nodes, isCellBlocked, nodeAtCell, harvest(nodeId, amount?) }`；`harvest` 返回 `{deducted, remaining}` 或 `undefined`。
- `assets/resource/resource.pack.ts:163-176` `harvest`：`Math.max(1, Math.floor(amount))` → 扣到 0 置 `depleted=true` → `applyVisual`（缩成残堆 + 删橙色矿脉）；**没有任何再生/回复逻辑**。
- `assets/harvest/harvest.ts:5-10` `HARVEST_RANGE=1.5`、`HARVEST_DURATION=3`、`HARVEST_YIELD=1`；`:107-113` `awardHarvest` 只在 `deducted>0` 时 `inventory.add(ITEM_IDS.IRON_ORE, deducted)`。
- `assets/harvest/harvest.pack.ts:271-324` 采集状态机：靠近显示 F（`:278`），3 秒进度条（`:294-305`），完成时 `resourceNodes.harvest` → `awardHarvest`（`:309-319`）。

### 6.2 总储量：**80**（确切数字）

- `resource.ts:33-38`：4 个节点；`resource.ts:13`：每个 20 → **4×20 = 80**。
- 测试锁死：`assets/__tests__/resource.test.ts:90-94`（`IRON_ORE_MAX_AMOUNT===20`、节点数 4、`total===80`、`<=99`）。
- 地图：`assets/world/map-config.ts:221-226` 生产地图 **32×32 格**（世界 `[-16,16)×[-16,16)`），4 处矿点的坐标都在图内（`resource.test.ts:22` 也锁坐标）。

### 6.3 对"持续可重复的生产线"意味着什么

**【事实】**

1. **总输入上限 80 个铁矿石**。若 1 矿 → 1 铁锭、每 3 秒采 1 个（`HARVEST_DURATION=3`），**纯手采满 80 个约 4 分钟**；之后所有矿点 `depleted=true`，`harvest` 永远返回 `undefined`（`resource.pack.ts:165`），生产线**永久停摆**（除非刷新页面）。
2. 目前**只有手采一条输入路径**：`harvest` 是唯一产出 `iron_ore` 的地方（`harvest.ts:112`）；机器没有"从矿点取矿"的接口（`ResourceNodesService` 只能按 nodeId 扣减，不提供自动输入）。
3. **3D 矿石计数上限 99**：`harvest.pack.ts:234-239` 用 `splitDigits(total,2)` 只画十位/个位；总量 ≥100 时显示会错（例如 120 → 取 `digits[0]=1,digits[1]=2` 显示 "12"）。`resource.ts:31` 的注释也承认"总储量 80，仍低于 3D HUD 两位数字上限 99"。
4. 枯竭后**解除建造阻挡**（`resource.ts:54-68` `nodeBlocksCell`），残堆只是视觉（`resource.pack.ts:117-123`）——所以矿采空后那块地可以盖工厂，这反而是"资源→工厂"的空间叙事机会。

**【建议】**（三选一，需策划决策）：

- **A. 提高单点储量 / 加矿点**：把 80 提到例如 400；**同时必须**把 3D 计数扩到 3 位或改成 DOM 数字（`harvest.pack.ts:237-239` + `resource.test.ts:90-94` 会红）。
- **B. 矿点缓慢再生**：在 `resource.pack.ts` 的 Update 里做定时回复（每次 +1 到上限），存档要保存 `amount`（`SAVE-ARCHITECTURE.md:18` 已列"必须存"）。这是"可持续可重复"最便宜的方案。
- **C. M1.8 只演示"一条会被吃完的线"**：明确写进验收：80 矿 = 演示用，M2 再做再生/更多矿脉。**若选 C，Demo 脚本必须算好消耗，不要在生产中途耗尽。**

> **另需注意**：即使矿够，"完整生产闭环"还差**产物的去处**。当前没有合成/建造消耗系统（建筑是 `[`/`]` 盲切换、不花材料，`build.pack.ts:569-580`；机械零件由开局套件发放，`mechanical.pack.ts:120-132`）。铁锭要"反哺建造"必须有至少一个消耗点：用铁锭换/造零件、或铁锭作为新建筑的成本项。**这是 M1.8 的策划缺口，不是接入点问题。**

---

## 7. 存档（`docs/design/SAVE-ARCHITECTURE.md` 摘要）

**文档结论【事实】**：

- `:3-6`：**可以做，但当前 5 个系统里有 3 个没有对外的快照/恢复接口**，需要先补接口；持久化用前端 realm 的 `zaohua-platform-sdk.storage`（异步/云端），Engine 侧走现有 MessagePort。
- `:10-25` 状态清单（14 项），其中"**必须存**"：库存堆叠、快捷栏、建筑、机械零件、动力源启停、资源节点 amount/depleted、玩家位置、开局套件已发放标志；"不存"：旋转角/机器位姿（由 ω 推导）、瞬时 UI/采集进度、空间索引/拓扑（可重建）。
- `:27-37` 5 个缺口：**建筑无服务**（`build.pack.ts` 是纯 pack、无 `provide`）、**机械无恢复接口**（只有 `parts()/updatePlacement`）、**资源节点只读**（不能设回 amount）、**玩家不可设位**、**无存档消息**（UI 协议只有 hotbar）+ **无存储调用**。
- `:38-73` 推荐快照格式 v1：纯 JSON，`version/savedAt/engine/player/inventory/hotbar/kitGranted/counters/buildings/parts/sources/resources`；**只存逻辑 ID + kind + placement**；显式存计数器（`nextPartId/nextBuildingId`）；**不存 spatial**；加载顺序：玩家 → 库存/快捷栏 → 建筑 → 机械 → 资源 → 重建拓扑 → 广播 UI；整体事务失败回滚到"空世界 + 默认出生"；未知 itemId/kind 逐条跳过。
- `:75-92` 存储通道：前端 `storage.get/set`（devStub 用 localStorage，key 前缀 `__vag_cloud_data_`）；存档 key 建议 `island-industria/save/slot-1`；自动保存 debounce 5s / 隐藏时 / 手动；先不做多槽位。
- `:103-110` **结论与优先级**："现有状态都能被序列化，没有不可导出状态；风险集中在接口缺失和加载顺序"；**P0 先补 5 个服务接口 + 消息协议**；"**首条生产链动工前补完 P0，因为生产链会新增「机器输入/输出/进度」状态，那时再补接口成本翻倍。**"

**与本次调查的交叉结论【事实】**：

- 文档列出的"动力源启停 `sourceEnabled`"在 `mechanical/runtime-state.ts:114`（私有 Map），**没有服务接口**；`angles/machinePoses` 在 `:115-116`（不存）。
- `KIT_GRANTED_KEY` 在 `mechanical/mechanical.pack.ts:49`（world resource），不落盘 → 读档会**重复发 24 轴/6+4 齿轮/2 源/5 机**（文档 `:21` 已标"必须存"）。
- **生产链新增状态 = 文档尚未覆盖的第 15-18 项**：机器输入缓冲、输出缓冲、加工进度、动力源储能（飞轮）。**【建议】** 在动工前把这几项补进 SAVE-ARCHITECTURE 的快照 v1（或 v2），并明确"进度/缓冲是否必须精确恢复"（否则读档后重新加工一遍会刷物品）。
- **M1.8 的最小判断**：如果 M1.8 只做"演示可玩"，可以**先不做存档**，但要把生产状态设计成**可序列化的纯数据**（不要塞进 Entity/Mesh），这样 M2 接存档时不用返工——这正是文档 `:109` 的要求。

---

## 8. 机械键位与快捷栏

### 8.1 现有键位【事实】

| 操作 | 按键 | 证据 |
|:--|:--|:--|
| 选零件 | **数字键 1-8 选快捷栏槽位**（不是"1-5 选零件"；零件由 `grantKit` 绑到 1-5 号槽） | `hotbar.pack.ts:10-12,35-41`；`frontend-ui.ts:385-388`（背包打开时） |
| 旋转零件 | `R`（+90°） | `mechanical.pack.ts:404` |
| 取消选中/幽灵 | `Escape` | `mechanical.pack.ts:405-411` |
| 拆除零件 | **`Delete` 或 `Backspace`**（选中零件后）；**返还库存** | `mechanical.pack.ts:412-415`；返还 `inventory.add` 在 `:328` |
| 右键启停动力源 | 鼠标右键（`mouse.justPressed(2)`），悬停动力源优先、选中动力源兜底 | `mechanical/runtime.ts:72-75`；目标选择 `runtime-state.ts:73-82` |
| 放置/选中零件 | 左键（`mouse.justPressed(0)`） | `mechanical.pack.ts:427,435` |
| 普通建造 | `[`/`]` 切换建筑类型、`R` 旋转、`X` 拆除、`G` 搬动、左键放置 | `build.pack.ts:569-580,612` |
| 采集 | `F`（3 秒） | `harvest.pack.ts:278` |
| 背包 | `Tab`，`Esc` 关闭 | `frontend-ui.ts:371-389` |

**【事实·文档冲突】** `docs/DEMO-CHECKLIST.md:25` 写"选中机械零件……`X` 拆除并返还库存"，但机械模式里 `X` **不会**拆零件（`X` 只在普通建造分支生效，`build.pack.ts:576-578`；机械模式下 build 整体让出输入，`build.pack.ts:489-497`）。应以 `Delete`/`Backspace` 为准，并修清单。`UI-SPEC.md:23` 也提到键位说明缺失（含 `X`），M1.8 至少要在 UI 写明"Delete 拆零件"。

### 8.2 机械模式判定【事实】

`assets/build/input-mode.ts:7-9`：

```ts
export function isMechanicalSelection(selectedItemId: ItemId | null): boolean {
  return isMechanicalItem(selectedItemId);
}
```

`build.pack.ts:489-497` 在机械模式时**完全让出输入**（清幽灵/选中/调整 + `return`）；`mechanical.pack.ts:222-225` 用 `partDefForItem(hotbar.slots[selected])` 决定"当前选中的零件"。

**后果【建议重点】**：

- 任何 `category:'mechanical'` 的物品，选中它都会**关闭普通建造**；若它还不在 `MECHANICAL_PART_DEFS` 里（`partDefForItem` 返回 undefined），则"建造不响应 + 机械不响应"= **死输入**。新增机械物品必须同时加零件定义，否则玩家选中后卡住。
- 任何非机械物品（铁锭）绑进快捷栏并选中 → `build.pack.ts:612` 的 `selectedHotbarItem === null` 不成立 → **建造也被挡住**。所以铁锭不要默认上快捷栏。

### 8.3 8 格够不够？——不够，且越界会崩【事实】

- `hotbar.ts:4` `HOTBAR_SLOT_COUNT = 8`；`hotbar.ts:23-27` `assertSlot` 对 `slot >= 8` 抛 `RangeError`。
- 现有：5 种零件绑定到 0-4 号槽，`hotbar.select(5)` 默认选空槽（`mechanical.pack.ts:120-132`）。
- M1.8 要加 5 种零件（立式轴、飞轮动力源、破碎机、熔炉、溜槽）→ **零件类型 5+5=10 > 8**。
  - **同一时间最多只能绑 8 种**（绑定是替换语义，`hotbar.ts:44-55`），玩家可以在背包里换绑，但演示时要来回拖。
  - **【高风险】** 若把 `kitSlots` 直接加到 10 项，`forEach` 在 index 8 调 `bind` → `assertSlot` 抛错（`hotbar.ts:24-25`）→ 该 `ctx.effect` 启动失败 → **游戏起不来**。`grantKit` 没有任何越界保护（`mechanical.pack.ts:122-127`）。
- 旧 playthrough 脚本硬编码槽位语义：`Digit1=shaft`、`Digit2=gear_12`、`Digit3=gear_24`、`Digit4=power_source`、`Digit5=machine`、`Digit6=空槽（退出机械模式）`（`scripts/m17a-playthrough.mjs:35-40,125,147`；`m17b-playthrough.mjs:55-57` 等）。**改绑定顺序会破坏这些回归证据。**

**【建议】**（按推荐度）：

1. **保持 0-4 号槽位顺序不变、5 号槽留空**（兼容所有旧脚本），新零件**默认不进套件、不绑定**，由玩家从背包拖到 6-8 号槽（最多同时 3 个新零件）。旧脚本不动，M1.8 新脚本用 `hotbar/bind` 或前端拖拽绑定。
2. 若演示必须同时用到 5 个新零件：把 `HOTBAR_SLOT_COUNT` 扩到 10（同时改 `hotbar.ts:4`、`hotbar.pack.ts:10-12` 的 `DIGIT_CODES`、`frontend-ui-protocol.ts:4` 的 `SLOT_COUNT`、`frontend-ui.ts:385` 的数字键范围、`protocol.ts:51-53` 自动跟随 `HOTBAR_SLOT_COUNT`、CSS 宽度），**并确认旧脚本对 `Digit6=空槽` 的依赖**（扩到 10 后 6 号槽仍是空槽，只要新零件不绑 5，旧脚本兼容）。
3. 更长期（M2）：做**建造/零件菜单**（`UI-SPEC.md:88-90` P0 任务），快捷栏只放常用物品——这样 8 格不再是硬约束。

### 8.4 `PROTOTYPE_KIT` 与 `grantKit()` 的绑定顺序

**【事实】**

- `parts.ts:179-185` `PROTOTYPE_KIT: Readonly<Record<PartId, number>>` —— **穷尽 Record**，新增 `PartId` 必须补数量，否则 `typecheck` 红。
- `mechanical.pack.ts:49` `KIT_GRANTED_KEY`（world resource，只发一次）；`:120-132` `grantKit`：
  ```ts
  const kitSlots: readonly PartId[] = ['shaft','gear_12','gear_24','power_source','machine']; // :122
  kitSlots.forEach((id, index) => { inventory.add(...); hotbar.bind(index, ...); });          // :123-127
  hotbar.select(5);                                                                           // :129
  world.insertResource(KIT_GRANTED_KEY, 1);                                                   // :130
  ```
- 绑定顺序**就是数字键顺序**（index 0 → `Digit1`）；`PROTOTYPE_KIT` 与 `kitSlots` **是两份独立数据**，没有派生关系——**新增零件必须同时改两处**，否则"发了物品但没绑定"或"绑定了不存在的 id"。
- 测试锁：`mechanical-ports.test.ts:34-35`（shaft=24 / machine=5）、`mechanical-items.test.ts:21-22`（shaft>0 / machine>=2）。改数量/顺序会连带改测试。

**【建议】**

- 顺序：**前 5 个位置保持 `shaft, gear_12, gear_24, power_source, machine` 不变**；新零件若要预绑，从 6 号槽起，且**先扩 `HOTBAR_SLOT_COUNT`**、再加 `kitSlots`。
- 或（更稳）新增**第二套 gated 套件**：`M18_KIT_GRANTED_KEY` + `inventory.add` 新零件但**不 bind**，把"绑定新零件"留给 M1.8 playthrough 通过 `hotbar/bind` 完成；这样不动旧套件、不动旧脚本，也避开 8 格越界。
- 存档注意：`KIT_GRANTED_KEY` 必须落盘（`SAVE-ARCHITECTURE.md:21`），否则读档重复发套件；新增的第二套件同理。

### 8.5 新零件本身要过的"机械系统关卡"（立式轴 / 飞轮动力源 / 破碎机 / 熔炉 / 溜槽）

**【事实】新增一个 `PartId` 会牵动的机械链路**：

| 关卡 | 位置 | 说明 |
|:--|:--|:--|
| `PartKind` / `PartId` 联合 | `parts.ts:9-10` | 新 kind 会扩散到所有按 kind 分支的代码 |
| `MECHANICAL_PART_DEFS`（穷尽 Record） | `parts.ts:100-164` | 必须补全：`itemId / label / w,d / height / maxTorque / ports`，机器加 `loadTorque`，动力源加 `ratedRpm` |
| `MECHANICAL_PART_IDS` | `parts.ts:166-172` | 手写数组，必须补 |
| `PROTOTYPE_KIT` | `parts.ts:179-185` | 穷尽 Record，必须补 |
| 3D 外观 | `visuals.ts:126-212` | `createPartView` 按 kind 分支；**else 分支=冲压机**，新 kind 不写会"长得像冲压机" |
| 动画 | `animation.ts:51-74` | `applySpin` 看 `view.spinner`；`applyMachinePose` 只给 `kind==='machine'` |
| 动力拓扑"机器是终端" | `power.ts:88-91`（isTransmission 只认 shaft/gear）、`:178-180`（machineIds 只认 `kind==='machine'`）、`:246-248`（drive tree 到机器停）、`:433`（poweredMachines） | **若新机器用别的 kind，动力会"穿过"它继续传播，负载/状态全错**；**建议加工机器复用 `kind:'machine'`** |
| 运行时机器列表 | `runtime-state.ts:231-233`（pose）、`:290-307`（machines 快照） | 只认 `kind==='machine'` |
| 端口连接 | `ports.ts:109-116`（rolePairAllowed 只支持 axial/output/input 组合）、`:135-143`（mesh 需 teeth） | 物品端口**不会**被 `buildConnections` 识别；运输要么用新 matcher，要么不用端口（按格子邻接） |
| 高度/层 | `parts.ts:56`（`MECH_PART_HEIGHT=1`）、`space.ts:13,43-46`（层高 3m，`levelBaseY = level*3`） | 一个零件当前只占 1 层、高 1m；跨层需要 height>1 的零件 + 处理支撑判定（`build.ts:99-127`） |

**逐零件判断【建议】**：

- **飞轮动力源**：`kind:'power-source'` + 新 `PartId`，沿用 `ratedRpm/maxTorque`；"手动储能"需要新状态（充能值），放在 `MechanicalRuntimeState`（与 `sourceEnabled` 同级，`:114`），并加读投影字段。若只是"右键启停 + 固定输出"，可以零新状态复用现有动力源（但和"正式动力源"需求不符）。
- **破碎机 / 熔炉**：`kind:'machine'` + 新 `PartId` + `loadTorque`（决定对动力网的负载）；配方/进度放生产状态。**熔炉可能占 2×2**：`MechanicalPartDef.w/d` 支持（`parts.ts:29-30`），但放置/端口/外观/AABB 都要按 w/d 处理（`placementCenter`、`placementAabb` 已参数化）。
- **立式轴**：现有零件本地轴全是 X（`parts.ts:11` 的 `Axis` 支持 `'y'`，`ports.ts:49-55` 支持 y 轴向量），但 **`level` 是把零件底部放在 `level*3` 的楼层锚点上**（`space.ts:43-46`），1m 高的立式轴够不到 3m 的二层。**真正跨层需要 height≈3 的零件 + 平台支撑判定**（`build.ts:101-105` 要求目标层有可建造支撑面）。`ROADMAP.md:130` 也明确"跨层传动尚未实现（无垂直轴/锥齿轮）"——**如果 M1.8 要立式轴跨层，这是一个独立的小里程碑，不是"加个零件"**。
- **溜槽/运输**：**建议不建端口、不进动力网**，用 `ports: []`（或新 `PartKind:'transport'`，`power.ts` 不会把它当传动/机器，自然成为独立 idle 组件）；转移逻辑用相邻格子的 `Placement` 判断，纯数据、无实体。

---

## 9. 最小接入点清单（新增一个物品 + 一台加工机器 + 一条运输）

> 以下按依赖顺序；【改】= 编辑现有文件，【新】= 新建文件。行号为当前 HEAD。

### A. 新增一个物品（`iron_ingot`，3 个必改文件 + 2 个测试）

| # | 文件:行 | 动作 |
|:--|:--|:--|
| A1 | `assets/items/items.ts:8-14`【改】 | `ItemId` 加 `'iron_ingot'` |
| A2 | `assets/items/items.ts:30-37`【改】 | `ITEM_IDS.IRON_INGOT` |
| A3 | `assets/items/items.ts:39-46` 附近【改】 | `IRON_INGOT_DEFINITION`（category `resource`、maxStack 999、icon `iron_ingot`） |
| A4 | `assets/items/items.ts:91-94`【改】 | 放进 `DEFINITIONS` |
| A5 | `assets/frontend/icons.ts:71-87`【改】 | SVG + `case 'iron_ingot'`（不加则占位问号） |
| A6 | `assets/__tests__/inventory.test.ts:37`【改】 | `toHaveLength(6)` → `7` |
| A7 | `assets/__tests__/mechanical-items.test.ts:14`【改】 | `toHaveLength(6)` → `7` |
| A8 | 无需改 | 库存、UI 桥、背包、存档都是定义表驱动（§1.2） |

### B. 一台加工机器（以"熔炉"为例）

| # | 位置 | 动作 | 关键注意 |
|:--|:--|:--|:--|
| B1 | `assets/items/items.ts`【改】 | 新机械物品 `furnace`（category `mechanical`，icon） | 不加会导致"选中即死输入"（§8.2） |
| B2 | `assets/mechanical/parts.ts:9-10`【改】 | `PartId` 加 `'furnace'`（**kind 用 `'machine'`**） | 新 kind 会让动力"穿过"机器（§8.5） |
| B3 | `assets/mechanical/parts.ts:100-164`【改】 | `MECHANICAL_PART_DEFS.furnace`：`itemId / label / w,d / height / maxTorque / loadTorque / ports`（动力 input 端口 + 可选物品端口） | 有 `loadTorque` 才进动力需求 |
| B4 | `assets/mechanical/parts.ts:166-172,179-185`【改】 | `MECHANICAL_PART_IDS`、`PROTOTYPE_KIT`（穷尽 Record） | TS 强制 |
| B5 | `assets/mechanical/visuals.ts:194-211`【改】 | 给熔炉加外观分支（否则复用冲压机外观） | 需要 `spinner` 才能有动画 |
| B6 | `assets/mechanical/animation.ts`（可选）【改/新】 | 若需要新运动，加纯函数 + `applyXxxPose` | 不做就静态机体 |
| B7 | **生产逻辑**【新】`assets/mechanical/production.ts` + 在 `mechanical.pack.ts:472-487` 的 `build()` 加 plugin 条目 + `scene-owner.pack.ts:64-68` 的 children 末尾挂载 | 状态机：`has` 原料 → `remove` → 计时进度 → `add` 产物；**不要**违反 `runtime.ts:24` 声明的"runtime 不改库存/Registry"边界 | 进度/缓冲用纯数据 class（可存档）；消费用两段式（§2.2） |
| B8 | **动力驱动**：拿"机器是否在转" | 两个选择：① 把生产逻辑放进 `runtime.ts`（它已持有 solution + delta + `state.step`）；② 在 `runtime.ts:37-104` 里 `yield ctx.provide('mechanicalRuntime', { isPowered(partId), speedFactorOf(partId) })`，生产插件注入 | 当前 `MechanicalRuntimeState` 是 runtime 插件私有（`runtime.ts:38`），**没有服务出口**——这是接生产最大的结构缺口 |
| B9 | 读投影 | 在 `runtime-state.ts:15-67` 的 `MechanicalSnapshot` 里加机器进度/缓冲字段，或组合到 `runtime.ts:40-44` 的 `read` 返回里 | **不要新增 read id**（§4.2） |
| B10 | 快捷栏 | 见 §8.3/§8.4：**不要**直接加到 `kitSlots` 超过 8 | 越界会崩 |
| B11 | 存档 | 进度/缓冲/机器状态要进快照（§7） | 否则读档重算会刷物品 |
| B12 | 测试【新】 | 生产纯逻辑单测（配方、原子消耗、进度推进、断电暂停） | 参考 `mechanical-*.test.ts` 风格 |

### C. 一条运输（机器 → 机器）

| # | 位置 | 动作 | 关键注意 |
|:--|:--|:--|:--|
| C1 | 生产状态【新】 | 每台机器/溜槽 `{ input: [], output: [] }` | 纯数据、JSON、可存档 |
| C2 | 转移规则【新，纯函数】 | 每 tick：`output` 有货 → 找**相邻**（4 邻，同 `level`，按 `Placement.gx/gz/w/d`）的机器/溜槽 `input` 未满 → 移 1 个 | 不需要新实体/物理；`Level` 一致即可（`grid.ts:61-64`） |
| C3（可选） | `assets/mechanical/parts.ts`【改】 | 加 `chute` 零件（`kind:'transport'` 或 `ports: []`） | `ports: []` 的零件不参与动力连接（`ports.ts:158-211` 只为端口建边），自然成为独立 idle 组件 |
| C4 | UI（可选） | 运输/缓冲数量显示：走 §3 的 DOM 面板，不要 3D 每台标签 | 每台标签触发性能风险 |
| C5 | 测试【新】 | 相邻转移、缓冲区满、断电停线、无相邻时不丢货 | — |

> **一句话**：A 是 8 个文件（含 2 测试）；B 至少 8 个文件 + 1 新文件 + 1 个结构性决策（谁能知道"机器在转"）；C 基本是新的纯逻辑 + 1 个可选零件。**B 是风险中心，不是 A。**

---

## 10. 硬规则冲突与风险（按严重度）

| # | 级别 | 冲突/风险 | 证据 | 规避 |
|:--|:--|:--|:--|:--|
| H1 | **高** | 注册第二个 GameRead 会破坏 6 个旧 playthrough 的 **29 次 `play.advance()`**（不传 read → `state-unavailable`） | `play-Q4ZMD5L4.mjs:382-389,516-521`；`play.d.ts:26-30,41-44,70`；脚本调用点见 §4.2 | 不新增 read id，折叠进 `mechanical` 快照；或同步给所有调用加 `{ read: 'mechanical' }` |
| H2 | **高** | `grantKit` 把零件绑到快捷栏时**没有越界保护**；`bind(index>=8)` 抛 `RangeError` → 插件启动失败 → 游戏起不来 | `mechanical.pack.ts:122-127`；`hotbar.ts:4,23-27` | 新零件默认不绑；或先扩 `HOTBAR_SLOT_COUNT` 并保持 5 号槽空 |
| H3 | **高** | 机械/生产状态没法从"动力运行时"拿到：`MechanicalRuntimeState`（含 `sourceEnabled`/solution）是 `runtime.ts` 私有，未 `provide` | `runtime.ts:37-104`；`runtime-state.ts:107-324` | 在 runtime 里 `ctx.provide('mechanicalRuntime', ...)` 或在 runtime 内做生产 |
| H4 | **高** | 生产状态混进玩家库存会：背包显示机器物料、机器花光即解除快捷栏绑定、每帧全量 UI 广播 | `bridge.pack.ts:121-129`；`hotbar.ts:66-81`；`protocol.ts:132-139`；`PERFORMANCE-BUDGET.md:50` | 独立缓冲（§2.3） |
| H5 | **高** | 存档 P0 接口缺失（建筑/机械/资源/玩家 4 个系统），且生产链会新增 4 类状态；带着这些做生产链 = 文档明确说要返工 | `SAVE-ARCHITECTURE.md:27-37,103-110` | M1.8 先把生产状态设计成纯 JSON；M2 前补 P0 接口 |
| H6 | 中 | UI 桥独占 `port.onmessage`，且桥接挂载早于 mechanical → 不能简单"再写一个订阅者" | `bridge.pack.ts:74-75,134`；`scene-owner.pack.ts:62,65-67` | world resource 解耦（`build/target.ts:7` 先例）或生产插件只 `postMessage` 新消息 |
| H7 | 中 | DOM 硬规则：DOM/浏览器 SDK 只能在前端 root，Engine Worker 不能碰 | `AGENTS.md:44-45`；`game-context.d.ts:73-78`（`uiRoot` 仅呈现 realm） | 机器/生产面板由 `frontend/` 创建，Engine 只发数据 |
| H8 | 中 | 任何 `category:'mechanical'` 但缺零件定义的物品 = 选中后"建造/机械都不响应"的死输入；任何非机械物品绑上快捷栏则挡住建造 | `build.pack.ts:489-497,612`；`input-mode.ts:7-9`；`parts.ts:187-192` | 物品与零件定义成对新增；铁锭不进快捷栏 |
| H9 | 中 | 8 格 < 10 种零件；旧脚本硬编码 1-5 号槽和"6 号槽=空" | `hotbar.ts:4`；`mechanical.pack.ts:122,129`；`scripts/m17a-playthrough.mjs:35-40,125,147` | 保持 0-4 顺序、5 号空槽；新零件拖拽绑定；扩容量需全链路改 |
| H10 | 中 | "可持续生产线"在 80 矿 + 不再生下不成立；3D 计数只支持 2 位（≥100 显示错） | `resource.ts:13,33-38`；`resource.pack.ts:163-176`；`harvest.pack.ts:234-239`；`resource.test.ts:90-94` | 再生 / 加矿 / 明确"演示线"；扩计数 |
| H11 | 中 | 新机器若不用 `kind:'machine'`，动力拓扑会"穿过"它传播，负载/状态全错 | `power.ts:88-91,178-180,246-248,433`；`runtime-state.ts:290-307` | 加工机器一律复用 `kind:'machine'` |
| H12 | 中 | 跨层（立式轴）被 3m 层高 + 1m 零件 + 固定平台支撑卡住；ROADMAP 明确未实现跨层传动 | `space.ts:13,43-46`；`parts.ts:56`；`build.ts:101-105`；`ROADMAP.md:130` | M1.8 不做跨层；立式轴限定同层或明确列为独立小里程碑 |
| H13 | 低 | 读数是"选中/悬停才显示"的单一面板 → 不能持续展示多台机器进度；背包打开会暂停游戏 → 进度面板不能放背包里 | `runtime.ts:89-95`；`frontend-ui.ts:252-302` | 持续信息用 DOM HUD 面板（UI-SPEC 右上角） |
| H14 | 低 | 3D 读数 Box 实体拼装是性能第 1 风险；再加一行是常数级，但"每机器一套"会爆 | `PERFORMANCE-BUDGET.md:45-46`；`readout.ts:113-139` | 保持单面板；持续信息走 DOM |
| H15 | 低 | 文档-代码键位不一致（`X` 拆零件 vs 实际 `Delete`） | `DEMO-CHECKLIST.md:25`；`mechanical.pack.ts:412-415`；`build.pack.ts:576-578` | 修文档；M1.8 补键位说明（`UI-SPEC.md:23,91`） |
| H16 | 低 | 20KB 文件提交钩子：新生产逻辑别硬塞进 `runtime.ts`/`mechanical.pack.ts`（现已 488 行） | `AGENTS.md` "提交前钩子" | 新建 `production.ts` 等独立文件 |

---

## 11. 需要决策的开放问题

1. **"完整生产闭环"的产物去向**：铁锭用来做什么？当前没有合成/建造消耗系统（建筑免费、零件开局发放）。没有消耗点 = 闭环不成立。需要策划先定：铁锭 → 新零件合成？铁锭 → 建筑成本？还是"铁锭入库即闭环"作为 M1.8 最低标准？
2. **生产状态放哪**：独立 `production` 服务/插件（干净、可测、可存档）vs 塞进 `runtime.ts`（改动小但违反其自述边界、文件膨胀）。本报告倾向独立插件 + 从 runtime 暴露一个只读服务。
3. **机器是否需要"输入缓冲"**：最小版可以"每周期直接从玩家库存扣料"（无缓冲、无运输）；有运输需求才需要缓冲。M1.8 的"机器到机器运输"意味着至少一端要有缓冲。
4. **矿点再生 / 总储量**：80 够不够一次 5-10 分钟 Demo？（按 §6.3 的算式给策划）如果要改，3D 计数必须一起改。
5. **新增 read 还是折叠 read**：如果验收脚本想分别断言 `inventory` / `production`，就要接受 29 处 `advance` 改写的成本；否则折叠进 `mechanical`。
6. **快捷栏是否扩容到 10**：影响 4 个常量 + CSS + 前端按键范围 + 旧脚本对 6 号槽的依赖。

---

## 附录 A：调查证据与命令

- 只读命令示例（均在 `E:/DeepseekHarness/ISLAND INDUSTRIA` 下执行）：
  - `grep -rn "ITEM_IDS\|itemDefinitions\|requireItemDefinition\|isMechanicalItem" assets scripts`
  - `grep -rn "PROTOTYPE_KIT\|grantKit\|HOTBAR_SLOT_COUNT" assets scripts`
  - `grep -rn "gameProjection" node_modules/@forgeax/engine --include="*.d.ts"`
  - `grep -n "reads.length" node_modules/@forgeax/engine/node_modules/@forgeax/engine-devkit/dist/play-Q4ZMD5L4.mjs`
- 关键证据文件：
  - `assets/items/items.ts`、`assets/inventory/inventory.ts`、`assets/hotbar/hotbar.ts`
  - `assets/game-ui-bridge/protocol.ts`、`assets/game-ui-bridge/bridge.pack.ts`
  - `assets/frontend/frontend-ui.ts`、`assets/frontend/frontend-ui-protocol.ts`、`assets/frontend/icons.ts`
  - `assets/mechanical/{parts,power,ports,registry,runtime,runtime-state,readout,readout-status,animation,visuals,machine}.ts`
  - `assets/mechanical/mechanical.pack.ts`、`assets/resource/*`、`assets/harvest/*`、`assets/world/map-config.ts`
  - `assets/scene-owner.pack.ts`、`assets/shared/asset-refs.ts`
  - `node_modules/@forgeax/engine/node_modules/@forgeax/engine-app/dist/game-context.d.ts`
  - `node_modules/@forgeax/engine/node_modules/@forgeax/engine-devkit/dist/play.d.ts`
  - `node_modules/@forgeax/engine/node_modules/@forgeax/engine-devkit/dist/play-Q4ZMD5L4.mjs`
  - `node_modules/@forgeax/engine/node_modules/@forgeax/engine-devkit/dist/host/game-projection-source.d.ts`
  - `node_modules/@forgeax/engine/node_modules/@forgeax/engine-devkit/dist/chunk-FI3L5X3D.mjs`（`__forgeaxGameInspection.list/read`）
- 设计文档：`docs/design/SAVE-ARCHITECTURE.md`、`docs/design/PERFORMANCE-BUDGET.md`、`docs/design/UI-SPEC.md`、`docs/ROADMAP.md`、`docs/DEMO-CHECKLIST.md`
- 测试：`assets/__tests__/{inventory,ui-bridge,mechanical-items,mechanical-ports,mechanical-runtime,resource,harvest,build-input-mode}.test.ts`
- Playthrough 脚本：`scripts/m17{a,b,c}-*.mjs`（脚本中的 `Digit1..6` 槽位语义见 §8.3）

> 本报告未执行 `pnpm test` / `typecheck` / `project play`（只读调查，不改代码；运行构建/测试会写 `.forgeax/`、`dist/` 等目录）。所有结论来自静态阅读与 grep。
