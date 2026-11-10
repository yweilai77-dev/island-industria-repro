# M2.0-P2-E1 实施报告（科技树核心系统）

- 阶段：M2.0-P2-E1（**仅 E1**；未进入 E2/E3）
- 开工基线：`53fb546`（P2-E0 交付后的仓库 HEAD；代码基线仍是 P2-D 最终版 `f0fd623`）
- 授权范围：科技树静态数据/状态机/交付事务/五类门控/起步包/GameRead/持久化边界 + 测试与回归
- 结论：**E1 授权范围内全部完成**。12 个节点可校验、可交付、可解锁；配方/机器放置/接口盒/结构模块/交互能力五类门控在真实业务入口生效；正式起步包替代临时原型套件；科技状态进入唯一 GameRead；持久化边界与可测接口就绪（落盘等待存档 P0）。
- 本文与 [P2-E1-TEST-REPORT.md](P2-E1-TEST-REPORT.md)、[P2-E1-COMPATIBILITY-REPORT.md](P2-E1-COMPATIBILITY-REPORT.md)、[P2-E1-PERSISTENCE-REPORT.md](P2-E1-PERSISTENCE-REPORT.md) 配套。

---

## 1. 阶段目标对照（任务书 §一 / §二）

| 目标 | 结果 | 证据 |
|:--|:--|:--|
| E1-A 12 节点静态数据与校验 | ✅ 12 节点、3 阶段（4/5/3）、前置无环、稳定 ID `tech:<slug>`；12 类坏数据都有校验 code | `assets/tech/nodes*.ts`、`validate.ts`、`tech-nodes.test.ts`（25 例） |
| E1-B 状态机与交付事务 | ✅ locked/available/researching/completed 全部派生；部分交付；原子单物品交付；一键交齐补偿事务；重复/超额/已完成拒绝 | `state.ts`、`tech-state.test.ts`（16 例） |
| E1-C 五类门控真实接入 | ✅ 配方 / 加工核心制造 / 机器与结构放置 / 接口盒与物流 / 特殊交互能力 | §5 门控落点表；`tech-gates.test.ts`（17 例）+ 真实游戏验收 |
| E1-D 继承工坊起步包 | ✅ 9 项 21 件正式起步包；旧原型套件降级为 legacy 兼容模式；19 个旧脚本迁移 | `start-kit.ts`、`mechanical.pack.ts`、`scripts/legacy-mode.mjs` |
| E1-E GameRead 接入 | ✅ 唯一 read `mechanical` 增加只读 `tech` 字段（节点状态/交付/解锁/追踪/模式） | `mechanical/runtime.ts:142`；验收脚本 state 中可见 `tech:{4 keys}` |
| E1-F 持久化边界 | ✅ `TechState` 纯 JSON + `serialize()/restore()` + 版本/容错/幂等/闭包修复；**未接存储**（诚实声明） | `state.ts`、`tech-persistence.test.ts`（19 例）、P2-E1-PERSISTENCE-REPORT |

---

## 2. 实际新增/修改文件（相对 P2-E0 HEAD `53fb546`：53 个文件 = 19 新增 + 34 修改）

### 2.1 新增 — 科技系统（`assets/tech/`，12 文件 / 1,367 行）

| 文件 | 职责 |
|:--|:--|
| `types.ts` | 节点/解锁/状态/快照/交付结果类型；`TECH_ID_PATTERN` |
| `nodes-stage1.ts` / `-stage2` / `-stage3.ts` | 12 个节点纯数据（按阶段拆分，均 < 20KB） |
| `nodes.ts` | 聚合、按 ID 索引、前置闭包、阶段/路线标签、能力枚举 |
| `validate.ts` | 校验器：唯一 ID/前置存在/无自依赖/无环/阶段不跳跃/成本合法/解锁目标存在/解锁不重复 |
| `state.ts` | 状态派生、四态、`submit` / `submitAll` 事务、追踪、序列化/恢复（clamp/闭包修复/幂等） |
| `gates.ts` | 从节点 unlocks 派生五类索引 + `BASE_RECIPE_IDS` + `STARTER_PART_IDS` + 门控查询（legacy 放行） |
| `start-kit.ts` | 「继承工坊」起步包 9 项 21 件与快捷栏槽位（5 号空槽不变） |
| `resolvers.ts` | 把科技数据校验连到真实物品/配方/机器/接口盒/结构目录 |
| `tech.pack.ts` | 插件：启动校验、提供 `tech` 服务、交付事务、只读快照、序列化边界、模式切换 |

### 2.2 修改 — 既有系统（34 文件中的源码部分）

| 文件 | 改动 |
|:--|:--|
| `production/recipes.ts` | 追加 6 条科技配方（锻压机 11 → 17，**历史 11 条顺序与下标不变**） |
| `production/production.ts` | `MachineState.recipeId`（权威配方身份）+ `availableRecipesFor`/`ensureRecipeSelected` + 所有配方查询接受门控谓词；`cycleRecipe` 跳过未解锁配方 |
| `production/production-runtime.ts` | 注入 `isRecipeUnlocked`；新机器默认选中第一条已解锁配方；投料/切配方/加工/快照全部过滤 |
| `mechanical/mechanical.pack.ts` | 正式起步包发放；legacy 套件转换；`selectedItem/place/canPlacePart/placePart` 机器门控 |
| `mechanical/runtime.ts` | 注入 `tech`、加工运行时配方门控、唯一 read 增加 `tech` 快照 |
| `industrial/port.pack.ts` | 取消开局接口盒套件（legacy 才补发）；安装盒按 `isPortUnlocked` + 能力门控；`J/H` 需要 `material-link` |
| `industrial/assembly-system.ts` | 取消开局结构框架（legacy 才补发）；`P` 模式/放置需要 `assembly` 能力 + 结构解锁；目标原因新增 `locked` |
| `game-ui-bridge/protocol.ts` / `bridge.pack.ts` | 状态消息增加 `tech`；新增 `tech/submit`、`tech/submit-all`、`tech/track` 命令；hello 支持测试启动 flags；签名纳入 tech 版本 |
| `frontend/frontend-ui.ts` | 读取 `__II_TEST_FLAGS__` 并在 hello 中上报；开启 `techHooks` 时暴露 E1 测试入口（与 E2 科技页同一命令） |
| `scene-owner.pack.ts` / `shared/asset-refs.ts` | 挂载 `plugin/tech`（inventory 之后、所有门控使用者之前）；新增科技包稳定 GUID |
| 契约测试 4 文件 | 配方表 13→19、锻压 11→17 的断言同步（只追加，不删除/弱化） |

### 2.3 新增/修改 — 测试与脚本

- 新增单测 6 文件 / 103 例（见测试报告）。
- 新增 `scripts/p2e-tech-core.mjs`（player 模式真实游戏验收，420 步）。
- 新增 `scripts/legacy-mode.mjs` + 迁移 18 个既有入口脚本（仅加启动步骤，不改断言）。

---

## 3. 12 个科技节点的实际实现状态

全部 12 个节点数据已落地并通过校验；「玩法效果」列说明 E1 的真实可玩影响。

| # | 节点 ID | 名称 | 阶段/路线 | 前置 | 交付（件） | 解锁 | E1 玩法效果 |
|:--|:--|:--|:-:|:--|:--|:--|:--|
| T1.1 | `tech:gear-manufacture` | 齿轮制造 | 1/P | — | 铁锭3 + 传动轴2 | `forge-gear-12`、`forge-gear-24` | 锻压机 R 循环出现齿轮配方，可真实锻齿轮 |
| T1.2 | `tech:chute-logistics` | 溜槽物流 | 1/I | T1.1 | 传动轴2 + 齿轮12×2 + 碎铁矿3 | `forge-chute` | 可制造重力溜槽 |
| T1.3 | `tech:cross-level-drive` | 跨层传动 | 1/P | T1.1 | 齿轮24×2 + 传动轴2 + 铁锭2 | `forge-vertical-drive` | 可制造立式传动带 |
| T1.4 | `tech:input-interface` | 输入接口盒 | 1/I | T1.2 | 溜槽1 + 铁锭3 | `forge-interface-box`、`port.through`、能力 `port-input-install` | 可锻造接口盒；`T` 安装输入盒生效 |
| T2.1 | `tech:output-interface` | 输出接口与物料连接 | 2/I | T1.4 | 基础盒2 + 铁锭4 | `forge-output-box`、`port.output`、能力 `port-output-install`/`material-link` | `O` 安装输出盒；`J/H` 建链/解链生效 |
| T2.2 | `tech:split-merge` | 分流与合流 | 2/I | T2.1 | 输出盒1 + 基础盒1 + 铁锭3 | `forge-splitter-box`、`forge-merger-box`、`port.splitter`/`port.merger`、能力 `split-merge` | `K/L` 安装分流/合流盒生效 |
| T2.3 | `tech:core-replication` | 加工核心批量制造 | 2/I | T2.1 | 传动轴1 + 齿轮12×2 + 铁锭4 | `forge-crusher`、`forge-smelter`、`forge-processing-core` | 可复制三台加工核心，能开多机产线 |
| T2.4 | `tech:flywheel-production` | 飞轮储能机制造 | 2/P | T1.3 | 齿轮24×2 + 传动轴2 + 铁锭3 | `forge-flywheel` | 可制造第二台飞轮（**独立动力网络**，不并联） |
| T2.5 | `tech:structure-assembly` | 结构框架与组合机械 | 2/C | T2.2 + T2.4 | 输出盒1 + 合流盒1 + 传动轴2 + 铁锭4 | `forge-structure-frame`、machine `structure_frame`、structure `structure.frame`、能力 `assembly` | 可制造结构框架；`P` 模式与组合机械生效 |
| T3.1 | `tech:batch-processing` | 标准化批量加工 | 3/I | T2.3 | 传动轴2 + 齿轮24×2 + 铁锭4 | `forge-batch-shaft`、`forge-batch-interface-box`、`forge-batch-structure-frame` | 批量配方可切、可产出多件（2/3/2） |
| T3.2 | `tech:line-integration` | 多级产线整合 | 3/C | T2.5 + T3.1 | 破碎机1 + 熔炼炉1 + 锻压机1 | 能力 `line-diagnostics` | 能力位已解锁；**诊断视图属于 E3**，E1 只保留能力查询 |
| T3.3 | `tech:combined-works` | 联合工厂总成 | 3/C | T3.2 | 传动轴6 + 基础盒3 + 输出盒1 + 分流盒1 + 合流盒1 + 结构框架3 + 立式带1 | 项目 `combined-works` | 项目位已解锁；**终局判定/结算属于 E3** |

- 阶段分布 4/5/3；路线分布：动力 3、工业 6、交叉 3；所有前置无环且不跨阶段跳跃（校验器强制）。
- 节点 ID 与 P2-E0 设计一致；未删减、未改结构。

---

## 4. 状态机与交付事务（实现说明）

- **状态全部派生**（不存冗余状态）：
  - `locked`：前置未全部 completed；
  - `available`：前置满足、无交付；
  - `researching`：前置满足、有交付但未集齐；
  - `completed`：`unlocked` 集合包含该节点。
- **持久化只存** `delivered / unlocked / trackedId / mode` 四项（`TechState v1`）。
- **单物品交付事务**：`submit` 先全量校验（节点存在/状态/物品是需求项/正整数/不超剩余/库存充足）→ `inventory.remove` → 写进度；`remove` 失败则状态不变（原子）。
- **一键交齐**：`submitAll` 先逐项 `has` 预检，再逐项 `remove`；任一步失败按逆序 `add` 回滚，状态不变。
- **不可逆**：已提交材料不返还；已完成节点拒绝再次提交；计数按需求 clamp。
- **幂等恢复**：`restore` 丢弃未知节点/物品、clamp 计数、按前置闭包剔除非法已解锁节点；重复恢复结果相同。

---

## 5. 五类门控的实际接入位置

| 门控类别 | 接入点 | 行为 |
|:--|:--|:--|
| 配方解锁 | `production.ts` `availableRecipesFor/activeRecipe/cycleRecipe/ensureRecipeSelected`（12/81/124/100 行）；`production-runtime.ts` 注入 `isRecipeUnlocked`（89 行） | 未解锁配方不参与加工、不出现在 R 循环、不可投料；`BASE_RECIPE_IDS`（破碎/熔炼/锻轴）开局即解锁，保证教学链 |
| 加工核心制造 | 配方门控（`forge-crusher/smelter/processing-core` 由 T2.3 解锁） | 未解锁时锻压机 R 循环里没有这三条配方，无法复制核心 |
| 机器/结构放置 | `mechanical.pack.ts` `selectedItem`(263)/`place`(333)/`canPlacePart`(369)/`placePart`(377)；`assembly-system.ts` `placeFrameAt`(250)、`P` 模式(269) | 未解锁的机器/结构不可进入放置模式、不可放置（业务入口检查，不是 UI 隐藏）；`structure_frame` 在 T2.5 前不可放置 |
| 接口盒与物流 | `port.pack.ts` `installModule`(144-145：`isPortUnlocked` + 能力)、`linkAction`(173)、`unlink`(198) | 未解锁时 T/O/K/L/J/H 全部无效；配方门控保证盒本身也造不出来 |
| 特殊建造/交互能力 | `assembly` 能力（P 模式/组合）、`line-diagnostics`（T3.2，E3 消费）、`project combined-works`（T3.3，E3 消费） | 能力查询已接入服务；E1 不实现诊断 UI 与终局结算 |

> 防绕过：门控在运行时每个业务入口实时查询 `tech` 服务；UI 只是读取快照。
> 不存在「隐藏按钮但仍可调用」的路径。E1 的测试入口 `tech/submit` 走的是**同一真实事务**，不做解锁绕过。

---

## 6. 起步包与旧原型套件迁移

### 6.1 正式起步包（继承工坊）

9 项 / 21 件：传动轴 8、12 齿 4、24 齿 2、溜槽 2、立式传动带 1、手摇飞轮 1、破碎机 1、熔炼炉 1、锻压机 1。
快捷栏：槽 0/1/2/6/7/8/9/10/11，**5 号槽保持空槽**；3/4 号槽（旧测试动力源/冲压机）在正式流程为空。
**不发放**：接口盒、结构框架、测试动力源、冲压机、任何科技解锁产物。

### 6.2 旧套件（legacy 兼容模式，仅验收脚本）

- 旧 `PROTOTYPE_KIT`（24/6/4/4/5/3/2/3/3/1/1）+ 接口盒 9 + 结构框架 4 作为**兼容模式**套件保留；
- 进入方式只有一种：验收脚本在页面加载前注入 `globalThis.__II_TEST_FLAGS__ = { progression: 'legacy' }` 并 reload；
  前端在 hello 上报 → 引擎 tech 切换 legacy（门控放行）+ mechanical 转换套件 + ports/assembly 补发；
- 正式玩家页面不设置该全局，**没有任何快捷键、UI、协议命令能切换到 legacy**；
- 迁移 18 个既有入口脚本，只加启动步骤；断言一条未改（详见兼容性报告）。

### 6.3 行为变化

- 新开局只有 1 台破碎机/熔炼炉/锻压机与 1 台飞轮（旧开局是 3/3/1 与多套件）；
- 接口盒、结构框架、核心复制、齿轮/立式带/溜槽/飞轮的制造全部由科技节点解锁；
- 调试件（测试动力源、冲压机）不进入正式流程，代码保留供旧测试/legacy 使用。

---

## 7. GameRead 接入

- 仍然只有唯一 read `mechanical`；新增只读字段 `tech`（`mechanical/runtime.ts:142`）：
  `{ mode, nodes: [{ id,name,stage,route,status,requires,cost,delivered,unlocks }], unlocked, trackedId }`。
- 快照每帧由 `tech.snapshot()` 生成；节点状态派生，不会出现两份互相矛盾的进度。
- UI 侧：状态消息已携带 `tech`（协议仍为 v1，字段可选，E1 前端不渲染）；命令 `tech/submit|submit-all|track` 已加入协议解析，供 E2 科技页直接复用。
- 验收脚本从 `play.state('mechanical').tech` 读取，证明机器可读。

---

## 8. 持久化边界（详见 P2-E1-PERSISTENCE-REPORT）

- 静态定义：节点数据是编译期常量，不进存档。
- 玩家进度：`TechState`（version/mode/delivered/unlocked/trackedId），纯 JSON，无类实例/Map。
- 接口：`tech.serialize()` / `tech.restore(raw)`；restore 返回修复记录（未知节点/物品、clamp、闭包修复）。
- **未实现**：存储通道与自动保存（项目还没有存档系统）；本阶段没有新建临时持久化系统。E2/E3 与存档 P0 对接。

---

## 9. 已知问题与未完成事项

| # | 项 | 说明 / 影响 | 归属 |
|:--|:--|:--|:--|
| K1 | 没有科技 UI | E1 只提供只读快照与协议命令；玩家不可通过正式界面交付 | E2 |
| K2 | 无终局判定/结算 | T3.2 能力、T3.3 项目只有数据与查询；运行证明未实现 | E3 |
| K3 | 无存档落盘 | 刷新丢科技进度；restore 接口与单测已就绪 | 存档 P0 / E3 |
| K4 | 飞轮配方为单输入简化 | E0 §4.9 原设计 10 铁锭 + 2 齿轮24；运行时只支持单输入，实现为 12 铁锭（价值等价），已在 recipes.ts 注释 | E1 决策，需验收确认 |
| K5 | `cycleRecipe` 只有 1 条已解锁配方时返回 true（自环不变） | 无可见影响（R 键看起来没反应）；改动需同步测试 | 可选优化 |
| K6 | m17a 存在 P2-C 遗留断言债 | 该脚本在 P2-E1 之前就红（套件 power_source 2→4 后旧断言仍写死），非本次引入；E1 未修改其断言 | 独立小修 |
| K7 | legacy 模式是测试专用门控放行 | 仅验收脚本可达，正式路径不可达；需在 E2 说明并在文档保留 | 设计决策 |
| K8 | 矿石/成本平衡未调 | 三阶段材料预算与矿量调整属于 E3 | E3 |
| K9 | T3.2/T3.3 能力无消费者 | capability/project 已登记，等待 E3 的 UI 与结算 | E3 |

---

## 10. Git 与提交

| 提交 | 内容 |
|:--|:--|
| `db02e0d` | feat(P2-E1)：科技树数据/状态/交付事务与五类门控（源码 21 文件） |
| `81b1866` | test(P2-E1)：科技树 6 组单测（103 例）与配方契约同步 |
| `b67e075` | test(P2-E1)：旧验收脚本 legacy 兼容迁移 + player 模式科技验收脚本 |

- 报告提交（本文等 4 份 + PROGRESS 快照）另有一次 docs 提交，最终 HEAD 以最终答复与 `git log` 为准。
- 未改写历史、未删除既有报告、未创建 tag；工作区在报告提交后保持 clean。
- 大文件：`assets/mechanical/mechanical.pack.ts` 24,131 B（P2-D 时已 22,156 B 的历史超大文件，本次增量小），提交沿用项目 `BIG_FILE_LIMIT=40960` 机制，未用 `--no-verify`；新增文件全部 < 20 KB。
