# M1.8 空间/支撑系统调查报告：楼板开孔（平台格可被垂直传动轴穿透）

> 调查人：spatial-probe（只读调查）
> 调查时间：2026-11-07
> 基线：HEAD `076eb20`，工作区干净；`pnpm test` = **31 文件 / 314 用例全绿**（17:04 实测），`pnpm typecheck` 退出码 0。
> 结论标注约定：**【事实】**= 读代码/跑只读命令得到的确定结论；**【建议】**= 实现取向，不是现状。
> 行号均指当前 HEAD 文件。

---

## 0. 结论先行（TL;DR）

1. **【事实】平台是"一个支撑面 + 一个碰撞体"的数据模型，没有孔洞/负向语义。** 平台支撑 `PLATFORM_SUPPORT` 是单 id `support:platform`、48 格、level 1 / worldY 3（`assets/spatial/structures.ts:13-37`）；平台碰撞是单 id `structure:platform`、单个 AABB `x[0,8] y[2.7,3] z[2,8]`（`assets/spatial/structures.ts:39-49`）。`SupportRegistry` 的查询全部是"存在即支撑"，没有 overlay/负向/优先级字段，所以**孔洞只能靠"该格没有支撑记录"表达**，不能靠再加一个 surface 表达（`assets/spatial/support.ts:119-141`）。
2. **【事实】开孔真正卡住的只有"高 ≥2.7m 的零件"**：平台板 AABB 的 y 范围是 `[2.7,3]`，1m 零件在平台下合法（`assets/__tests__/structures.test.ts:60-64`），2.8m 零件被平台碰撞体判 `occupied`（`assets/__tests__/structures.test.ts:66-70`、`assets/__tests__/build-3d.test.ts:39-43`）。跨层立式轴若高 3m/3.5m，必须把该格从平台碰撞体里排除。
3. **【事实】`blocksPlayer` 已经有消费者，`PROGRESS.md:48` 与 `structure.ts:7` 的注释过时。** 玩家移动系统在 `assets/player/player.pack.ts:153-161` 把 `isBlockedMove` 接到 `spatial.structures.all()` 里所有 `blocksPlayer=true` 的 AABB；`blocksPlayerMove` 实现在 `assets/player/occupancy.ts:65-86`。平台/楼梯自身 `blocksPlayer=false`（`assets/spatial/structures.ts:48,134`），所以"自建建筑/平台不阻挡玩家"成立，但"没有 blocksPlayer 消费者"不成立。
4. **【事实】玩家不会掉进孔洞，只会被"空气墙"挡住。** `resolveMove` 在没有可行支撑时返回 `{ moved: false }`（`assets/player/vertical.ts:306-313`；其他失败分支同样返回 `moved:false`，如 `:287`、`:292`、`:296-302`），`resolveWithSliding` 再尝试 X-only / Z-only（`assets/player/vertical.ts:320-331`）。全程无重力、无跳跃，`feetY` 只来自支撑面 `worldY` 或楼梯踏面。行为等价于平台边缘（`assets/__tests__/vertical.test.ts:169-172`、`:293-302`）。
5. **【事实】`pickSupportTarget` 不会"穿透到下一层"**：它只遍历 `support.level === 目标 level` 且 `buildable` 的支撑面（`assets/spatial/picking.ts:41-42`），射线与支撑面平面求交后要求落点格在 `support.cells` 内（`:43-50`）。孔洞格若从平台 cells 里删除，则 level 1 的拾取返回 `undefined`（无目标、无幽灵、不能放建筑/零件），**不会**回落到 level 0 地面；且它完全没有遮挡判定（不检查射线是否先撞平台），这也是现在就能瞄准平台下方地面放 1m 零件的原因。
6. **【事实】`SpatialIndex.registerStructure(id, aabb)` 每个 id 只支持一段 AABB，重复 id 直接抛错**（`assets/spatial/occupancy.ts:59-66`）；`SpatialRecord` 只有单个 `aabb`（`:22-30`）。逐格碰撞体必须用多个 id 分别注册；不能一个 id 挂多段。`idsAt(cell, level)` 是单格单层调试查询（`:189-192`）。
7. **【事实】层级宽相位对"恰好 3m 高"的零件只登记 level 0**：`levelsForSpan(0, 3) === [0]`（`assets/spatial/space.ts:79-83`；断言 `assets/__tests__/space.test.ts:87`），3.5m 才是 `[0,1]`；且 AABB 恰好贴面不算碰撞（`assets/spatial/space.ts:102-111`，断言 `assets/__tests__/space.test.ts:96-104`）。跨 slab 的 4m 高零件登记 `[0,1]` 有测试覆盖（`assets/__tests__/occupancy.test.ts:61-67`）。
8. **【事实】"高 3m、轴向 Y、端口 localY=0 和 3"的立式轴与现有端口/连接规则都接不上。** 所有现有端口 `localY = PORT_HEIGHT = 0.5`（`assets/mechanical/parts.ts:56-57,84-161`），锚点 y = `levelBaseY(level) + localY`（`assets/mechanical/ports.ts:69,88-92`）。因此该轴在 level 0 的锚点是 y=0/3，而水平轴在 level 0/1 的锚点是 y=0.5/3.5，`matchAxial` 要求锚点重合（`ports.ts:130`）→ 全部不匹配；并且 Y 轴端口与现有 X 轴端口 `dot(axis)=0`，被"轴平行"条件拒绝（`ports.ts:128`），`matchGearMesh` 同样要求轴平行（`ports.ts:137`）。**现有连接模型没有任何直角/锥齿轮传输能力。**
9. **【事实】`worldAxis` 取 `part.def.ports[0]`（`assets/mechanical/ports.ts:120-124`），是新零件最容易埋雷的一行**：它被动画用作自转轴（`assets/mechanical/animation.ts:12-16`），而功率网络用的是连接 ratio（`assets/mechanical/power.ts`），两者不共用同一份"轴"。多端口/多轴零件一旦 `ports[0]` 不是真实自转轴，零件会绕错误轴转。
10. **【事实】平台/楼梯的常量与注册路径几乎没有测试覆盖"生产注册"这一层。** 没有任何测试 import `assets/spatial/structures.pack.ts`（全仓 grep 只有它自己）；单元测试都是自己 `new StructureRegistry` + 手工注册 `PLATFORM_COLLIDER`（`assets/__tests__/structures.test.ts:22-27`、`assets/__tests__/build-3d.test.ts:10-16`）。因此"把生产注册从 1 个 AABB 改成逐格"本身**不会挂任何单测**，只有改动常量/导出签名才会挂；真正的回归风险在 playthrough 和"哪些常量被断言"。

**【建议】最小可行路线（详见 §9）**：静态孔洞（数据层 `PLATFORM_HOLE_CELLS`）+ 单一 `support:platform` id 但 cells 排除孔洞 + 平台碰撞体按格派生（保留旧 `PLATFORM_AABB/PLATFORM_COLLIDER` 导出给既有测试）+ 平台视觉板拆分 + 立式轴改成"高 3.5m、端口 localY=0.5/3.5、轴向 X 但视觉自转轴 Y"的两端接口件（或显式给 `def.spinAxis`）；玩家阻挡不需要改 `vertical.ts`。

---

## 1. 支撑面消费方全清单（`SupportRegistry` / `supportId`）

### 1.1 注册表 API 与语义（事实）

`assets/spatial/support.ts`：

| API | 行号 | 语义（事实） | 对孔洞的含义 |
|:--|:--|:--|:--|
| `register(surface)` | 72-95 | 校验 level 合法、`worldY === levelBaseY(level)`（M1.5 标准层高，`:77`）、cells 非空、id 不重复；按 `gx,gz` 建倒排 `byCell` | 孔洞**不要**用新 surface 表达 |
| `unregister(id)` | 97-108 | 删 surface 并从每格倒排移除 | 动态开孔需"注销→重注册同 id"（会短暂无支撑） |
| `get(id)` | 110-112 | 按 id 取 surface | 玩家当前支撑/建造层级依赖它 |
| `all()` | 114-116 | 全部 surface | 拾取遍历它 |
| `supportAt(cell, level)` | 119-128 | 该格该层第一个 `active && level===level` 的 surface；**不看 buildable/walkable/worldY** | 无记录=无支撑；只能删除记录 |
| `buildableSupportAt(cell, level, worldY)` | 131-142 | `active && buildable && level 相同 && |worldY-worldY|<=EPS` | 建造合法性逐格判定 |
| `hasBuildableSupport(placement)` | 145-152 | `cellsOf(placement)` 全部满足上一行 | footprint 全格判定 |
| `supportsAtPoint(x,z)` | 155-165 | 该世界点所在格的所有 `active` surface（不同层都返回） | 玩家落脚/跨层候选 |
| `supportAtKey` / `keyFor` | 168-184 | 调试别名，**全仓无调用点**（仅定义） | 与本任务无关 |
| `clear` / `size` | 172-179 | 清理/计数 | 测试用 |

> **【事实】没有任何"孔洞/负向/覆盖优先级"字段。** 若有人试图用"再注册一个孔洞 surface"表达孔，`supportAt` 会返回"第一个 active 的同层 surface"（`:121-127`，依赖 Set 注册顺序），`supportsAtPoint` 会把孔洞 surface 当成可走支撑（`:155-165`）——即 overlay 只能**增加**支撑，不能移除。

### 1.2 生产消费方（事实，按文件）

| 位置 | 使用的 API | 如何使用 level / worldY / cells | 开孔后需要的语义 |
|:--|:--|:--|:--|
| `assets/spatial/spatial.pack.ts:30-48` | `new SupportRegistry()`、`registerGroundSupport`、`insertResource(SUPPORT_REGISTRY_KEY)`、`clear()` | 创建唯一注册表并挂到 `spatial` 服务；地面由 MapConfig 全 32×32 格注册 | 平台孔洞不应动 ground surface（孔洞下方仍是 level 0 地面，玩家可走到平台下） |
| `assets/spatial/ground-support.ts:14-33` | `register` | 用 `config.cells()` 生成 `support:ground`（level 0 / worldY `groundTopY`） | 不变 |
| `assets/spatial/structures.pack.ts:78,87` | `register(PLATFORM_SUPPORT)` / `unregister` | 平台 surface 在启动时注册一次，销毁时注销 | 若孔洞动态变化，这里要能重注册；静态孔洞只需一次 |
| `assets/build/build.ts:91-98` | `buildableSupportAt(cell, level, baseY)` | 逐格：`cellsOf(placement)` 每格都要求同层同高可建造支撑，否则 `reason:'unsupported'` | 孔洞格自动变成 `unsupported`（无需新失败码） |
| `assets/build/build.pack.ts:195-201` | `supports.get(player.state.supportId)` | `currentBuildLevel()`：取玩家当前支撑的 `level`（要求 `active && buildable`），所有普通建造的拾取都用这个 level | 不变（玩家站在平台上就是 level 1；站地面就是 level 0） |
| `assets/build/build.pack.ts:586-609` | `pickSupportTarget(ray, targetLevel, supports)` + `createPlacement(..., target.level)` | 用目标 level 的支撑面把鼠标射线映射到格；孔洞格不会有 target | 孔洞上放建筑自动失效（无幽灵） |
| `assets/spatial/picking.ts:41-50` | `supports.all()` + `support.cells.some` | 只取 `active && buildable && level===目标层`；射线与 `support.worldY` 平面求交；落点 `worldToCell` 后必须在该 surface 的 cells 中；取最近 t，同 t 按 id 字典序 | **孔洞=该格不在任何目标层 surface.cells 中 → 返回 undefined**；不会穿透到下层（层过滤在 `:42`） |
| `assets/player/player.pack.ts:92-105` | `supportsAtPoint` + `selectFlatSupport` | 出生点选脚底 0 的可走支撑（当前是 ground） | 不变 |
| `assets/player/player.pack.ts:151,166-170` | `spatial.supports` 传入 `resolveWithSliding`；成功后写 `state.supportId` | 移动解析与状态更新 | 孔洞格无支撑 → 移动失败，`supportId` 不变 |
| `assets/player/vertical.ts:69-88` | `selectFlatSupport(candidates, currentId, feetY, tol)` | 过滤 `active && walkable`；当前 supportId 且高度差 ≤0.05 优先；否则高度差最小→level 高者→id 字典序 | 孔洞格：`supportsAtPoint` 无平台 → 只剩 ground（worldY 0，差 3m）→ 返回 undefined |
| `assets/player/vertical.ts:109-120` | `supports.get(id)` / `supportsAtPoint` | `currentFlatSupport`：优先按 id 取当前 surface；取不到再按点选 | 若孔洞只删 cells 不删 surface，`get(id)` 仍返回平台（玩家状态仍指向它）；下一次移动由 `:281-288/:306-313` 重新选格，`finish` 的 atPoint 检查（`:246`）兜底 |
| `assets/player/vertical.ts:212-255`（`finish`） | `supports.get(supportId)`、`supportsAtPoint` | 楼梯/平面成功前的最后校验：surface 必须 `active && walkable`、`|worldY-feetY|<=EPS`、`level===flat.level`、且该点确实有该 id（`:246`） | 孔洞格无记录 → `moved:false`；无需改函数 |
| `assets/player/vertical.ts:281-313` | `supportsAtPoint` + `selectFlatSupport` | 楼梯出口/平面移动的候选支撑选择 | 同上 |
| `assets/mechanical/mechanical.pack.ts:227-233` | `supports.get(player.state.supportId)` | `currentLevel()`：取玩家支撑的 level（要求 `buildable`），机械零件放置的目标层；`pickSupportTarget` 用这个 level（`:418-421`） | 不变；注意玩家站 platforms 上只能放 level 1，放 level 0 立式轴必须站地面 |
| `assets/spatial/spatial.pack.ts:36,46` | `SUPPORT_REGISTRY_KEY` | `world.insertResource` 写资源，销毁时删 | **【事实】该资源键全仓只有写入、没有读取方**（`support.ts:17` 定义，`spatial.pack.ts` 写/删；其余 grep 无消费者）——本次开孔不必走它 |
| `assets/spatial/service.ts:7` | 类型暴露 | `SpatialService.supports` | 不变 |

### 1.3 `supportId` 的所有使用点（事实）

- 类型/状态：`assets/player/player.ts:31`（`PlayerState.supportId`）、`assets/player/vertical.ts:29`（`VerticalState.supportId`）、`:50-56`（`VerticalMoveResult.success.supportId`）。
- 玩家：`assets/player/player.pack.ts:102`（初始）、`:146`（传给解析）、`:170`（成功后更新）。
- 竖直解析：`assets/player/vertical.ts:102-107`（`traversals.get`）、`:109-120`（`supports.get`）、`:242`（`finish` 取 surface）、`:246`（atPoint 复核）、`:281-288`/`:306-313`（选目标时把 `current.supportId` 作为"当前优先"传给 `selectFlatSupport`）。
- 建造：`assets/build/build.pack.ts:196-200`（`supports.get(supportId)` → level）。
- 机械：`assets/mechanical/mechanical.pack.ts:228-232`（`spatial.supports.get(supportId)` → level）。
- 拾取：`assets/spatial/picking.ts:10,55,60`（返回/同 t 排序用 `supportId`）。
- 测试：`assets/__tests__/support.test.ts`、`vertical.test.ts`、`player-blocking.test.ts`、`picking.test.ts`、`structures.test.ts`、`map-ground.test.ts`、`map-regression.test.ts` 中大量断言（见 §8）。

> **【建议】** 孔洞用"平台 surface 保留 id、cells 去掉孔洞格"实现，这样所有 `supportId` 断言和玩家 `supportId` 语义不变；不要拆成多个 support surface（拆分会改变 `supportId`、触发 `selectFlatSupport` 的"当前 id 优先"分支变化，并让 §8 大量断言失效）。

---

## 2. 结构碰撞体消费方全清单（`StructureCollider` / `spatial.structures` / `blocksPlayer` / `blocksBuild` / `isBlockedMove`）

### 2.1 定义与注册表（事实）

`assets/spatial/structure.ts`：

- `StructureCollider { id, aabb, blocksBuild, blocksPlayer }`：`:9-14`（单 AABB）。
- `register`：`:21-25`；**只有 `blocksBuild=true` 才进 `SpatialIndex`**（`:24`）。
- `unregister`：`:27-32`；`get/all`：`:34-40`；`clear`：`:42-47`。
- 文件头注释 `:4-7` 已过时（见 §2.3）。

### 2.2 所有使用点（事实）

| 位置 | 干什么 | 关键事实 |
|:--|:--|:--|
| `assets/spatial/spatial.pack.ts:33` | `new StructureRegistry(index)` | 与 `SpatialIndex` 同生命周期 |
| `assets/spatial/spatial.pack.ts:42` | `structures.clear()` | 销毁时统一清 |
| `assets/spatial/service.ts:10` | `SpatialService.structures` | 对外服务 |
| `assets/spatial/structures.pack.ts:79-80` | 注册 `PLATFORM_COLLIDER`、`STAIRS_COLLIDER` | 平台/楼梯注册路径 |
| `assets/spatial/structures.pack.ts:85-86` | 反注册两者 | 销毁路径 |
| `assets/mechanical/mechanical.pack.ts:135` | `for (const collider of spatial.structures.all())`，配合 `partIdFromStructureId` | `partAt(cell, level)` 的反查；逐格平台会让这里多扫 ~47 个 collider（可忽略） |
| `assets/mechanical/mechanical.pack.ts:166,199,283,324` | `unregister(structureIdForPart(partId))` | 机械零件更新/删除/回滚 |
| `assets/mechanical/mechanical.pack.ts:170,179,188,200,297,335` | `register({ id:'mech:N', aabb, blocksBuild:true, blocksPlayer:true })` | **机械零件同时挡建造和挡玩家** |
| `assets/mechanical/mechanical.pack.ts:454` | 销毁时遍历反注册 | 清理 |
| `assets/player/player.pack.ts:154-156` | `for (collider of spatial.structures.all()) if (collider.blocksPlayer) blocksPlayerMove(...)` | **`blocksPlayer` 的真正运行时消费者** |
| 测试 | `assets/__tests__/structures.test.ts:25,133,146-147,166,169`；`assets/__tests__/build-3d.test.ts:14`；`assets/__tests__/mechanical-ports.test.ts:137-139` | 结构注册表的单测都用合成 AABB，不加载生产 pack |

### 2.3 `blocksPlayer` 有没有消费者？——有（事实，纠错）

- `assets/player/player.pack.ts:153-161`：`isBlockedMove: (fromX, fromZ, toX, toZ, yMin, yMax) => { for (const collider of spatial.structures.all()) { if (!collider.blocksPlayer) continue; if (blocksPlayerMove(...)) return true; } return false; }`。
- `assets/player/occupancy.ts:65-86`：`blocksPlayerMove` 把 collider AABB 在 XZ 上按玩家半宽 0.35 膨胀，按脚底高度范围判断竖直重叠；玩家 AABB 半宽 0.35、高 1.0（`:12-13`）。
- 机械零件注册时全部 `blocksPlayer=true`（上表 6 处 register）。
- 平台/楼梯 `blocksPlayer=false`（`assets/spatial/structures.ts:48,134`）→ 平台/楼梯不阻挡玩家（符合 ROADMAP §7 的描述）。
- **过时说法**：`docs/PROGRESS.md:48` 写"`structure.ts` 注释：`blocksPlayer` 无消费者"；`assets/spatial/structure.ts:7` 也写着"当前 M1.5-B 没有玩家实体碰撞消费者"。两者都落后于 M1.7-A 的接线。**【建议】本次一并修文档/注释**（只改文字，不改行为）。

### 2.4 `blocksBuild` 的消费者（事实）

- 唯一消费者在 `assets/spatial/structure.ts:24,31,44`：`blocksBuild=true` 时转发到 `SpatialIndex.registerStructure/unregisterStructure`。
- `SpatialIndex` 的碰撞查询消费者：
  - `assets/build/build.ts:114`：`context.spatial.overlapsPlacement(placement, height, excludeBuildingId)` → 放置合法性 `occupied`。
  - 机械放置走同一条 `validatePlacement`（`assets/mechanical/mechanical.pack.ts:248-259`）。
  - `assets/build/build.pack.ts:393,437-441,470`：搬动模式释放/恢复/确认时直接 `registerBuilding/unregisterBuilding/overlapsPlacement`。
- 孔洞如果只从碰撞体排除该格、不改 blocksBuild 语义，建造合法性会立刻允许高零件通过（这正是开孔目的）。

### 2.5 `isBlockedMove` 的接线点（事实）

1. 类型声明：`assets/player/vertical.ts:35-46`（`VerticalWorld.isBlockedMove?`，注释明确"不传时行为与 M1.5 完全一致"）。
2. 调用点：`assets/player/vertical.ts:221-227`（`finish()` 内，y 范围取 `min/max(current.feetY, targetFeetY)`）。
3. 生产接线：`assets/player/player.pack.ts:153-161`。
4. 测试接线：`assets/__tests__/player-blocking.test.ts:25-45,87-115`（注入 blocker，验证扫掠不穿透、贴合滑动、楼梯高度变化传入）。

> **【事实】因此"孔洞格不能走进"有两条现成路径，都不需要改 `vertical.ts`：**
> - (a) 平台 support cells 去掉孔洞格 → `resolveMove` 直接返回 `moved:false`；
> - (b) 注册一个 `{ blocksBuild:false, blocksPlayer:true }` 的"孔洞守卫" AABB → 现有 `player.pack.ts:154-156` 循环自动生效。
> 注意 (b) 的高度比较是严格不等（`occupancy.ts:75`：`collider.max[1] > yMin`）：玩家站在平台 `feetY=3` 时，`max[1]=3` 的守卫**不挡**（3 > 3 为假），守卫必须高出平台面一点点（例如 `[gx,3,gz]..[gx+1,3.01,gz+1]`）；立式轴若自身高 3.5（顶面 3.5 > 3），其 `blocksPlayer=true` 的 collider 已经能挡住玩家，无需额外守卫。

---

## 3. 平台/楼梯硬编码清单，以及"改成逐格碰撞体"的测试影响

### 3.1 常量与 ID（事实）

`assets/spatial/structures.ts`：

| 常量/ID | 行号 | 值/说明 |
|:--|:--|:--|
| `PLATFORM_LEVEL` | 13 | `1` |
| `PLATFORM_WORLD_Y` | 14 | `3.0` |
| `PLATFORM_MIN_GX/MAX_GX/MIN_GZ/MAX_GZ` | 15-18 | `0/7/2/7`（8×6 格） |
| `PLATFORM_CELLS` | 20-26 | 48 格，行优先（gz 外层），首格 `{0,2}`、末格 `{7,7}` |
| `PLATFORM_SUPPORT` | 28-37 | id `'support:platform'`、level 1、worldY 3、kind `'platform'`、buildable/walkable/active 全 true |
| `PLATFORM_AABB` | 39-42 | `min [0, 2.7, 2]`、`max [8, 3, 8]`（板厚 0.3，顶面 y=3） |
| `PLATFORM_COLLIDER` | 44-49 | id `'structure:platform'`、blocksBuild true、blocksPlayer false |
| `MAIN_STAIRS` | 74-106 | id `'traversal:main-stairs'`、origin `{-4,3}`、east、4 格、8 级、stepRun 0.5、stepRise 0.375、AABB `[-4,0,3]..[0,3,4]` |
| `STAIRS_TRAVERSAL` | 108-128 | 由 `stairsTraversal()` 派生 |
| `STAIRS_COLLIDER` | 130-135 | id `'structure:main-stairs'`、blocksBuild true、blocksPlayer false |
| `stairStepTopY/stairStepCenter/stairWorldBounds/stairStepIndexAt` | 138-217 | 视觉与竖直移动共用 |

- ID 字面量全仓只有两处：`'support:platform'` 在 `structures.ts:29`；`'structure:platform'` 在 `structures.ts:45`（grep 确认无其他引用）。
- 常量引用文件（grep 计数）：`assets/spatial/structures.ts`（18）、`assets/spatial/structures.pack.ts`（8）、`assets/__tests__/structures.test.ts`（27）、`assets/__tests__/map-regression.test.ts`（17）、`assets/__tests__/vertical.test.ts`（9）、`assets/__tests__/picking.test.ts`（4）、`assets/__tests__/build-3d.test.ts`（4）、`assets/__tests__/player-blocking.test.ts`（3）。
- 楼梯常量引用：`structures.test.ts`（26）、`vertical.test.ts`（16）、`structures.pack.ts`（12）、`map-regression.test.ts`（10）、`structures.ts`（7）、`player-blocking.test.ts`（5）。
- 生产注册路径：`assets/spatial/structures.pack.ts:78-81`（support/collider/traversal 注册）、`:83-94`（销毁反注册）、`:38`（平台视觉 `createBoxGeometry(8, 0.3, 6)`）、`:47-54`（平台实体 `pos [4,2.85,5]`）。
- **【事实】平台视觉是一整块 8×0.3×6 的盒子**，开孔后必须拆成多块/带洞网格，否则"孔"只存在于数据里、看不见；该视觉没有单测覆盖（只有 playthrough 截图）。

### 3.2 "一个 8×6 碰撞体 → 逐格碰撞体"的测试影响（关键区分）

> **【事实】单测完全不加载生产注册路径**：全仓没有任何测试 import `structures.pack.ts`（grep 只命中它自身的 `build()` 描述）。测试都是 `new StructureRegistry(index)` 后手工注册 `PLATFORM_COLLIDER`（`assets/__tests__/structures.test.ts:22-27`；`assets/__tests__/build-3d.test.ts:10-16`）。
>
> 所以：**只改 `structures.pack.ts` 的注册方式（单 AABB → 逐格），314 个单测一个都不会挂。** 会挂的是下面三类"常量/导出被改"的情况。

**(A) 如果 `PLATFORM_AABB` 的值/形状被改（例如变成逐格数组、或删掉）——会挂：**

| 文件:行号 | 断言（原文） |
|:--|:--|
| `assets/__tests__/structures.test.ts:42-45` | `expect(PLATFORM_AABB).toEqual({ min: [0, 2.7, 2], max: [8, 3, 8] });` |
| `assets/__tests__/build-3d.test.ts:36` | `expect(PLATFORM_AABB).toEqual({ min: [0, 2.7, 2], max: [8, 3, 8] });` |
| `assets/__tests__/map-regression.test.ts:41` | `expect(PLATFORM_AABB).toEqual({ min: [0, 2.7, 2], max: [8, 3, 8] });` |
| `assets/__tests__/structures.test.ts:46-47` | `expect(PLATFORM_COLLIDER.blocksBuild).toBe(true);` / `expect(PLATFORM_COLLIDER.blocksPlayer).toBe(false);` |
| `assets/__tests__/structures.test.ts:9,11,25,146,166,169`；`assets/__tests__/build-3d.test.ts:6,14` | 若删除 `PLATFORM_COLLIDER`/`PLATFORM_AABB` 导出 → import 失败，整个文件不通过 |

**(B) 如果 `PLATFORM_CELLS` 本身缩水（把孔洞直接从 48 格列表里删掉）——会挂：**

| 文件:行号 | 断言（原文） |
|:--|:--|
| `assets/__tests__/structures.test.ts:31` | `expect(PLATFORM_CELLS).toHaveLength(48);` |
| `assets/__tests__/map-regression.test.ts:36` | `expect(PLATFORM_CELLS).toHaveLength(48);` |
| `assets/__tests__/structures.test.ts:34-35` | `expect(PLATFORM_CELLS[0]).toEqual({ gx: 0, gz: 2 });` / `expect(PLATFORM_CELLS.at(-1)).toEqual({ gx: 7, gz: 7 });`（若孔洞在首/末格） |
| `assets/__tests__/map-regression.test.ts:37-38` | 同上首/末格断言 |
| `assets/__tests__/map-regression.test.ts:46-48` | 遍历 `PLATFORM_CELLS` 断言每格 `MAP_CONFIG.containsCell`（删除格仍通过） |

**[建议] 不要动 `PLATFORM_CELLS`（保持 48 格几何真相），另加 `PLATFORM_HOLE_CELLS`，用 `PLATFORM_CELLS.filter(非孔)` 派生"可走/可建造 cells"。这样 (B) 全部不挂。**

**(C) 如果 `PLATFORM_SUPPORT.cells` 变成"去掉孔洞后的 47 格"——只有"引用孔洞格"的用例会挂：**

测试里实际用到的平台格集合（逐条核过）：
`{0,2}`、`{0,3}`、`{1,3}`、`{2,3}`、`{2,2}`、`{7,7}`（`{8,8}` 在平台外，用于"unsupported"断言）。

| 孔洞落在... | 会挂的具体断言 |
|:--|:--|
| `{0,2}` | `assets/__tests__/structures.test.ts:53`（`supportAt({0,2},1)?.id` 为 platform）；`vertical.test.ts:169-172`（平台边缘）、`:293-302`（Z-only 滑动）的路径会变化 |
| `{0,3}` | `assets/__tests__/picking.test.ts:35-43`（`target` 等于 cell `{0,3}`、supportId platform）、`:74-79` 第一条；`assets/__tests__/vertical.test.ts:160-167`（平台上移动）、`:217-224`（平台进楼梯）、`:293-302`（滑动）；`assets/__tests__/player-blocking.test.ts:117-126`（无障碍平台移动） |
| `{1,3}` | `assets/__tests__/picking.test.ts:74-79`（`[1.0,10,3.0]` → `{1,3}`） |
| `{2,2}` | `assets/__tests__/structures.test.ts:174`（反注册后 `supportAt({2,2},1)` undefined 仍通过，但其他用 `{2,2}` 的支撑判定会变；该行本身不挂） |
| `{2,3}` | `assets/__tests__/structures.test.ts:60-88` 多条 validate 期望 `ok/unsupported/occupied` 的基准格；`assets/__tests__/build-3d.test.ts:19-49` 多条；`assets/__tests__/build.test.ts` 用的是合成 `test:l1` 不受影响 |
| `{7,7}` | `assets/__tests__/picking.test.ts:74-79`（`[7.999,10,7.999]` → `{7,7}` 的 `maxEdge`）；`assets/__tests__/structures.test.ts:34-35`/`map-regression.test.ts:37-38` 若同时改 PLATFORM_CELLS 才会挂 |
| 其他格（如 `{5,5}`） | **上述单测全不挂**（但 `assets/__tests__/structures.test.ts:34-35`、`map-regression:37-38` 仍依赖 PLATFORM_CELLS 首末，不受影响） |

> **【建议】** 选孔洞格时避开测试锁定的 `{0,2} {0,3} {1,3} {2,3} {2,2} {7,7}`，例如 `{5,5}` / `{6,4}`；同时避开楼梯落点（楼梯高端 x=0、z∈[3,4)，玩家上平台后先在 `{0,3}` 附近）和 playthrough 的鼠标瞄准区域（`scripts/playthrough.mjs:109-143` 在平台上用屏幕坐标 `[0.5,0.42]` 放 1×1，孔洞若在该屏幕位置会导致步骤 07-09 的放置失效——playthrough 不属于单测，但属于验收门）。

**(D) 逐格碰撞体本身的连带影响（事实/建议）**

- `PLATFORM_COLLIDER` 这个"单 AABB"若继续被注册，孔洞会被堵住；生产必须改为注册 `PLATFORM_COLLIDERS`（逐格或多矩形），并在销毁时逐个反注册（`structures.pack.ts:79,85-86` 需要改）。
- `SpatialIndex.registerStructure(id, aabb)` 每个 id 只能一段 AABB、重复 id 抛错（`occupancy.ts:59-66`）；逐格方案要用 47 个唯一 id（如 `platform:5,5`，`StructureRegistry` 里 id 与 `SpatialIndex` 记录 id 会再拼一次前缀）。
- **【事实】前缀双重拼接**：`StructureRegistry.register` 把 `collider.id` 传给 `SpatialIndex.registerStructure`（`structure.ts:24`），后者再拼 `'structure:'`（`occupancy.ts:60`）。所以现有平台在 `SpatialIndex` 里的记录 id 实际是 `structure:structure:platform`（机械零件则是 `structure:mech:7`，因为 `structureIdForPart` 返回 `mech:7`）。调试/孔洞查询若用 `index.has('structure:platform')` 会得到 false；**[建议] 逐格 id 直接用 `platform:gx,gz`（最终记录 `structure:platform:gx,gz`），不要自己带 `structure:` 前缀。**
- 平台逐格后 `spatial.index.size` 从 ~2 条变成 ~49 条；没有单测断言这个总数（`structures.test.ts:153-158` 用的是自建 index），但任何未来调试面板/统计要留意。
- `structures.all()` 每帧被玩家移动（`player.pack.ts:154`）和机械 `partAt`（`mechanical.pack.ts:135`）遍历，47 个平台格 collider 数量级可忽略，但这是"数据数组膨胀"的既定代价。

---

## 4. `pickSupportTarget` 与孔洞格的行为

实现：`assets/spatial/picking.ts:24-66`。

算法（事实）：
1. 拒绝非有限输入（`:35-37`）；拒绝平行射线 `|dirY|<EPS`（`:38`）。
2. 遍历 `supports.all()`，只保留 `active && buildable && support.level === level`（`:41-42`）——**注意：目标层是调用方传入的固定 level，不会考虑其他层**。
3. 与平面 `y = support.worldY` 求交点 `t = (worldY - oy)/dirY`，只收 `t > EPS`（`:43-44`）；不限制 dirY 符号（向上射线也能选，`:24` 注释、`:52-56` 测试）。
4. 交点 `worldToCell(x,z)` 向下取整（`:47`），要求该格在 `support.cells` 内（`:48`）。
5. 取最近 `t`；同 `t` 按 `supportId` 字典序（`:57-63`）。

**某格变成孔洞后（事实，取决于实现方式）：**
- 若孔洞=平台 `cells` 不包含该格（推荐）：level 1 的拾取在该格返回 `undefined`；**不会**穿透到 level 0——因为 ground 的 `level=0` 在 `:42` 就被过滤；也不会被"平台下方的 ground 平面"接住。返回 `undefined` → build/mechanical 无 target → 无幽灵、不能放置。
- 若孔洞=support 多注册一个"孔洞 surface"（不推荐）：`pickSupportTarget` 反而会把它当成可建造面（`:41-48`），因为没有任何负向语义。
- 若孔洞只用碰撞体排除、不改 support（保留平台 cells）：拾取仍会选中孔洞格（返回 level 1 目标），随后 `validatePlacement` 因空间索引/支撑可能通过（如果碰撞体也排除了该格则 `ok`）——即**建造逻辑会认为可以在孔洞上放东西**。这正是需要同时改 support 的原因。
- **【事实】没有遮挡判定**：`pickSupportTarget` 不检查射线是否先穿过平台几何。玩家站在地面 level 0 时，即使平台板挡在视线上，也能瞄准平台下方的地面格放 1m 零件/立式轴（这也是 `assets/__tests__/build-3d.test.ts:39-43` 允许 1m 平台下建筑的前提）。

**【建议】** 孔洞实现放在 `structure.pack` 的支撑面派生层（cells 过滤），`picking.ts` 不需要改；如果坚持用 `SupportSurface.holes` 字段，则 `picking.ts:48` 与 `support.ts:131-141` 必须共用同一个 `supportsCell(surface, cell)` 判定，避免两处逻辑漂移。

---

## 5. 玩家垂直移动：走到孔洞格会发生什么？

实现：`assets/player/vertical.ts`、`assets/player/player.pack.ts`。

### 5.1 事实

- 玩家状态：`position[1]` 即 `feetY`，`level`、`supportId`（`assets/player/player.ts:25-36`）。无跳跃/重力/下落代码（全仓 grep 无 gravity/velocity；ROADMAP §7 也写明）。
- 每次移动：`resolveWithSliding(current, nextX, nextZ, world)`（`player.pack.ts:140-163`）→ full / X-only / Z-only（`vertical.ts:320-331`），每次从原始状态重算。
- 平面移动：`currentFlatSupport` → `selectFlatSupport(supportsAtPoint(nextX,nextZ), ...)`（`vertical.ts:291-313`）。
  - 孔洞格若平台 cells 不含：`supportsAtPoint` 只剩 ground（worldY 0），`selectFlatSupport` 的容差 `FLAT_SWITCH_TOLERANCE=0.05`（`:17`）过滤掉 → `target === undefined` → **`return { moved: false }`（`:312`）**。
  - 若 full 移动失败，X-only/Z-only 可能成功（沿孔洞边滑动），等价于平台边缘行为：`vertical.test.ts:293-302`（Z-only 滑动仍保持 feetY=3 / platform id）。
- `finish()` 兜底（`:221-255`）：若 isBlockedMove 命中返回 `moved:false`；否则 flat 必须 `active/walkable/worldY===feetY（EPS）/level 相同/该点有该 supportId`，任何一条不满足都 `moved:false`。
- 失败不修改 `current`（`:257-259` 注释；`vertical.test.ts:275-280` 断言 state 完全不变）。
- 玩家永远不会"掉下去"：没有任何把 `feetY` 设成更低值的分支；离开平台边缘/孔洞边缘只会被拒绝或滑动。

### 5.2 "垂直传动轴占据孔洞格、玩家不能走进该格"的最小改法

**【事实】现有接线点只有一个**：`player.pack.ts:153-161` 的 `isBlockedMove` 闭包已经遍历 `spatial.structures.all()` 并调用 `blocksPlayerMove`。因此：

| 方案 | 改动点 | 是否改 `vertical.ts` | 备注 |
|:--|:--|:--|:--|
| A. 平台 support cells 去掉孔洞格 | `assets/spatial/structures.ts` 派生 cells + `structures.pack.ts` 注册 | 否 | 玩家被"无支撑"挡住；空孔洞也挡；无需额外 collider |
| B. 注册孔洞守卫 collider | 在 `structures.pack.ts`（或 `mechanical.pack.ts` 的 place/remove）注册 `{ id, aabb:[gx,3,gz]..[gx+1,3.01,gz+1], blocksBuild:false, blocksPlayer:true }` | 否 | 复用现有闭包；`blocksBuild:false` 不进 SpatialIndex（`structure.ts:24`），不影响建造；`structures.test.ts:143-159` 已验证"只挡玩家不挡建造"的 collider 能存在 |
| C. 立式轴自身挡玩家 | 让轴 AABB 顶面 > 平台顶面（如高 3.5 → 顶 3.5 > 3） | 否 | 轴注册的 collider 本来就是 `blocksBuild:true, blocksPlayer:true`（`mechanical.pack.ts:297-302`），`blocksPlayerMove` 的严格高度比较（`occupancy.ts:75`）会命中；不需要额外守卫；但空孔洞仍可走（若 support 未改） |
| D. 改 `blocksPlayerMove` 比较为闭区间 | `occupancy.ts:75` | 否，但会改语义 | **不推荐**：会让恰好贴地的 collider 也开始挡人；`player-blocking.test.ts:63-81` 的多条贴合语义断言需要重审 |

> **【建议】** 采用 A + C：支撑层表达"孔洞不可站立/不可建造"，轴本身（高 3.5，顶面露出平台 0.5）自然挡玩家；B 作为"孔洞在空置时也要挡人"的补丁（如果设计希望空孔洞像围栏）。

---

## 6. `SpatialIndex` 的能力边界（孔洞/跨层相关）

文件：`assets/spatial/occupancy.ts`；空间数学：`assets/spatial/space.ts`。

### 6.1 `registerStructure` 是否支持一个 id 多段 AABB？

**【事实】不支持。**
- `SpatialRecord` 只有 `readonly aabb: Aabb` 一个盒子（`occupancy.ts:22-30`）；`registerStructure(id, aabb)` 只接收一个 AABB（`:59-66`）；同一 id 再次注册抛 `structure already registered`（`:61`）。
- `keys` 是"格×层"键数组（`:179-186`），只用于宽相位候选，不能让一个记录表达多段几何。
- `SpatialIndex` 没有 `update`；改几何必须 `unregisterStructure` + 重新 `registerStructure`（机械 `updatePlacement` 的事务就是这个模式：`mechanical.pack.ts:162-209`）。
- **【建议】** 平台逐格化 = 注册 N 条 `structure:<cell>` 记录（各自单 AABB、单格键），不要试图扩展成"多段 AABB"（会牵动 `SpatialOverlap.aabb`、`get/all`、所有测试）。

### 6.2 `idsAt`

- `idsAt(cell, level)` 读 `cellKey3(cell, level)` 对应的 Set（`occupancy.ts:189-192`），返回该单格单层的记录 id；二进制/调试用途，无生产消费者。
- 孔洞验证可直接用：`idsAt(holeCell, 0)` 不应包含平台逐格 collider；`idsAt(adjacent, 0)` 应包含。注意 id 双重前缀（§3.2-D）。

### 6.3 `overlapsAabb` 的宽相位键与 `levelsForSpan`（跨层正确性）

- `overlapsAabb(aabb)` → `candidatesForAabb` → `keysForAabb(aabb, height, minY)`（`:102-128,179-186`）；键 = `cellsInAabb2D(aabb)` × `levelsForSpan(baseY=aabb.minY, height=aabb.maxY-minY)`。
- `levelsForSpan`（`space.ts:71-85`）：slab 定义为 `[l*3, l*3+3)`，用 EPS 排除贴面。事实取值：
  - `levelsForSpan(0,3) = [0]`（`space.test.ts:87` 锁定）
  - `levelsForSpan(0,3.1) = [0,1]`
  - `levelsForSpan(0,4) = [0,1]`（`space.test.ts:88`；`occupancy.test.ts:61-67` 验证 4m 高建筑在 level 0/1 的 `idsAt` 都能查到）
  - `levelsForSpan(3,1) = [1]`（`space.test.ts:89`）
  - `levelsForSpan(2.7,0.3) = [0]`（`space.test.ts:90`，即平台板只登记 level 0 键）
- 查询侧也用**查询 AABB 自己的 span** 生成键：level 1 的查询（y[3,4]）生成 level 1 键，看不到"只登记在 level 0"的对象。对 3m 高立式轴（y[0,3]）而言：它只在 level 0 桶里；level 1 查询拿不到它——**几何上正确**（y[0,3] 与 y[3,4] 只贴面，不交叠，`aabbIntersects` 严格比较，`space.ts:102-111`、`space.test.ts:96-104`）。
- **推论（事实）**：如果立式轴高恰好 3.0，它在同一格**不会**阻止 level 1 的零件/建筑放置（AABB 贴面非碰撞；且孔洞格本来无 level 1 支撑，先被 `unsupported` 拦下）。若希望"轴占格后同格不能放 level 1 零件"，让轴高 > 3（如 3.5）即可进入 level 1 桶并产生真实重叠。**【建议】** 立式轴取 3.5m 高（同时解决端口高度问题，见 §7）。

### 6.4 对孔洞实现的直接含义

- 平台逐格碰撞体：每格 AABB `[gx,2.7,gz]..[gx+1,3,gz+1]`，`levelsForSpan(2.7,0.3)=[0]`，键只有该格 level 0；孔洞格不注册 → level 0/1 查询都不会撞到平台（正确：孔洞允许通行/穿透）。
- 平台 support cells 去掉孔洞格：`SupportRegistry` 的倒排按格建（`support.ts:86-94`），删格是 O(1) 级操作；但注册表没有"按格更新"API，动态变化必须整面 `unregister` + `register`（同 id 重新注册可行，`register` 只拒绝重复 id）。

---

## 7. 机械零件跨层的现有障碍（`parts.ts` / `ports.ts` / 连接与动力模型）

> 注意：§7 的"现状"以 **HEAD `076eb20`** 为基线（5 种机械零件、全部 `localY=0.5`）。
> 调查期间工作区出现了未提交的 M1.8 并行实现（新增 `vertical_drive` 等 6 种零件，见 §12），
> 行号会随该实现落地而变化；设计结论（§7.2）仍然成立，§12 给出了对照与剩余缺口。

### 7.1 相关常量与算法（事实，HEAD 基线）

- `assets/mechanical/parts.ts`：
  - `MECH_PART_HEIGHT = 1`（`:56`），`PORT_HEIGHT = 0.5`（`:57`）。
  - 现有 5 个零件 def 全部 `height: MECH_PART_HEIGHT`（`:108,119,131,143,157`）。
  - 现有全部端口 `localY: PORT_HEIGHT`（0.5）：轴 `:84-87`；齿轮 `:89-98`（含 `mesh-c` face `ny`、`mesh-d` face `py`，但 axis 都是 `x`）；动力源 `:146-148`；机器 `:160-162`。
  - `PartPortDef` 只有 `localCell {gx,gz}` 与 `localY`，**没有"跨层 worldY 偏移"或"零件跨度层数"概念**（`:15-22`）。
- `assets/mechanical/ports.ts`：
  - `portWorld`：`baseY = levelBaseY(part.placement.level)`（`:69`）；`anchor.y = baseY + port.localY`（`:88-92`）；XZ 锚点 = 格中心 + 面偏移（`localCenterX + f[0]*0.5`，`:73-79`）；`rotateY` 只绕 Y 轴（`:32-36,57-60`），因此 `axis:'y'` 的向量在旋转下不变、`face:'py'/'ny'` 的 XZ 偏移为 0（锚点在格中心）。
  - `worldAxis(part)`：`part.def.ports[0]` 的 axis 经 yaw 旋转（`:120-124`）。**只被动画使用**（`animation.ts:12-16` 的 `localSpinAxis`）；功率网络不使用它（`power.ts` 只用 connection.ratio）。
  - `matchAxial`：角色对（axial/output/input 互相允许，`:109-116`）→ 轴平行 `|dot(axis,axis)| >= 1-EPS`（`:128`）→ 法线相反 `dot(normal,normal) <= -1+EPS`（`:129`）→ 锚点重合（EPS 1e-4 量化，`:130`、`anchorKey :62-65`）→ `ratio = dot(axisA,axisB)`（`:131`）。
  - `matchGearMesh`：只有两个 `mesh` 端口、轴平行、法线相反、锚点重合、双方有齿数（`:135-143`）；`ratio = -(teethA/teethB)*sameDirection`。
  - `buildConnections`：把所有端口按 anchorKey 分桶，桶内两两配对（跳过同一 part，`:175`），先 axial 后 gearMesh，按 part/port 稳定排序，每端口最多一条（`:157-211`）。**连接图是"零件节点"图，不是"端口节点"图**——一个零件只要有两条连接（不同端口），动力就会穿过该零件节点。
  - `angularVelocity`（`:145-155`）的注释强调 invariant：Ω = ω·u，且轴向/啮合 ratio 都按有向轴定义，保证两端用同一式得到一致物理方向。**该 invariant 只对"所有连接两端轴平行"成立。**

### 7.2 逐条回答：加"高 3m、轴向 Y、端口 localY=0 和 3"的立式传动轴

**(1) 与现有轴向匹配规则冲突（事实，会连不上任何现有零件）：**

设立式轴放在 level 0（`baseY=0`），端口 `localY=0` 与 `3`：
- 端口世界锚点 y = 0 和 3。
- 现有 level 0 水平轴/齿轮/机器/动力源的端口锚点 y = `0 + 0.5 = 0.5`。
- 现有 level 1 零件端口锚点 y = `3 + 0.5 = 3.5`。
- `matchAxial` 要求 `close(a.anchor, b.anchor)`（`:130`）→ **0/3 与 0.5/3.5 全部不相等**，一条都连不上。
- 更根本：即使锚点人为对齐，立式轴的 Y 轴端口与水平件的 X 轴端口 `dot(axis)=0`，被 `:128` 的"轴平行"拒绝；`matchGearMesh` 的 `:137` 同样要求平行。
- 唯一能连的是"另一个同样用 localY=0/3 的 Y 轴零件"：例如 level 0 立式轴（端口 0/3）与 level 1 立式轴（端口 3/6）在 y=3 处锚点重合、轴同向/法线相反 → 可以连。但这样整条链只含 Y 轴零件，**永远接不到现有水平传动网络**。
- 结论：照字面实现"localY=0/3"，结果是一座"孤立的垂直轴柱"，无法完成"一楼动力源→立式轴→二楼机器"。

**(2) 与 `worldAxis` 的冲突（`ports.ts:120-124`，隐患）：**

- `worldAxis` 取 `ports[0]`。若新零件把 Y 轴端口放在 `ports[0]`，动画会绕本地 Y 自转（对高瘦圆柱/方轴是对的），但若同一零件还有 X 轴端口参与网络，则"网络认为的轴"（connection axis）与"动画用的轴"（ports[0]）不一致。
- 若 `ports[0]` 是 X 轴端口（为了接水平件），动画会绕 X 转，垂直轴会像横轴一样"翻滚"。
- 该函数被 `assets/mechanical/animation.ts:12-16` 用于所有零件的自转；`assets/__tests__/mechanical-ports.test.ts:54-63` 锁定现有 shaft/gear 的 worldAxis 行为（shaft 0° → [1,0,0]，180° → [-1,0,0]，gear 90° → [0,0,-1]）。**新增多轴零件不会挂现有断言，但会得到错误视觉。**

**(3) 现有模型根本没有"直角/锥齿轮"连接能力（事实）：**

- `matchAxial`/`matchGearMesh` 都要求轴平行；`buildConnections` 只有 `axial | gearMesh` 两种 kind（`ports.ts:17`）。
- `power.ts` 的 `isTransmission` 只认 `kind === 'shaft' || 'gear'`（`power.ts:89-91`）：若新零件用新 `PartKind`（如 `'riser'`/`'bevel'`），它不会参与"支路超载停转"判定（`power.ts:376-385`）——必须显式加入或复用 `'shaft'`。
- `angularVelocity` 的一致性建立在"连接两端轴平行"上（`ports.ts:145-155`）；真正的 90° 传动会让两端 Ω 向量不平行，现有模型只能用 `ratio=±1` 近似、并让每个零件各自有视觉自转轴（`worldAxis`）。**【建议】把它记为"已接受的表现近似"，不要在本期改造 ω 向量模型。**

**(4) 可行的最小改法（建议，不修改匹配规则）：**

> 方案 R1：**"高 3.5m、两端 X 轴向端口、锚点 0.5/3.5"的立式套管/立轴**。
> - `height: STANDARD_LEVEL_HEIGHT + PORT_HEIGHT = 3.5`，AABB `y[0,3.5]`；
> - 端口两个，`axis:'x'`：
>   - `{ id:'bottom', role:'axial', face:'nx', localCell:{0,0}, localY: PORT_HEIGHT }`（世界锚点 `baseY+0.5`，接 level 0 水平件）
>   - `{ id:'top', role:'axial', face:'px', localCell:{0,0}, localY: PORT_HEIGHT + STANDARD_LEVEL_HEIGHT }`（世界锚点 `baseY+3.5`，接 level 1 水平件）
> - 零件放在 level 0 的孔洞格；旋转 0/90/180/270 时两端锚点随 yaw 改变方向、高度不变；`matchAxial` 与水平件完全兼容（同一套 X 轴端口/法线/锚点规则），**无需改 `ports.ts` 的匹配逻辑**；动力网络把该零件当普通轴节点穿过。
> - 额外：`MechanicalPartDef` 加可选 `spinAxis?: Axis`，`worldAxis` 改为 `part.def.spinAxis ?? part.def.ports[0]?.axis`（`ports.ts:120-124` 一处），新零件 `spinAxis:'y'` 让视觉绕 Y 转；原有零件无 `spinAxis` → 行为不变，`mechanical-ports.test.ts:54-63` 不挂。
> - `PartKind` 加 `'riser'`（或复用 `'shaft'` 但视觉分支按 `def.id` 区分）：若加 `'riser'`，同步 `power.ts:89-91 isTransmission` 包含它，否则支路超载不生效。
> - 视觉：`visuals.ts:126-212` 的 `createPartView` 只按 `kind` 分支；未知 kind 会**落到冲压机分支**（`:194-212`，默认 fallback），必须加 `riser` 分支（否则立式轴长得像冲压机）。
>
> 方案 R2：**保留字面"轴向 Y、localY 0/3"**，则必须同时改：
> (a) `portWorld` 增加"端口世界 Y 偏移/相对层基准偏移"概念，使 Y 端口能落在 0.5/3.5；
> (b) `matchAxial`/`matchGearMesh` 支持正交轴（新 kind，如 `bevel`），并定义垂直传动的 ratio 符号；
> (c) `angularVelocity`/网络的不变量重审；
> (d) `worldAxis`/动画区分自转轴；
> 改动面远大于 R1，不建议本期做。

### 7.3 其他机械侧跨层障碍（事实）

- **放置合法性**：`validatePlacement` 对每个格要求该层可建造支撑（`build.ts:91-98`）。立式轴放 level 0 的孔洞格：ground support 在平台下存在（MapConfig 全图，`map-config.ts:222-226` + `ground-support.ts:14-25`）→ `buildableSupportAt(holeCell, 0, 0)` 通过；平台碰撞体必须排除该格（否则 `occupied`）。level 1 零件必须放在有平台支撑的格（孔洞格不行）。
- **玩家层级门槛**：`currentLevel()` 用玩家当前 `supportId` 的 level（`mechanical.pack.ts:227-233`），所以"放 level 0 立式轴"必须站地面；"放 level 1 水平件"必须先上平台。这是现有交互，不是新问题，但演示流程要按此顺序设计。
- **`partAt(cell, level)` 的层级假设**：`aabbContainsCell` 用 `y = levelBaseY(level) + 0.5`（`mechanical.pack.ts:72-79`）取格中心点判断 AABB 包含。对 level 0 的 3.5m 立式轴：查 level 0 命中（y=0.5 ∈ [0,3.5]），查 level 1 不命中（y=3.5 不满足 `min<=y<=max` 的浮点相等，实际上 `aabb.max[1] >= y` 可能 true——若高度恰好 3.5 则 `3.5>=3.5` true、`min<=` true，会命中；若高度 3.0 则 false）。该函数目前**没有外部调用者**（service 暴露 `partAt`，但 grep 只找到定义/赋值；`mechanical-registry.test.ts:42` 只断言 registry 没有 `partAt`），所以不是当前阻塞项，但属于"跨层零件"的语义债。
- **`hitPart`**：鼠标命中用 `placementAabb(part.placement, part.def.height)`（`mechanical.pack.ts:372-385`），对 3.5m 零件正常工作。
- **视觉/选择框/幽灵**都用 `def.height` 居中（`mechanical.pack.ts:359-370,346-357`、`visuals.ts:126-212`），高度数据驱动，支持 3.5m。
- **道具/快捷栏**：见 §10 风险（新增第 6 个机械零件会动 `items.ts`、`mechanical-items.test.ts:14`、`mechanical.pack.ts:120-131` 的默认空槽）。

---

## 8. 回归测试清单（文件 / 用例数 / 平台楼梯断言）

基线：`pnpm test` = 31 文件 / 314 用例全绿；`pnpm typecheck` 通过（本报告写作前实测）。

### 8.1 与空间/支撑/垂直移动/建造合法性相关的测试文件

| 文件 | 用例数 | 与开孔的关系 | 直接断言平台/楼梯 AABB 或 id 的用例 |
|:--|--:|:--|:--|
| `assets/__tests__/space.test.ts` | 11 | 层高、`levelsForSpan`、AABB 相交语义（跨层宽相位的基础） | 无 |
| `assets/__tests__/support.test.ts` | 9 | `SupportRegistry` 注册/查询/标准层高/不可建造过滤 | 无（合成 support） |
| `assets/__tests__/vertical.test.ts` | 26 | 平台/楼梯/地面移动、滑动、容差 | **有**：`:57`（platformState 用 `PLATFORM_SUPPORT.id`）、`:78-96`（platform support 选择/优先）、`:165`、`:213`、`:301`（结果 supportId 为 platform）；`:131-145`（楼梯几何） |
| `assets/__tests__/occupancy.test.ts` | 15 | `SpatialIndex` 建筑/结构/负坐标/跨层键 | **有（合成）**：`:88` `platformAabb = {min:[0,2.7,0],max:[8,3,8]}`（注意 z 从 0 而非真平台的 2，是"近似平台"的合成体） |
| `assets/__tests__/structures.test.ts` | 14 | 平台/楼梯数据 + 支撑/碰撞集成 + 注册表清理 | **有**：`:31,34,35`（48 格、首末格）、`:42-45`（`PLATFORM_AABB` 精确相等）、`:46-47`（collider flags）、`:53-55`（supportAt platform）、`:60-88`（平台碰撞集成：1m 通过、2.8m occupied、level1 通过、平台外 unsupported）、`:93-139`（楼梯数据、`STAIRS_COLLIDER.aabb` 精确相等 `:134`、flags `:135-136`、`validate` occupied `:137-138`）、`:161-177`（反注册清理） |
| `assets/__tests__/player-blocking.test.ts` | 6 | 玩家占用几何 + 扫掠阻挡 + 平台/楼梯状态 | **有**：`:120`（platformState `{0.5,3,3.5,level:1,supportId:platform}`） |
| `assets/__tests__/picking.test.ts` | 10 | `pickSupportTarget` 射线→层→格 | **有**：`:35-43`（level 1 target 等于 cell `{0,3}`、`baseY:3`、`supportId:PLATFORM_SUPPORT.id`）、`:74-79`（`{1,3}` 与 `{7,7}` 边界）、`:93-94`（同 t 时 platform 胜出） |
| `assets/__tests__/build.test.ts` | 16 | `validatePlacement` 支撑/边界/占用/玩家格/射线 AABB | 无（用 `test:ground`/合成 `test:l1`） |
| `assets/__tests__/build-3d.test.ts` | 6 | level-aware 建造 + 搬动保持 level | **有**：`:36`（`PLATFORM_AABB` 精确相等）；`:19-49` 多条用平台格 `(2,3)` |
| `assets/__tests__/build-adjustment.test.ts` | 15 | 搬动快照/空间释放恢复/level 保持 | 无（合成 support） |
| `assets/__tests__/grid.test.ts` | 13 | 纯网格坐标/旋转/占地 | 无 |
| `assets/__tests__/grid-overlay.test.ts` | 11 | 网格线/地面高亮 | 无 |
| `assets/__tests__/map-regression.test.ts` | 8 | 旧内容锁定（平台/楼梯/出生点/矿点） | **有**：`:36-48`（48 格、首末格、`PLATFORM_AABB`、support level/worldY/flags）、`:51-68`（楼梯 origin/cells/step/中心）、`:127-139`（资源不覆盖平台格） |
| `assets/__tests__/map-ground.test.ts` | 9 | 地面支撑由 MapConfig 派生、包边不入注册表 | 无（ground only） |

> 与任务书点名文件的对应：`space.test.ts`、`support.test.ts`、`vertical.test.ts`、`occupancy.test.ts`、`structures.test.ts`、`player-blocking.test.ts`、`picking.test.ts`、`build.test.ts`、`build-3d.test.ts`、`build-adjustment.test.ts`、`grid.test.ts`、`grid-overlay.test.ts` 均已覆盖；另外 `map-regression.test.ts` 与 `map-ground.test.ts` 也直接涉及平台/地面，务必算进回归面。
>
> 合计：上表 14 个文件共 **169** 个用例（约 314 的 54%）。

### 8.2 会因"实现方式"挂的用例汇总（确切文件+行号+断言）

见 §3.2 表。核心结论再强调一次：

- **只改生产注册（单 AABB→逐格）**：0 个单测挂（没有测试加载 `structures.pack.ts`）。
- **改 `PLATFORM_AABB`/`PLATFORM_COLLIDER` 导出**：`structures.test.ts:42-47`、`build-3d.test.ts:36`、`map-regression.test.ts:41` 以及相关 import 直接挂/编译失败。
- **改 `PLATFORM_CELLS` 为 47 格**：`structures.test.ts:31`、`map-regression.test.ts:36` 挂（首末格再挂两条）。
- **`PLATFORM_SUPPORT.cells` 去孔（推荐）**：只有引用孔洞格的用例挂；孔洞放 `{5,5}` 这类未被测试引用的格，则单测 0 挂（但 playthrough 仍要人工确认，见 §10）。
- **改 `PLATFORM_SUPPORT.id`**：`structures.test.ts:53`、`picking.test.ts:41,93-94`、`vertical.test.ts:57,84,165,213,301`、`player-blocking.test.ts:120` 等挂。
- **楼梯 AABB/id**：只要不动 `MAIN_STAIRS`/`STAIRS_COLLIDER`，开孔不影响；若平台碰撞体拆分误把楼梯格覆盖/删除，`structures.test.ts:137-138`（平台/楼梯交接格 `(-2,3)` occupied、`(-2,2)` ok）与 `map-regression.test.ts:51-68` 会挂。

---

## 9. 【建议】开孔实现的最小改动点清单（按依赖顺序）

> 以下全部是建议，不是现状。目标是"M1.8 跨层传动 Demo"最小闭环：固定平台某格开孔 → 一楼下立式轴 → 二楼水平件接上 → 动力贯通。

### 9.1 数据层（唯一权威定义，`assets/spatial/structures.ts`）

1. 新增 `PLATFORM_HOLE_CELLS: readonly Cell[]`（静态孔洞；先只开 1 格，位置避开 §8.2 的测试锁定格与楼梯落点，例如 `{5,5}`）。
2. 保留 `PLATFORM_CELLS`（48 格几何真相）不动；新增派生：
   - `PLATFORM_SUPPORT_CELLS = PLATFORM_CELLS.filter(c => !holeSet.has(cellKey(c)))`；
   - `PLATFORM_SUPPORT` 的 `cells` 改为 `PLATFORM_SUPPORT_CELLS`（id 保持 `'support:platform'`、level 1、worldY 3 不变）；
   - `PLATFORM_COLLIDERS: readonly StructureCollider[]`：逐格（或矩形分解）AABB，排除孔洞格；id 用 `platform:gx,gz`（避免 §3.2-D 的 `structure:` 双重前缀）。
   - 可选：若要与工作区新出现的 `floors.ts` 的 `opening` 语义一致（孔上可放零件、人不能站），再给孔洞格注册一张 `buildable:true, walkable:false` 的独立孔面 surface；两张 surface 的完整说明见 §12.3。
3. **保留** `PLATFORM_AABB`/`PLATFORM_COLLIDER` 导出以兼容现有单测（它们继续表示"完整平台板"的锁定数据），但在注释里标记"生产注册不再使用单 AABB"。**【建议】** 若要测试与生产完全同源，可把 `structures.test.ts`/`build-3d.test.ts` 的 helper 改为注册 `PLATFORM_COLLIDERS`——那是测试改动，需 lead 授权。
4. 平台视觉：`structures.pack.ts:38,47-54` 的 8×0.3×6 单盒改为"孔洞四周的 4 块（或 2 块）盒子"，视觉与数据同源（按 `PLATFORM_CELLS`/`PLATFORM_HOLE_CELLS` 派生）。

### 9.2 注册/清理（`assets/spatial/structures.pack.ts`）

- `:78-81`：`register(PLATFORM_SUPPORT)`（cells 已含孔洞）+ `for (collider of PLATFORM_COLLIDERS) register(collider)` + `STAIRS_COLLIDER` + `STAIRS_TRAVERSAL`。
- `:83-94`：反向逐个 `unregister`（顺序不限，SpatialIndex 按 id 删）。
- 若孔洞要"空置时也挡玩家"，额外注册守卫 collider（`blocksBuild:false, blocksPlayer:true`，AABB `[gx,3,gz]..[gx+1,3.01,gz+1]`）；否则依赖 support 缺格挡玩家（§5.2-A）。

### 9.3 拾取/建造/玩家（通常**零代码改动**）

- `assets/spatial/picking.ts`：孔洞=平台 cells 缺格 → 已正确返回 undefined（§4），不改。
- `assets/build/build.ts`：`buildableSupportAt` 缺格 → `'unsupported'`（`:93`），不改。
- `assets/player/vertical.ts`：无支撑 → `moved:false`（`:312`），不改。
- `assets/player/player.pack.ts`：`isBlockedMove` 闭包已就绪（`:153-161`），不改。
- `assets/mechanical/mechanical.pack.ts`：现状已允许"站在地面往平台下格放 level 0 零件"（只要支撑/碰撞体放行），不改。

### 9.4 机械零件（新增立式轴；最小协议）

1. `assets/mechanical/parts.ts`：
   - `PartKind`/`PartId` 增 `'riser'`（或保持 `'shaft'` 并新增 `def.id`）；
   - 新 def：`height: STANDARD_LEVEL_HEIGHT + PORT_HEIGHT (3.5)`，两个 `axis:'x'` 端口（`localY: PORT_HEIGHT` 与 `localY: PORT_HEIGHT + STANDARD_LEVEL_HEIGHT`，face `nx`/`px`），见 §7.2-R1；
   - 若采用 `spinAxis`：`MechanicalPartDef` 加 `spinAxis?: Axis`，`worldAxis` 改为 `part.def.spinAxis ?? part.def.ports[0]?.axis`（`ports.ts:120-124`），新零件 `spinAxis:'y'`；
   - 若加新 `PartKind`：同步 `power.ts:89-91 isTransmission` 加入该 kind（否则支路超载不生效）。
2. `assets/mechanical/visuals.ts:126-212`：新增该 kind 的视觉分支（垂直圆柱/方轴 + 两端法兰），避免落到冲压机 fallback（`:194-212`）。
3. `assets/items/items.ts`：`ItemId` 联合、`ITEM_IDS`、`MECHANICAL_DEFINITIONS` 增加物品条目（`mechanical-items.test.ts:14` 的 `itemDefinitions()).toHaveLength(6)` 会挂，需同步改成 7——测试改动需授权）。
4. `assets/mechanical/mechanical.pack.ts:120-131`：`kitSlots` 增加第 6 项；**注意 `hotbar.select(5)`（`:129`）原意是"默认选中空槽 5"**，加了第 6 个零件后槽 5 不再空 → 必须改 `hotbar.select(6)`（或显式找空槽）。
5. `assets/frontend/icons.ts:71-87`：新增 icon key 的分支；未知 key 回退占位图（`:85-86`），不崩但 UI 会显示 `?`。

### 9.5 测试与文档（建议）

- 新增（或扩展现有）单测：
  - 孔洞格 `supportAt/buildableSupportAt/supportsAtPoint` 返回 undefined/空；
  - `pickSupportTarget` 在孔洞格返回 undefined；
  - `SpatialIndex`：孔洞格无平台记录、邻格仍挡 2.8m 建筑；
  - 立式轴端口锚点：level 0 底端口=0.5、顶端口=3.5，与 level 0/1 水平轴 `buildConnections` 各连 1 条；
  - 玩家从平台走向孔洞格 `resolveMove` 返回 `moved:false`；
  - `mechanical-items.test.ts:14` 数量从 6 改 7；
  - 现有 `structures.test.ts`/`build-3d.test.ts` 的 helper 是否改注册 `PLATFORM_COLLIDERS`（可选，提升生产/测试同源性）。
- 文档：修 `docs/PROGRESS.md:48` 与 `assets/spatial/structure.ts:4-7` 的过时注释；在 `docs/PROGRESS.md` §3 的"跨层传动"行更新方案。
- playthrough：`scripts/playthrough.mjs:109-143` 在平台上按屏幕坐标放置 1×1；孔洞若落在该瞄准区域会使 07-09 步骤失败，需按最终孔洞位置重跑/微调。

---

## 10. 任务书未预料到的风险（按严重度排序）

1. **【高】直角/锥齿轮传动在现有动力模型里不存在，且"轴向 Y"零件与水平网络结构性不兼容。** 不仅是端口高度（0.5 vs 0/3）问题：`matchAxial`/`matchGearMesh` 要求轴平行（`ports.ts:128,137`），`angularVelocity` 的一致性依赖平行轴（`ports.ts:145-155`）。最小可行解是 §9.4 的"两端 X 轴端口 + 显式视觉自转轴"，而不是字面意义的 Y 轴端口。若评审要求"真实锥齿轮"，那是模型级改造（连接 kind + ω 向量 + 动画），远超 M1.8 单点开孔。
2. **【高】动态开孔（放下轴才在楼板开洞）会跨 3 个插件的生命周期。** 平台目前只在 `structures.pack.ts` 启动时注册一次（`:78-81`），`mechanical` 在挂载顺序上晚于 `structures`（`scene-owner.pack.ts:53-55,64-65`），且机械的 place/remove 事务在 `mechanical.pack.ts:288-344`。若孔洞要随立式轴增删出现/消失，需要：孔洞状态的所有者 + `SupportRegistry.unregister/register(same id)` + 平台逐格 collider 的增删 + 玩家当前 `supportId` 失效处理（`vertical.ts:109-120` 会短暂返回旧 surface）。**建议 M1.8 先做静态孔洞**；动态开孔作为 M2 功能，并给它单独的任务与测试。
3. **【中】平台视觉与数据会漂移。** 平台视觉是单盒（`structures.pack.ts:38,47-54`），数据拆格后视觉必须同步，否则"孔洞"不可见；没有单测覆盖视觉，只有 playthrough 截图能发现。
4. **【中】新零件的三处"非机械"登记容易被漏**：`items.ts:8-14` 的 `ItemId` 联合、`mechanical-items.test.ts:14` 的 `itemDefinitions()` 长度 6、`mechanical.pack.ts:126-129` 的 `hotbar.select(5)`（默认空槽索引）。漏任何一处分别导致：类型错误/测试挂/默认选中新零件、普通建造模式被意外关闭。
5. **【中】`worldAxis` 取 `ports[0]`（`ports.ts:120-124`）是隐形契约。** 新零件的端口顺序若被后续编辑调整，动画轴会静默改变；现有测试只锁定旧零件的 worldAxis，不会保护新零件。建议加 `spinAxis` 字段并在新零件测试里断言。
6. **【中】`partAt(cell, level)` 的 `y = levelBaseY(level)+0.5` 假设（`mechanical.pack.ts:72-79`）对 3.5m 跨层零件语义模糊**（查 level 0 命中、查 level 1 可能巧合命中/不命中）。目前无外部调用者，但 service 接口已暴露，未来存档/悬停/拆除可能踩到。
7. **【中】platform 在 `SpatialIndex` 的记录 id 是 `structure:structure:platform`（双重前缀）**，机械零件是 `structure:mech:7`。孔洞/调试代码若按"`structure:platform` 应存在"来查会误判；逐格 id 设计要避开这个坑。
8. **【低-中】`SupportRegistry.register` 的 `requireStandardHeight`（`support.ts:77-81`）不允许非标准高度**；若未来想给"半层/夹层楼板"开孔，这个开关要先打开（`SupportRegistryOptions.requireStandardHeight` 现在默认 true）。
9. **【低-中】`SUPPORT_REGISTRY_KEY` 资源是只写不读的**（§1.2 最后一行）：如果有人期待"孔洞模块"通过 world resource 拿到注册表，会发现没有读取方；孔洞数据建议直接走模块导出常量/`spatial` 服务。
10. **【低】测试锁定格与 playthrough 屏幕坐标的双约束**：孔洞位置既要避开 `{0,2} {0,3} {1,3} {2,3} {2,2} {7,7}`（单测），又要避开 `scripts/playthrough.mjs:109-143` 的平台放置瞄准区；建议开孔后跑一次 `project play`（不必改 playthrough，除非放置步骤失败）。
11. **【低】平台碰撞体 47~48 个 collider 会让 `spatial.structures.all()` 的每帧遍历变长**（玩家移动 `player.pack.ts:154`、机械 `partAt` `mechanical.pack.ts:135`）。数量级很小，但若未来 M3 大规模多层楼板，建议把"平台格碰撞"换成按 chunk/矩形的稀疏结构而不是逐格。

---

## 11. 复现与证据

| 命令 | 结果 |
|:--|:--|
| `pnpm test` | 31 文件 / 314 用例全部通过（2026-11-07 17:04，HEAD `076eb20`，工作区干净） |
| `pnpm typecheck` | `tsc --noEmit` 退出码 0 |
| `grep -rn "PLATFORM_\|MAIN_STAIRS\|STAIRS_\|'support:platform'\|'structure:platform'" assets --include=*.ts` | 见 §3.1 计数；两个 ID 字面量只在 `structures.ts:29,45` |
| `grep -rn "structures.pack" assets scripts --include=*.ts` | 仅 `structures.pack.ts` 自身；**单测不加载生产注册路径** |
| `git status --porcelain` / `git log --oneline -3` | 干净；HEAD `076eb20 docs: M1.8 调查产出...` |

> 本报告只读调查：除本文件与 `docs/m18/` 目录外未修改/创建/删除任何文件，未做任何 git 写操作。

---

## 12. 附：调查期间工作区出现的并行实现快照（未提交，2026-11-07 17:09–17:12 观测）

> 这是别的会话/队友正在写的 M1.8 代码，**不是本报告产生**；本报告基线仍是 HEAD `076eb20`。
> 观察到 `git status` 从干净变为 4 个文件修改：`assets/mechanical/parts.ts`、`assets/items/items.ts`、`assets/hotbar/hotbar.ts`、`assets/mechanical/power.ts`。
> 与开孔方案直接相关，此处只做事实记录与风险提示，不评价代码质量。

### 12.1 已出现的立式传动实现（事实，工作区快照）

- 新增 `PartId 'vertical_drive'`（`assets/mechanical/parts.ts:16`），`kind: 'shaft'`（`:235`），因此 `power.ts` 的 `isTransmission` 自动包含它——省去了 §9.4 的 kind 改动。
- 常量：`VERTICAL_DRIVE_HEIGHT = 3`（`:96`）、`VERTICAL_DRIVE_TOP_PORT_Y = 3.5`（`:98`）。
- 端口（`:143-153`）：`bottom { axis:'x', face:'nx', localY: 0.5 }`、`top { axis:'x', face:'px', localY: 3.5 }`。
  - 世界锚点（level 0）：底部 `y=0.5`、顶部 `y=3.5`；与 level 0 水平轴（0.5）和 level 1 水平轴（3.5）都能 `matchAxial`。**这正是 §7.2-R1 推荐的两端 X 轴端口方案**，不需要改 `matchAxial/matchGearMesh/portWorld`。
  - 该实现还设计了叠层：level L 的顶部锚点与 level L+1 的底部锚点重合 → 可链式上传（代价：每层水平偏移 +1 格，见 12.2-R4）。
- `MECHANICAL_PART_IDS` 前 5 项保持不变、新零件追加（`:312-322`），`PROTOTYPE_KIT` 增加 6 个新零件（`:334-344`），符合"历史验收脚本依赖前 5 槽"的注释。
- `items.ts` 新增 6 个机械物品 + 3 个生产链资源物品（`ItemId` 现有 14 个定义，`grep 'id: ITEM_IDS'` = 14）。
- `hotbar.ts`：`HOTBAR_SLOT_COUNT` 8 → 12（注释说明 11 种机械零件装不下；Digit1-9/0 覆盖前 10 格）。`hotbar.test.ts` 大量断言用常量而非字面量 8（`assets/__tests__/hotbar.test.ts:19,34-36`），预计不挂；但 `assets/frontend/frontend-ui-protocol.ts:62` 的 `slots.length !== SLOT_COUNT` 需确认 `SLOT_COUNT` 来源同步（读代码前建议再核）。
- `power.ts`：`buildPowerTopology` 过滤 `ports.length === 0` 的零件（`power.ts:128-133` 附近，工作区 diff），避免无端口的 `chute` 生成 `no-source` 单点组件。

### 12.2 该实现相对本报告结论的**剩余缺口/风险**（建议 lead 对照检查）

- **R1（高）视觉分支缺失**：`assets/mechanical/visuals.ts:126-212` 的 `createPartView` 按 `kind` 分支；`vertical_drive` 是 `kind:'shaft'`，会走 `:137-147` 的水平轴分支：网格是 `SHAFT_LENGTH=0.9` 的 X 向长条、spinner 在 `[0,0.5,0]`。结果是"3m 高的碰撞体里放了一根横着的 0.9m 轴"，且只出现在 0.5m 高度。必须按 `def.id === 'vertical_drive'` 或新增 kind 加"竖直圆柱/方轴 + 上下法兰"分支，否则验收截图一眼假。
- **R2（高）自转轴错误**：`worldAxis` 取 `ports[0]`（`assets/mechanical/ports.ts:120-124`），`vertical_drive` 的 `ports[0]` 是底部 X 轴端口 → 动画会绕水平 X 轴自转（`assets/mechanical/animation.ts:12-16`），立式轴会"翻滚"而不是绕 Y 自转。建议加 `MechanicalPartDef.spinAxis?: Axis` 并在 `worldAxis` 里 `part.def.spinAxis ?? ports[0].axis`（只改一处，旧零件行为不变）。
- **R3（中）AABB 高度 3 与端口 3.5 不一致**：`height:3` → `placementAabb` 顶面 y=3，但顶部端口在 y=3.5（零件几何之外 0.5m）。后果：(a) 视觉若按 3m 做，连接点在对接口上方 0.5m 悬空；(b) `blocksPlayerMove` 的严格高度比较（`assets/player/occupancy.ts:75`：`collider.max[1] > yMin`）导致 **玩家站在平台 y=3 时不会被这个 3m 轴挡住**——孔洞若只靠该轴挡人，玩家仍可走进孔洞（必须靠 §5.2-A 的 support 去格/守卫 collider）。若想让轴自然挡人并覆盖端口，建议 `height: 3.5`（对应 AABB 顶 3.5，`levelsForSpan(0,3.5)=[0,1]`，同时能阻止同格 level 1 零件）。
- **R4（中）叠层是"斜向上"的**：level L 顶部在 `(gx+1, 3L+3.5)`，level L+1 底部在同格 `(gx+1, 3(L+1)+0.5)` 才重合——即每上一层要水平偏移 +1 格（来自 bottom `face:'nx'` / top `face:'px'` 的对角设计）。单层平台 M1.8 够用；但若之后做"同一格多层直通"，这是隐性坑，建议在注释/设计文档写明，或改成两端同侧/同格可叠的端口配对。
- **R5（中）新零件在游戏内还拿不到**：`assets/mechanical/mechanical.pack.ts:120-131` 的 `grantKit` 仍只 `bind` 前 5 个零件并 `hotbar.select(5)`；`PROTOTYPE_KIT` 虽然加了数量，但没有 `inventory.add` + 槽位绑定 → 新零件/立式轴无法选中、无法放置。需同步 `kitSlots`（注意 `hotbar.select(5)` 的"默认空槽"语义：若把第 6 个零件绑到槽 5，应改成 `select(6)` 或找空槽）。
- **R6（中）测试会挂（预期内，需同批改）**：`assets/__tests__/mechanical-items.test.ts:14` 断言 `itemDefinitions()).toHaveLength(6)`，工作区现在有 14 个定义 → 挂；`MECHANICAL_PART_IDS`/`PROTOTYPE_KIT`/items 相关断言也需同步。属于实现批次内的测试更新，不是开孔引入。
- **R7（低）`partAt(cell, level)` 层级假设**：`aabbContainsCell` 用 `y = levelBaseY(level)+0.5`（`assets/mechanical/mechanical.pack.ts:72-79`）；3m 高 `vertical_drive` 在 level 0 查询命中（0.5 ∈ [0,3]）、level 1 查询不命中（3.5 ∉ [0,3]）。该函数无外部调用者，暂时无害。
- **R8（低）平台开孔仍未动**：工作区 4 个修改文件里没有 `assets/spatial/structures.ts`，即 §3/§9.1 的开孔部分尚未开始；`vertical_drive` 放在 level 0 平台下格目前仍会被 `PLATFORM_COLLIDER`（y[2.7,3]）判 `occupied`（`assets/__tests__/structures.test.ts:66-70` 的同类几何）。**开孔是跨层 Demo 的硬前置。**
- **R9（低）`frontend/icons.ts`**：6 个新机械物品 + 2 个资源物品的 icon key 未加分支（`assets/frontend/icons.ts:71-87`），未知 key 走占位图 `?`（`:85-86`），不崩但 HUD/快捷栏不可辨识。

### 12.3 新出现 `assets/build/floors.ts`（未提交、未被任何文件 import）——"楼板/开孔"的另一条设计线

> 观测：`git status` 出现未跟踪文件 `assets/build/floors.ts`（279 行），全仓 grep **没有任何文件 import 它**；`assets/spatial/support.ts:20` 的 `SupportKind` 仍是 `'ground' | 'platform'`，而 floors.ts 使用了 `'deck' | 'opening'`（`floors.ts:100`）→ 该文件当前还过不了类型检查，属于"写到一半"的并行工作。以下是它的设计事实与对本任务的影响。

**【事实】floors.ts 定义的 `opening` 就是"楼板开孔"的一种实现：**
- `FloorKind = 'pillar' | 'deck' | 'opening' | 'stair'`（`:23`）。
- `opening` 几何与楼板同位置、同厚度 `y[3L+2.7, 3L+3.0]`（`:68-72`；`PILLAR_HEIGHT=2.7`、`DECK_THICKNESS=0.3`，`:28-30`）。
- `opening` **不注册碰撞体**：`floorBlocksBuild('opening') === false`（`:77-80`）→ 高零件可以从下往上穿过（跨层传动机制）。
- `opening` 在上层产生的支撑面：level `L+1`、`worldY = levelBaseY(L+1)`、`cells = cellsOf(placement)`、`buildable: true`、**`walkable: false`**（`:93-111`）——即"可以在孔上放零件，但玩家不能站进孔"。
- 即：**"开孔"被建模成"可建造但不可行走的支撑面 + 无碰撞体"，而不是"没有支撑"**。

**【建议/对本任务的意义】固定平台的开孔可以与这条设计线对齐：**
- 若只做 `PLATFORM_SUPPORT.cells` 去孔（本报告 §9.1 原推荐），孔洞格在 level 1 既不可走也**不可建造**——`buildableSupportAt` 返回 undefined，机械/建筑都不能放在孔上。
- 若希望与 `opening` 语义一致（孔上可放零件、人不能站），正确做法是**两张 surface**：
  1. `support:platform`：cells = `PLATFORM_CELLS − 孔`，walkable/buildable 均 true（id/level/worldY 不变）；
  2. `support:platform:opening`（新 id）：仅孔洞格，level 1、worldY 3、`buildable:true`、`walkable:false`、`kind` 需扩展（`SupportKind` 加 `'opening'`）。
  这样：`selectFlatSupport` 过滤 `walkable` → 玩家照样进不去孔（§5）；`buildableSupportAt` 找得到孔面 → 机械可以放在孔上继续向上连接；`pickSupportTarget` 会把孔格当目标（buildable）→ 可以瞄准；`supportAt` 在孔格返回孔面（platform 已不含该格，不会出现"先返回哪个"的不确定）。
- 若采用纯"去格"，则"孔上放立式轴/水平件"这条路走不通，跨层立式轴只能放在孔洞格的下层（level L），上层水平件放相邻格——这也够 M1.8 Demo，但与 floors.ts 的 `opening` 语义不一致，两者最好统一。
- **【事实】该设计与本报告 §3/§9 的冲突点只有一个**：固定平台不是"建筑"，没有 buildingId，不能被 `floorSupportId(kind, buildingId)` 管理；要么手工加一张孔面 surface（静态），要么把固定平台也纳入 floors 系统（改动更大）。§9.1 的"保留 id + 过滤 cells"仍是最小改动，孔面是可选增强。

### 12.4 与任务书原始问题的关系

- 任务书问的"高 3m、轴向 Y、端口 localY=0 和 3 的立式轴"（§7.2）与工作区实际采用的"高 3m、轴向 X、端口 localY=0.5/3.5"不同：**后者是当前连接规则下最直接、无需改匹配逻辑的可行形态**，§7.2 的结论（字面 Y 轴/localY 0/3 会连不上）不受影响。
- 开孔侧（本报告 §3/§4/§5/§9）与机械侧实现可以独立推进；唯一交叉点是"孔洞格必须从平台支撑 cells + 平台碰撞体里同时排除"，否则 `vertical_drive` 放不进去、也接不上。

