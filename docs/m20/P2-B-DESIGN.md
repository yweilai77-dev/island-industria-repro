# M2.0-P2-B 设计与数据说明

- 阶段：M2.0-P2-B
- 依据：[P2-B-INVESTIGATION.md](P2-B-INVESTIGATION.md)、[P2-A-DESIGN.md](P2-A-DESIGN.md)
- 代码：`assets/industrial/`（新增 `port-runtime.ts` / `port-slot-world.ts` / `port-flow.ts` /
  `ports.ts` / `port.pack.ts`），`assets/production/`、`assets/mechanical/`、`assets/items/` 有最小改动。

本文件按任务书 §七 的 2–6 项组织：接口盒物品与数据定义、安装位数据与空间关系、
安装/拆卸/更换流程、自动输入数据流、流槽与接口盒的职责边界。

---

## 1. 接口盒物品与数据定义

### 1.1 新物品

| 项 | 值 |
|:--|:--|
| `ItemId` | `interface_box` |
| 名称 | 基础接口盒 |
| 图标 | `assets/frontend/icons.ts` 新增内联 SVG（金属机身 + 两个琥珀色接口环） |
| 堆叠 | 999 |
| 分类 | `mechanical`（沿用现有分类，理由见下） |

**为什么分类仍是 `mechanical`**：`ItemCategory` 目前实际只承担一个职责——
「选中该物品时建筑系统是否让出输入」（`build/input-mode.ts` 的 `isMechanicalSelection`）。
接口盒是安装在机器上的工业部件，**不应该**被当成建筑放置，所以必须走 `mechanical` 分支。
它与「可放置机械零件」的区别由 `partDefForItem(itemId) === undefined` 保证：
机械插件拿不到 PartDef，就不会给放置幽灵、快捷栏也不会绑定它。
等 P2-E 科技树需要真正的物品分类时再拆出独立分类（已记录为后续事项）。

### 1.2 制造

锻压机新增第 4 条配方（`assets/production/recipes.ts`）：

```
forge-interface-box：2 × iron_ingot → 1 × interface_box，额定速率 5 s
```

- 追加在 `MACHINE_RECIPES.forge` **末尾**，保证 R 键切换顺序里前三条
  （`forge-shaft` / `forge-vertical-drive` / `forge-chute`）不变；
- 不引入科技解锁或新关键材料（任务书允许「简单、可测试的基础方案」）；
- 产物是真实物品，进背包后可安装；安装消耗 1 个，拆卸返还 1 个。

### 1.3 接口盒静态定义与真实物品的绑定

P2-A 的 `PortModuleDef.itemId` 在 P2-B 正式接上：

| 接口盒 | itemId | 状态 |
|:--|:--|:--|
| `port.through`（基础直通盒） | `interface_box` | **已接入**：可制造、可安装、可拆卸 |
| `port.splitter`（分流盒） | `null` | 纯定义，P2-C 接入 |
| `port.merger`（合流盒） | `null` | 纯定义，P2-C 接入 |

完整性校验（`industrial/integrity.ts`）改成：`through` **必须**绑定一个可解析的真实物品；
`splitter/merger` **必须**仍为 `null`（防止提前接错）。

### 1.4 静态定义 vs 运行时状态

| | 静态（冻结、不存盘） | 运行时（可变、纯 JSON） |
|:--|:--|:--|
| 接口盒 | `PortModuleDef`（id/kind/inputs/outputs/fitsSlotRoles/itemId） | — |
| 安装位 | `ProcessingCoreDef.portSlots`（id/role/face/localCell/localY/capacity） | — |
| 安装实例 | — | `PortRuntime` 内的 `InstalledPort { partId, slot, module, itemId, count }` |
| 加工状态 | — | 仍是 `MachineState`（`production/production.ts`），**不在接口盒里** |

**接口盒不持有加工状态**：它只有自己的缓冲；缓冲里的物料通过网关推进机器输入缓冲，
之后由现有 `tickMachine` 处理。因此不存在两套加工状态。

---

## 2. 安装位数据与空间关系

### 2.1 安装位定义（P2-B 调整了一处数据）

P2-A 定的输入位在 `pz`（本地 +Z），P2-B **改成 `nz`（本地 -Z）**：

| 核心 | 输入位 | 输出位 |
|:--|:--|:--|
| `core.crusher` | `slot.crusher.in.nz`（容量 4） | `slot.crusher.out.px`（容量 4） |
| `core.smelter` | `slot.smelter.in.nz`（容量 4） | `slot.smelter.out.px`（容量 4） |
| `core.forge` | `slot.forge.in.nz`（容量 6） | `slot.forge.out.px`（容量 4） |

**为什么改**：已验收的 M1.8 产线把溜槽放在机器 **-Z 侧、朝 +Z 推料**
（`m18c-production`：破碎机(-3,8) → 溜槽(-2,8) → 熔炼炉(-2,9)），物料正是从 -Z 面进入机器。
输入位放 `nz` 才能让玩家**已经建好的产线**直接接上接口盒，不必重排。
这属于 P2-A 明确标注「P2-B 可调整的数据」，模型不变。

### 2.2 世界坐标如何派生（不另写几何）

`assets/industrial/port-slot-world.ts`：

- `slotWorldOf(part, slot)` 把安装位包成一个没有传动语义的 `PartPortDef`，
  交给现有的 `mechanical/ports.ts` 的 `portWorld()` 换算 →
  **与机械端口同一套「面 + 本地格 + 本地高度 + Placement 旋转」数学**，不会出现两套坐标约定。
- 输出：`anchor`（表面中心）、`outward`（世界外法线）、`center`（沿法线外移 `MOUNT_OFFSET = 0.07`，
  即接口盒中心）、`yaw`（机器朝向）。
- 有一个 `clean()` 把 `sin/cos` 的 1e-17 残差收敛成 0，避免旋转后坐标出现浮点噪声。

### 2.3 旋转跟随（要求 2.8）

- 接口盒视图**每帧**用机器**当前** `Placement` 重算 `slotWorldOf` 并写 `Transform`，
  不缓存坐标 → 旋转/搬动核心后盒子立刻跟着走。
- 新增玩家操作 `U`：旋转悬停/选中的**加工核心** 90°（`mechanical.updatePlacement`，
  走既有的位置更新事务：校验 → 改 registry → 重新注册空间 → 刷视图 → commit，失败回滚）。
- 只允许旋转加工核心；轴/齿轮/动力源保持原有行为不变。

### 2.4 物料进入方向（「明确连接关系」的表达）

- `incomingDirectionOf(slot, rotation)`：物料要进入该安装位时的**水平运动方向** = 面外法线的反方向。
  例：输入位在 `nz`、机器 rotation = 0 → 物料必须沿 **+Z** 进入。
- `feedsSlotFrom(slot, rotation, chuteDirection)`：只有当溜槽的输送方向**正好等于**这个方向时才成立。
- 因此「两个物体相邻」不够，**方向也必须对**：溜槽必须正对接口盒所在的面。
  玩家从外观看到的是琥珀色接口口，它指向的方向就是要接的那一侧。

---

## 3. 安装 / 拆卸 / 更换流程

### 3.1 玩家操作（P2-B 新增三个键）

| 键 | 作用 | 前置 |
|:--|:--|:--|
| `T` | 给悬停的加工核心安装 1 个基础接口盒（消耗背包物品） | 机械模式（快捷栏选中任一机械零件）下悬停核心；核心输入位空闲；背包有 `interface_box` |
| `Y` | 拆下悬停核心输入位上的接口盒（返还物品 + 盒内物料） | 同上；该核心输入位已装盒 |
| `U` | 旋转悬停/选中的加工核心 90° | 悬停的是加工核心 |

安装目标固定为「该核心第一个空闲输入安装位」——P2-B 每台机器只有一个输入位，
所以不需要额外的位选择 UI；P2-C 出现多输入位时再扩展。

### 3.2 事务与失败分支

| 情况 | 行为 | 保证 |
|:--|:--|:--|
| 背包没有接口盒 | `T` 无操作 | 不扣物品、不装 |
| 安装位已占用 | `T` 无操作 | 不会出现第二个盒；不扣物品 |
| 规格不匹配（分流盒装输入位等） | `PortRuntime.install` 返回 `module-not-installable`，不扣物品 | 校验在扣物品**之前** |
| 接口盒还没绑定真实物品 | 返回 `module-not-a-real-item`，不扣物品 | 分流/合流盒装不上 |
| 加工核心正在运行 | **允许**安装/拆卸 | 只影响自动进料通道，不打断当前加工周期 |
| 接口盒仍连着溜槽 | 连接是**几何派生**的，拆盒即断开，不存在悬空引用 | 每帧重算，无缓存 |
| 接口盒缓冲里还有物料 | 拆卸时**全部交回背包** | `remove()` 返回 `{moduleItemId, bufferItemId, bufferCount}` |
| 拆卸时背包满 | 本作库存**没有容量上限**（`inventoryAdd` 总是成功），不会失败 | 不需要额外处理 |
| 核心被拆除 | 该核心上的盒与盒内物料在 `sync()` 里一起交回库存 | 与既有机器缓冲 flush 同一语义 |

**顺序保证**：`install` 先校验后写入，`T` 在 `install` 成功后才 `inventory.remove`；
因此不会出现「扣了物品但没装上」。

---

## 4. 自动输入数据流

```
                  ┌────────────── 每帧（ProductionRuntime.tick）──────────────┐
机器产物 ──pushMachineOutputs──► 溜槽 ──handoff──► 接口盒缓冲 ──drain──► 机器输入缓冲 ──tickMachine──► 加工
   (不变)                     (方向必须对)        (容量 4/6)      (原子)        (现有状态机)
                                  │
                                  └─ 没有盒 / 方向不对 / 盒满 ──► 堵塞：物品留在溜槽上（不吞不丢）
```

- **网关**：`industrial/port-flow.ts` 的 `createPortFlowGateway(ports)` 是唯一实现，
  生产代码（`mechanical/runtime.ts`）与集成测试共用同一份，避免「测的不是游戏跑的那条路」。
- **接口**（`production/production-runtime.ts` 的 `PortFlowGateway`）：
  - `acceptFromChute(part, itemId, incoming)`：溜槽末端把 1 件交给机器的输入接口盒；
  - `drain(partId, tryInsert)`：把盒内物料推进机器输入缓冲。
- **顺序**：每帧先 `drain`（盒→机器）再 `tickMachine`（加工）；溜槽交接在机器推进之后。
  因此「本帧到达的物料本帧就可能开工」。
- **原子性**：`drain` 先调用 `tryInsert`（真实 `insertInput`，返回是否收下），**收下之后**才从盒里扣减；
  任何一步失败都不扣、不复制。`acceptFromChute` 同理：先确认盒能收，才让溜槽释放物品。
- **容量**：盒容量 = 该安装位容量（与机器输入缓冲一致）：盒满 → 拒收 → 上游保持堵塞；
  机器输入缓冲满 → `insertInput` 返回 0 → 盒保留物料，不会「转移中消失」。
- **断电/暂停**：转移**不依赖动力**（与既有溜槽投料一致）。断电时机器不加工，物料停在机器输入缓冲；
  不会产生重复转移。恢复动力后从原进度继续。
- **堵塞可恢复**：`blocked` 物品每帧在槽口原地重试交接，下游一恢复就继续（见调查报告 §4-A）。

---

## 5. 流槽与接口盒的职责边界（方案 P1）

| | 流槽（重力溜槽） | 接口盒 |
|:--|:--|:--|
| 玩家手动投料 | ✅ 允许（悬停机器按 C / 右键，直接进机器缓冲） | ❌ 不是手动入口 |
| 自动输入到机器 | ❌ 必须经接口盒 | ✅ 唯一合法通道 |
| 机器产物自动输出 | ✅ 保留（产物推到相邻溜槽） | P2-C（输出侧自动化） |
| 是否需要制造/安装 | 不需要，直接放置 | 需要真实制造 + 安装到安装位 |
| 容量 | 每格 1 件在途 | 按安装位容量（4/6） |

明确保留：**机器产物仍会自动进入相邻溜槽**（M1.8 行为不变）；取消的是「溜槽直接把物料倒进机器」。
`m18c-production` 因此多了一步「给熔炼炉装接口盒」，其余步骤与断言不变。

---

## 6. 运行时边界与所有权

| 数据 | 所有者 | 说明 |
|:--|:--|:--|
| 已装接口盒 + 盒内缓冲 | `PortRuntime`（由 `port.pack.ts` 持有） | 纯逻辑、零引擎依赖、可序列化 |
| 对外只读/窄操作 | `ports` 服务（`assets/industrial/ports.ts` 的 `PortService`） | 加工运行时只认识这个窄接口 |
| 机器输入缓冲 / 加工状态 | `ProductionRuntime`（不变） | 接口盒不复制加工状态 |
| 动力 | `power.ts` / `MechanicalRuntimeState`（不变） | 接口盒不参与动力 |
| 机器实体身份 | `MechanicalPart.id`（不变） | `InstalledPort.partId` 就是它 |
| 读投影 | 唯一 GameRead `mechanical` 新增 `ports` 字段 | **不新增第二个 read** |

新增插件 `plugin/ports`（`assets/industrial/port.pack.ts`）挂载顺序：
`mechanical` → `ports` → `mechanical-runtime`（后者 `inject: [... 'ports']`）。

---

## 7. 与 P2-A 数据模型的差异（变更点汇总）

| 项 | P2-A | P2-B |
|:--|:--|:--|
| 输入安装位面 | `pz` | `nz`（对齐已验收的 M1.8 产线布局） |
| `port.through.itemId` | `null` | `interface_box`（真实物品） |
| 分流/合流盒 | 纯定义 | 仍纯定义（`itemId = null`，P2-C） |
| `MachineEntity.ports` | 恒为空 | 新增 `PortRuntime` 记录；`MachineEntity` 类型本身未改（仍不在读投影里） |
| 配方 | 5 条 | 6 条（+ `forge-interface-box`） |
| 物品 | 14 个 | 15 个（+ `interface_box`） |
| 读投影 | 机械/生产/库存/玩家/UI | 再加 `ports`（安装位、接口盒、缓冲、容量） |

---

## 8. 被否方案

| 方案 | 否决理由 |
|:--|:--|
| 新建传送带系统作为上游 | 等于在 P2-B 里塞进一整套运输系统，与「只完成真实接口盒/安装/基础自动输入」冲突；P2-C 主题 |
| 接口盒直接替换机器输入缓冲 | 会复制两套缓冲；且拆卸时无法安全处理在途物料 |
| 「相邻即连接」 | 任务书 §2.4 明确要求「不能仅凭两个物体相邻就自动建立连接」 |
| 用 AABB/射线检测是否连接 | 每帧做几何查询，代价高且与方向语义无关；方向派生已足够表达连接 |
| 把接口盒做成 `putItem` 的 UI 开关 | 违反「不得仅在机器 UI 中增加一个安装选项，却不在世界中放置对应物体」 |
| 现在就接分流/合流盒 | 属于多对多拓扑，P2-C |
| 装到输出位 | P2-B 没有输出侧自动化，装了也没作用（「每个新增系统都必须有实际作用」） |
