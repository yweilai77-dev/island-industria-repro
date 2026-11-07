# M1.8 实施方案（阶段 A 调查 + 阶段 B 方案）

> 基线：HEAD `076eb20`，工作区 clean，tags `m17c-baseline` / `m17c-final` / `m17c-rev1-wip` / `m17c-rev2-wip`。
> 用户已确认的 4 项玩法决策：
> 1. **M1.8-A = A2**：可建造楼板 + 楼梯 + 开孔（明确授权范围扩大）。
> 2. **M1.8-B = B1**：手摇飞轮储能机（能量池，摇动摇柄储能，耗尽停转）。
> 3. **M1.8-C/D = C1**：两级加工（破碎机 + 熔炼炉）+ 无动力重力溜槽。
> 4. **M1.8-E = D1**：铁锭可反哺制造机械零件。

---

## 1. 当前已有能力清单（只读调查结论）

| 域 | 已有 | 证据 |
|:--|:--|:--|
| 网格/放置 | `Placement{gx,gz,level,rotation,w,d}`，1 格 1m，层高 3m，AABB 合法性 | `assets/grid/grid.ts`、`assets/build/build.ts` |
| 三维索引 | `SpatialIndex`（宽相位键 `gx,gz,level` + 精确 AABB）、`StructureRegistry`（blocksBuild/blocksPlayer） | `assets/spatial/occupancy.ts`、`structure.ts` |
| 支撑/通行 | `SupportRegistry`（level+worldY+cells，buildable/walkable）、`TraversalRegistry`（楼梯数据） | `assets/spatial/support.ts` |
| 玩家垂直 | `resolveWithSliding`：平面↔楼梯切换、容差判定；**玩家碰撞已有 `blocksPlayer` 消费者** | `assets/player/vertical.ts`、`player.pack.ts:153` |
| 机械零件 | shaft / gear_12 / gear_24 / power_source / machine；端口轴向+齿轮啮合 | `assets/mechanical/parts.ts`、`ports.ts` |
| 动力 | 单源树状网络、闭环拒绝、速度下垂、支路/整网过载、`solvePower` 纯函数 | `assets/mechanical/power.ts` |
| 运行时 | `MechanicalRuntimeState`（revision 缓存 + 开关 + 角度积分 + 纯 JSON 快照） | `assets/mechanical/runtime-state.ts` |
| GameRead | 只有一个 read `mechanical` | `assets/mechanical/runtime.ts:40` |
| 物品/库存 | 6 个 ItemId；库存纯逻辑 + 服务；8 格快捷栏；DOM 背包 | `assets/items/items.ts`、`inventory.ts`、`hotbar.ts` |
| 采集 | 4 个矿点 ×20 = **总储量 80**，采完不刷新 | `assets/resource/resource.ts` |
| 固定结构 | 平台 level1 x[0,8) z[2,8) 厚 0.3（y[2.7,3]）+ 固定楼梯 x[-4,0) z[3,4) | `assets/spatial/structures.ts` |
| 存档 | **无**（全部内存），`docs/design/SAVE-ARCHITECTURE.md` 已给最小方案 | 该文档 |

## 2. M1 缺口矩阵（M1.8 要补的）

| 缺口 | 现状 | M1.8 方案 | 阶段 |
|:--|:--|:--|:--|
| 跨层传动 | 零件高 1m、端口锚点 `base+0.5`，跨层无法重合 | 新增 **垂直传动带**（高 3m，端口在 localY 0.5 与 3.5，轴向 X）→ 与上下层水平轴端口锚点精确重合，无需锥齿轮 | A |
| 平台开孔 | 平台是单一 8×6 碰撞体，开不了孔 | 楼板改为**逐格**注册；新增**开孔楼板**：level+1 注册 `kind:'opening'` 支撑面（buildable=true / walkable=false）且**不注册碰撞体** | A |
| 玩家自建多层 | 不能建楼板/楼梯 | 新增 3 种建筑：**支柱**(1×1×2.7)、**楼板**(1×1×0.3，顶面=level+1)、(**楼梯**(4 格跑，8 级，0.375/0.5) | A |
| 正式动力源 | 只有「测试动力源」，无能量概念 | **手摇飞轮储能机**：能量池 + `F` 摇柄 + 右键离合启停 + 耗尽停转 | B |
| 加工机器 | 冲压机只有曲柄动画，无物品 | **破碎机**(iron_ore→crushed_ore)、**熔炼炉**(crushed_ore→iron_ingot)、**锻压机**(iron_ingot×2→part)，真实缓冲/进度/动力需求 | C |
| 物品运输 | 无 | **重力溜槽**（1×1、有方向、可串联、t∈[0,1] 真实位置、堵塞等待不丢物品） | D |
| 生产闭环 | `iron_ore` 只进不出 | 矿石→碎矿→铁锭→(锻压)→传动轴/溜槽… 产物进正式库存 | E |
| 存档 | 无 | **本阶段不实现**：生产闭环不依赖存档（单次会话可完成）。归档为 M2 P0，方案见 SAVE-ARCHITECTURE.md | — |

## 3. 关键设计决策（本次实施）

### 3.1 垂直传动带（代替锥齿轮）
- 定义：`PartDef{ id:'vertical_drive', kind:'shaft', height:3.0, maxTorque:150 }`；
  ports：`bottom`(axis x, face nx, localY 0.5)、`top`(axis x, face px, localY 3.5)。
- 几何验证：底部锚点 `(gx, 3L+0.5, gz+0.5)` 与 **level L** 相邻水平轴端口重合；顶部锚点
  `(gx+1, 3L+3.5, gz+0.5)` 与 **level L+1** 水平轴端口重合。因此**不需要新的连接类型、不需要锥齿轮**，
  复用现有 `matchAxial`（轴向、锚点重合、法线相反、轴平行）。
- 可叠层：level L 的 `top` 与 level L+1 的 `bottom` 锚点同为 `(gx+1, 3(L+1)+0.5-3+3?)` → 实际同为
  `3L+3.5`，法线 +X / -X 相反、轴平行 → 自动连成一条链，可继续上到 level 2。
- 动画：`worldAxis` 取 `ports[0].axis='x'` → 绕 X 自转（皮带轮），语义正确。
- 穿层：其 AABB 为 y[3L, 3L+3]，与楼板薄板 y[3L+2.7,3L+3] 相交 → 该格必须是**开孔楼板**。

### 3.2 开孔楼板（合法穿层结构）
- `SupportKind` 增加 `'opening'`。opening 支撑面：`level = L+1`、`worldY = 3(L+1)`、
  `buildable = true`、`walkable = false`、`cells = [cell]`、**不注册碰撞体**。
- 作用：上层机械零件可在孔上放置（有 buildable 支撑）；玩家不会走进孔（walkable=false →
  `selectFlatSupport` 过滤掉 → `resolveMove` 返回 `moved:false`，玩家被挡在孔外，不需要重力）。
- 视觉：四边细框（0.08 厚）标出孔口。
- 支撑规则（与楼板相同）：本格 level L 有支柱，或相邻格 level L+1 已有楼板/开孔。

### 3.3 支柱 / 楼板 / 楼梯
| 建筑 | 足迹 | 垂直范围 | 注册 |
|:--|:--|:--|:--|
| 支柱 `pillar` | 1×1 | y[3L, 3L+2.7] 高 2.7 | 碰撞体 blocksBuild+blocksPlayer |
| 楼板 `deck` | 1×1 | y[3L+2.7, 3L+3.0] 厚 0.3 | 碰撞体(同上) + SupportSurface(level L+1, buildable+walkable) |
| 开孔 `opening` | 1×1 | 同上薄板但无实体 | SupportSurface(level L+1, buildable, **not walkable**) + 框线视觉 |
| 楼梯 `stair` | 4×1（按 rotation） | y[3L, 3L+3] | 碰撞体(blocksBuild) + TraversalSurface(L→L+1, 8 级) + 8 级台阶视觉 |
- 楼板/开孔的**建造等级 = 玩家当前层 L，但产出物位于 L+1**；因此目标格仍用 level L 的支撑面拾取，
  放置合法性额外检查「L+1 薄板体积无碰撞」+「支撑规则」。
- 楼梯：`stepCount=8, stepRun=0.5, stepRise=0.375` 满足 `TraversalRegistry` 的两条守恒校验。

### 3.4 手摇飞轮储能机（正式动力源）
- 新零件 `flywheel_source`，`kind:'power-source'`，ratedRpm 60，maxTorque 100。
- 状态：`clutchEngaged`（右键离合）、`energy`（0..300）、`winding`（按住 F）。
- 交互：玩家水平距离 ≤ 2.2m 时按住 `F` 摇动 → `energy += 45/s`；输出时
  `energy -= 6 + 14 × (demand/capacity) /s`；`energy <= 0` → 自动断开输出（机器停转）。
- 功率语义：`solvePower` 只看 `sourceEnabled`，运行时把 `sourceEnabled = clutch && energy>0`。
- 旧「测试动力源」保留（历史 playthrough 依赖 slot 4），两者共存，物品描述区分。

### 3.5 加工机器与配方
| 机器 | 输入 | 输出 | 时长 | loadTorque | 缓冲 |
|:--|:--|:--|:--|:--|:--|
| 破碎机 `crusher` | iron_ore ×1 | crushed_ore ×1 | 4s（按 rpm 线性缩放） | 18 | in 4 / out 4 |
| 熔炼炉 `smelter` | crushed_ore ×1 | iron_ingot ×1 | 6s | 24 | in 4 / out 4 |
| 锻压机 `forge` | iron_ingot ×2 | 可选配方产物 ×1 | 5s | 22 | in 6 / out 4 |
- 加工必须 `poweredMachines.has(id)`；失去动力 → 暂停（`blocked-no-power`），进度保留；
  输出缓冲满 → 暂停（`blocked-output-full`）；输入不足 → 待机（`idle-no-input`）。
- 输入：手持可接受物品右键机器 → 投入 1 个；右键手持空/不可投 → 取出全部产出到库存。
- 配方切换：悬停机器按 `R` 循环配方（锻压机 3 个配方），读数显示配方名+进度。
- 产物出口：机器 `+X` 侧（本地 +X，随 rotation 旋转）相邻溜槽自动接取。

### 3.6 重力溜槽
- 新零件 `chute`，`kind:'transport'`，**无端口 → 不进入动力拓扑**（`buildPowerTopology` 跳过无端口零件）。
- 有方向（rotation），每格最多 1 件物品，`t∈[0,1]` 沿线移动，速度 1.2 m/s。
- 交接：`t→1` 时把物品交给下一格（溜槽 → 溜槽 / 溜槽 → 机器输入侧 / 溜槽 → 库存箱）。
  下一格不可接收则停在 `t=0.92` 等待，**不丢物品**。
- 机器输出缓冲满时不再向溜槽推 → 加工暂停并显示 `blocked-output-full`。

### 3.7 物品与反哺（D1）
- 新增 ItemId：`crushed_ore`（碎铁矿）、`iron_ingot`（铁锭）、`vertical_drive`、`crusher`、`smelter`、`forge`、`chute`。
- 锻压机配方：`2 铁锭 → 1 传动轴`、`3 铁锭 → 1 立式传动带`、`4 铁锭 → 1 溜槽`。
- 初始套件保留原 5 项（保证 m17a/b/c 回归），新零件通过**背包**获取初始少量 + 生产制造补给。

### 3.8 GameRead
- 保留 `mechanical` read（向后兼容，只增字段）；
- 新增 read `production`：机器缓冲/进度/配方/产物、溜槽在途物品、铁锭累计产量（生产目标）；
- 新增 read `inventory`：物品总数快照（供验收脚本核对数量一致）。

### 3.9 楼层可见性
- 玩家站在 L 层时，所有 level > L 的**楼板/开孔/平台**薄板切换为半透明材质（alpha 0.3），
  避免俯视相机被上层楼板完全遮挡。机械零件不隐藏（保持"能看到楼上机器在转"）。

## 4. 功能依赖关系图

```
items.ts 扩充 ─┬─> parts.ts 新零件定义 ─┬─> ports.ts（vertical_drive 端口几何已验证无需改）
               │                        ├─> power.ts（跳过无端口零件、飞轮能量不影响纯解算）
               │                        ├─> runtime-state.ts（能量积分 + 机器加工 + 溜槽推进）*
               │                        └─> mechanical.pack.ts（放置/拆除事务、右键交互、F 摇柄）
               │                                        │
spatial 层开孔 ─┴─> support.ts(SupportKind+opening) ──┼─> build.pack.ts（楼板/支柱/楼梯/开孔建筑）─> structures.pack.ts（平台逐格 + 半透明）
                                                        │
recipes.ts（配方表）─> production.ts（纯加工状态机）───┴─> transport.ts（纯溜槽推进 + 交接）
                                                        │
                                        GameRead：production / inventory 投影
                                                        │
                                    单元测试（纯逻辑）→ typecheck → project check → 构建
                                                        │
                                    playthrough 脚本（真实鼠标键盘）→ 截图 → 15 分钟体验测试
```
`*` 加工/运输状态机本身是纯模块，runtime-state 只负责 tick 与合并。

## 5. 实施顺序

1. **A-1 纯逻辑**：`items.ts` 扩充；`build/floors.ts`（楼板/支柱/楼梯几何与合法性）；`spatial/support.ts` 开孔 kind；`structures.ts` 平台逐格化。
2. **A-2 建筑接线**：`build.pack.ts` 新建筑类型 + 逐格注册 + 楼梯可视化；`structures.pack.ts` 平台改逐格 + 半透明。
3. **A-3 机械接线**：`parts.ts` 加 `vertical_drive`；`mechanical.pack.ts` 放置事务支持 3m 高零件与开孔格。
4. **B**：`flywheel_source` + 能量积分 + F 摇柄 + 右键离合。
5. **C**：`recipes.ts` + `production.ts` + 三台机器 + 右键投料/取料 + 载入机械拓扑。
6. **D**：`transport.ts` + `chute` + 自动交接。
7. **E**：锻压机配方反哺 + 生产目标读数 + 全链路打通。
8. **验证**：单测 → typecheck → project check → 构建 → playthrough（m18a/m18b/m18c/m18d 四个脚本）→ 15 分钟体验测试 → 报告。
9. **交付**：`pnpm test` 全绿、工作区 clean、提交、更新 PROGRESS/ROADMAP。

## 6. 每阶段预计改动文件

| 阶段 | 新增 | 修改 |
|:--|:--|:--|
| A | `assets/build/floors.ts`、`assets/__tests__/floors.test.ts` | `spatial/support.ts`、`spatial/structures.ts`、`spatial/space.ts`(如需)、`build/build.ts`、`build/build.pack.ts`、`spatial/structures.pack.ts`、`mechanical/parts.ts`、`mechanical/mechanical.pack.ts`、`items/items.ts`、`hotbar/hotbar.ts`(10 格)、`frontend/*` |
| B | — | `mechanical/parts.ts`、`runtime-state.ts`、`runtime.ts`、`visuals.ts`、`animation.ts`、`readout*.ts`、`items/items.ts` |
| C | `assets/production/recipes.ts`、`assets/production/production.ts`、`assets/__tests__/production.test.ts` | `mechanical/parts.ts`、`runtime-state.ts`、`runtime.ts`、`mechanical.pack.ts`、`items/items.ts` |
| D | `assets/production/transport.ts`、`assets/__tests__/transport.test.ts` | `runtime-state.ts`、`runtime.ts`、`mechanical.pack.ts`、`items/items.ts`、`visuals.ts` |
| E | — | `production/recipes.ts`、`runtime-state.ts`、`runtime.ts`、`frontend/*`、`docs/*` |

## 7. 风险与已知限制

| 风险 | 影响 | 处置 |
|:--|:--|:--|
| 俯视相机下二楼遮挡一楼 | 玩家看不见机器 | 上层楼板半透明（3.9） |
| 楼板是悬挑结构，无真实受力 | 支撑规则只是「有支柱或相邻楼板」 | 写入已知限制；M2 再做结构力学 |
| 快捷栏 8→10 格 | `hotbar.test.ts` 与前端布局需同步 | 同阶段更新测试与 UI |
| 80 个矿石总储量 | 生产链只能跑有限次数 | 每条链消耗 1 矿石；80 次足够 15 分钟演示；M2 考虑再生 |
| 机械零件用 Box/Cylinder 拼装 | 新增 3 台机器+溜槽会加实体数 | 每台机器 ≤8 实体，目标 <100 实体 |
| playthrough 需真实鼠标点击多层 | 坐标易碎 | 用「先站到目标层→再按同一屏幕点映射不同世界点」的确定性布局；失败即报 step 名 |
| 存档未实现 | 刷新即重置 | 明确归档 M2 P0；本阶段闭环不依赖 |

## 8. 测试与验收方案

- **单元测试**（新增）：`floors.test.ts`（楼板/支柱/楼梯几何与合法性、开孔支撑语义）、
  `vertical-drive.test.ts`（跨层端口锚点重合与轴向连接、叠层）、`flywheel.test.ts`（能量池收支与耗尽停转）、
  `production.test.ts`（加工进度/暂停/恢复/缓冲满/配方切换/不重复生成不丢失）、
  `transport.test.ts`（在途位置、交接、堵塞不丢物品）。
- **回归**：现有 31 个测试文件全绿（尤其 `support/vertical/structures/build/mechanical*`）。
- **工程门**：`pnpm typecheck`、`pnpm exec forgeax project check --json`、`pnpm test`、`pnpm exec forgeax project build`。
- **浏览器验收**（真实输入，脚本见 `scripts/m18*.mjs`）：
  - `m18a-crosslevel.mjs`：建支柱→楼板→开孔→楼梯→上楼→立式传动带→一楼源驱动二楼机器；断开/拆除回归。
  - `m18b-flywheel.mjs`：摇柄储能→离合启动→耗尽停转→再摇恢复。
  - `m18c-production.mjs`：投矿→破碎→溜槽→熔炼→铁锭入库存，数量一致；断电动停/恢复。
  - `m18d-loop.mjs`：铁锭→锻压→传动轴→入库→用于建造，整链重复 2 次。
  - 每个脚本按需求逐条断言并截命名图。
- **15 分钟完整体验**：从空手采集开始，按任务书 §5 端到端流程实操并记录每步操作/阻碍/状态/结果。
