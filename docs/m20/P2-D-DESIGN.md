# M2.0-P2-D 设计与数据说明（组合机械）

- 阶段：M2.0-P2-D
- 依据：[P2-D-INVESTIGATION.md](P2-D-INVESTIGATION.md)、[P2-A-DESIGN.md](P2-A-DESIGN.md)、
  [P2-B-DESIGN.md](P2-B-DESIGN.md)、[P2-C-DESIGN.md](P2-C-DESIGN.md)
- 代码：新增 `assets/industrial/assembly-module.ts`、`assembly-runtime.ts`、
  `assembly-service.ts`、`assembly-system.ts`；机械/建造/工业包最小改动（见实施报告 §4）。

本文件按任务书 §八 的 2–7 项组织：Assembly 运行时设计、结构模块数据与安装、
组合建立与成员管理、整体空间与选择、拆解与状态恢复、与既有系统兼容说明。

---

## 1. 静态结构模块定义（`assembly-module.ts`）

静态定义与运行时实例严格分离：本文件只有纯数据（深度冻结），不引用任何引擎对象。

```ts
export interface StructureModuleDef {
  readonly id: StructureModuleId;      // structure.frame
  readonly label: string;              // 结构框架
  readonly itemId: ItemId;             // structure_frame（真实物品）
  readonly partId: PartId;             // structure_frame（机械零件层身份）
  readonly footprint: { w; d };        // 1 × 1
  readonly height: number;             // 1
  readonly connection: 'orthogonal';   // 本阶段唯一结构连接方式
  readonly connects: StructureNodeKind[]; // ['core', 'module']
  readonly reach: number;              // 1 格
}
```

- 结构模块**不是**新机器类型：它是 `MechanicalPartDef.kind = 'structure'` 的真实零件，
  和轴/齿轮/机器共用 Registry、空间索引、放置事务、拆除返还、视图生命周期。
- 它没有动力端口（`ports: []`、`maxTorque: 0`），不参与动力网络、不参与加工/物流。
- 扩展方向：以后加 1×N 梁/转角件只改 `STRUCTURE_MODULES` 与 `MECHANICAL_PART_DEFS`，
  运行时算法（正交相邻 + 连通组件）不变。

## 2. Assembly 运行时数据模型（`assembly-runtime.ts`）

### 2.1 节点与结构边

```ts
export interface StructureNode {
  partId: number;          // = MechanicalPart.id（复用身份，不另建 ID）
  kind: 'core' | 'module';
  placement: Placement;    // 真实放置（复制值）
  coreId: CoreId | null;   // kind=core 时的加工核心定义
  moduleId: StructureModuleId | null;
}
export interface StructureEdge {
  aPartId: number; bPartId: number;
  kind: 'core-module' | 'module-module';
}
```

- 节点只来自真实零件：`isProductionMachine(def)` → core；`structureModuleForPart(def.id)` → module。
- 结构边 = 同层、正交相邻（曼哈顿距离 1）且**至少一端是结构模块**；
  核心与核心直接相邻被显式过滤掉（普通相邻 ≠ 组合）。
- 边按 `(aPartId, bPartId)` 去重并对排序，保证同一世界状态得到同一结构图。

### 2.2 组合判定

- 连通组件（`connectedComponents`）按最小 partId 排序；
- **组件内加工核心 ≥ 2** 才生成组合；单核心组件不产生 Assembly（保持单机行为）；
- 组件可以同时包含核心和任意数量结构模块；结构模块串联支持直线/转角/T 形拓扑。

### 2.3 运行时快照（只读、纯 JSON）

```ts
export interface AssemblySnapshot extends Assembly {   // ← P2-A 的 id + memberIds
  readonly id: AssemblyId;                 // assembly:<serial>，稳定、不复用
  readonly level: number;
  readonly memberIds: readonly number[];   // 成员核心 = MechanicalPart.id
  readonly moduleIds: readonly number[];   // 结构模块 = MechanicalPart.id
  readonly referenceMemberId: number;      // 相对位置参考（成员中 partId 最小者）
  readonly links: readonly StructureEdge[];// 成员间结构关系
  readonly members: readonly AssemblyMemberSnapshot[];
  //    members: partId, coreId, ratedLoadTorque, placement, relative{gx,gz,rotation}
  readonly modules: readonly AssemblyModuleSnapshot[];
  //    modules: partId, moduleId, placement, relative{gx,gz,rotation}
  readonly bounds: { min: [x,y,z]; max: [x,y,z] };
  readonly powerDemandTorque: number;      // 成员额定 loadTorque 之和（只读查询）
}
```

- `AssemblySnapshot` **继承 P2-A 的 `Assembly`**：id + memberIds 语义不变，只增加只读管理字段；
- 绝不包含成员加工进度/缓冲/动力状态（那些仍在 `ProductionRuntime` 与 `power.ts`）；
- 也绝不包含速度/产能字段：组合不会合成虚构加工能力。

### 2.4 Assembly ID 分配（稳定优先）

| 事件 | 行为 |
|:--|:--|
| 新组件（≥2 核心）且与既有组合无交集 | 分配下一个 `assembly:<serial>`，serial 只增 |
| 加入成员/添加框架（组件与既有组合有交集） | **沿用旧 ID**，成员/模块表更新 |
| 两个组合被新框架连通合并 | 保留 serial 最小（最早）的 ID，其余解除 |
| 组件消失（拆光框架/拆光成员） | 组合解除；ID 不复用 |
| 组件拆分 | 按候选组件排序，先处理者保留旧 ID，其余分配新 ID |

每次重推导比较签名（id + memberIds + moduleIds + links），无变化不增加 revision。

### 2.5 合法性校验（`validateAssembly`）

校验项（供测试与数据自检）：成员 ≥2、无重复成员、成员必须是真实加工核心、
模块必须是真实结构模块、同一层、结构边端点都在组合内、结构图连通、
成员不能同时加入另一个独立 Assembly（`others` 参数）。
运行时由推导保证这些约束；该函数把语义变成可断言清单。

### 2.6 结构放置检查（`structurePlacementIssue`）

- 候选格（结构模块占地）必须与**同层**的加工核心或结构模块正交相邻；
- 否则返回 `not-adjacent`，插件拒绝放置（不消耗物品、不改世界）；
- 世界占用/支撑/玩家碰撞仍由 `mechanical.canPlacePart()` 的既有 `validatePlacement` 负责。

## 3. 组合建立与成员管理（`assembly-system.ts`）

### 3.1 放置结构模块（真实世界操作）

1. 背包里有结构框架时按 `P` → 写入 `STRUCTURE_MODE_KEY`，进入结构放置模式；
   build / mechanical / ports 三个输入系统检测到该资源即隐藏幽灵、让出输入；
2. 插件每帧用相机射线 + `pickSupportTarget` 求悬停格，显示绿/红结构幽灵，
   并发布只读 `STRUCTURE_TARGET_STATE_KEY`（cell/level/valid/reason）；
3. 左键放置：`mechanical.canPlacePart()` + `structurePlacementIssue()` 都通过才调用
   `mechanical.placePart()` —— 走既有放置事务（空间校验、Registry、视图、库存、拓扑提交），
   失败不产生半状态；
4. 放置后该零件立即被机械系统识别；组合关系由运行时在同一帧/下一帧重推导自动生成；
5. 再次按 `P` 或 `Esc` 退出模式；框架用完自动退出。

> 结构模块**没有**独立的“创建组合”按钮：组合由真实结构件与世界几何推导，
> 不能仅靠 UI 建立虚假关系。

### 3.2 让出输入的守卫（最小侵入）

| 系统 | 改动 |
|:--|:--|
| `build.pack.ts` | 检测 `STRUCTURE_MODE_KEY` 时隐藏幽灵/选择并 return（与 FLOOR_MODE 同型） |
| `mechanical.pack.ts` | 同上；另外新增只读 `canPlacePart()` 与事务 `placePart()` 供结构插件复用 |
| `port.pack.ts` | 同上；结构模式期间 T/O/K/L/Y/J/H/U 不响应 |
| `assembly-system.ts` | P/Esc、目标格、幽灵、左键放置、整体边界与标记、`assembly` 服务 |

不按 P 时资源不存在，三个系统的行为与 P2-C 完全一致（回归脚本验证）。

### 3.3 查询与查看

- 唯一 GameRead `mechanical` 新增 `assemblies`（全部组合快照）与
  `ui.selectedAssemblyId` / `ui.structureMode` / `ui.structureTarget`；
- `assembly` 服务提供 `snapshot()` / `assemblyOf(partId)` / `selectedAssemblyId()` / `modeActive()`；
- 玩家选中任一成员或结构模块时：`ui.selectedAssemblyId` 指向所属组合，
  世界中画出整体边界与成员/结构标记（见 §4.3）。

## 4. 整体空间与选择

### 4.1 整体边界

```
bounds.min = [min(gx), levelBaseY(level), min(gz)]
bounds.max = [max(gx)+1, levelBaseY(level)+maxHeight, max(gz)+1]
```

- 遍历组合内**全部成员核心与结构模块**的真实 `cellsOf` 与零件高度；
- 只覆盖组合自身占用的格子，不会覆盖无关建筑（成员/模块本身就是唯一输入）。

### 4.2 相对位置与方向

- 参考成员 = 成员中 partId 最小者（确定性，便于测试与调试）；
- `relative = { gx: placement.gx - ref.gx, gz: placement.gz - ref.gz,
  rotation: normalize(placement.rotation - ref.rotation) }`；
- 结构模块也记录相对参考成员的位置/方向。

### 4.3 整体选择与表现

- 不改变单零件选择：点击仍是选中某个 `MechanicalPart`，成员核心仍可单独操作/查看；
- 选中零件属于组合时追加：
  - **12 条边框光条**（不是半透明罩子）：青色不透明细梁，只画整体 AABB 的棱，
    避免遮住成员核心与结构模块，边界一眼可读；
  - 成员核心上方琥珀色立柱（0.1×1.3×0.1），结构模块上方青色立柱（0.1×0.8×0.1）；
  - 结构模块本身是真实网格（钢灰上下板 + 橙色四角立柱 + 螺栓），世界可见、可区分；
- 取消选择（Esc / 切换模式）后边界与标记隐藏；
- 本阶段不做整体移动/整体旋转（任务书 §五.6/7）。

## 5. 拆解与状态恢复

### 5.1 拆除结构模块

- 退出结构模式后，选中结构模块（现有 hover/select 流程）按 `Delete`：
  走 `mechanical.remove()`，零件/视图/空间项移除，物品返还一次；
- 下一帧 `AssemblyRuntime.reconcile()` 从剩余零件重新推导：
  组合可能缩小（仍有 ≥2 核心连通）或解除（<2 核心或不再连通）；
- **没有额外的“组合解除”写入**，因此不存在“模块已返还但 Assembly 还在”的中间状态；
- 拆一个结构模块不会触碰任何 `PortRuntime` / `MaterialLinkRuntime` / `MachineState`：
  接口盒、连接、加工进度、输入输出缓冲全部原样保留（单测与真实游戏场景 F 验证）。

### 5.2 拆除成员核心

- 常规 Delete 拆核心：机械系统移除核心；P2-B/P2-C 运行时同步交回盒内物料/清理指向它的连接；
- 组合运行时下一帧重推导：剩余核心若仍由结构链连通且 ≥2 台 → 仍是同一 Assembly（ID 不变、
  成员表少一项）；否则组合解除；
- 核心实体 ID 不变（拆解只移除，不重建其他核心）。

### 5.3 物品返还保证

- 结构模块是普通机械零件：`place()` 扣 1 件、`remove()` 返还 1 件，均只有一条路径；
- 组合推导从不改库存 → 不会重复返还；
- 真实游戏场景 F 断言：两次拆框后 `structure_frame` 数量精确 +2，重搭后再次消耗。

## 6. 与加工、物流、动力的兼容说明

| 系统 | 为什么不受影响 | 验证 |
|:--|:--|:--|
| 加工 | 组合不写入 `MachineState`；`ProductionRuntime.sync(parts)` 只认 machine/transport 零件，结构零件被忽略 | 单测：组合前后进度/缓冲/多核并行不变；真实游戏 C/F |
| 物流 | `MaterialLinkRuntime` 端点只允许加工核心的安装位；结构模块无安装位、不是端点；组合不自动建链、不删链 | 单测：组合前后连接数/状态/moved 不变；真实游戏 C/F |
| 动力 | `buildPowerTopology` 过滤无端口零件 → 结构模块天然不进入网络；组合不改变任何 `Connection`/功率解算 | 单测：组合前后连接与组件完全一致；真实游戏 D 对比 |
| 空间 | 结构模块走同一 `SpatialIndex`/`validatePlacement`；组合边界是只读派生，不注册为碰撞体 | 单测定位；真实游戏 A/B 可见 |
| 选择 | 选择标识仍是单零件 id；整体识别只是追加只读字段与视图 | 真实游戏 E |
| 输入 | 结构模式复用 `FLOOR_MODE_KEY` 的让出模式；模式关闭时三个系统行为不变 | 回归 M1.8/P1/P2-B/P2-C |

### 6.1 读投影新增字段（唯一 `mechanical` read）

```json
{
  "assemblies": [{
    "id": "assembly:3",
    "level": 0,
    "memberIds": [14, 15],
    "moduleIds": [16, 17],
    "referenceMemberId": 14,
    "links": [{ "aPartId": 14, "bPartId": 16, "kind": "core-module" }],
    "members": [{ "partId": 14, "coreId": "core.crusher", "ratedLoadTorque": 18,
                  "placement": { "gx": -4, "gz": 8, "level": 0, "w": 1, "d": 1, "rotation": 270 },
                  "relative": { "gx": 0, "gz": 0, "rotation": 0 } }],
    "modules": [{ "partId": 16, "moduleId": "structure.frame",
                  "placement": { "gx": -3, "gz": 8, "level": 0, "w": 1, "d": 1, "rotation": 0 },
                  "relative": { "gx": 1, "gz": 0, "rotation": 90 } }],
    "bounds": { "min": [-4, 0, 8], "max": [-2, 1, 10] },
    "powerDemandTorque": 42
  }],
  "ui": {
    "selectedAssemblyId": "assembly:3",
    "structureMode": false,
    "structureTarget": { "active": false, "cell": null, "level": null, "valid": false, "reason": null }
  }
}
```

## 7. 新物品、配方与原型供给（明确标记为临时）

| 内容 | 说明 |
|:--|:--|
| 物品 `structure_frame`（结构框架） | 真实物品：名称/描述/图标/可堆叠；描述写明 `P` 放置方式 |
| 零件 `structure_frame`（kind = structure） | 1×1，高 1，无端口、无扭矩；真实放置/拆除 |
| 配方 `forge-structure-frame` | 锻压机：3 铁锭 → 1 结构框架，5 秒；追加在配方表末尾，既有前 10 条顺序不变 |
| 原型套件 | `assembly` 插件开局发 4 个结构框架（测试与体验供给） |

> 任务书 §四把“机器获取/科技解锁”整体推迟到 P2-E：以上配方与开局数量属于
> **临时原型供给**，不是最终制造/解锁规则；P2-E 统一调整。

---

## 8. 被否方案

| 方案 | 否决理由 |
|:--|:--|
| 把成员核心合并成一个新的“组合机器” ID | 违反本阶段头号约束（§2.3）；会丢掉独立加工/动力/物流身份 |
| 把成员加工状态聚合成一个状态机 | 违反“组合 ≠ 加工能力合并”；进度/配方/缓冲都必须独立 |
| 靠 UI 按钮或距离自动成组 | 任务书明确禁止；结构模块必须是真实世界物件 |
| 结构模块做成 build 建筑 | 不是 MechanicalPart，无法与核心共用身份/空间/拆除链路，等于另建一套机器数据 |
| 在 `MachineEntity` 上存 `assemblyId` 双向维护 | 拆解/合并容易残留不一致；改为每帧推导 + 稳定 ID 复用 |
| 组合边界画成半透明大罩子 | 会盖住成员核心与结构模块；改用 12 条边框光条 + 成员/结构标记 |
| 组合整体移动/旋转 | 本阶段明确禁止；会牵扯空间与物流/端口大改 |
| 结构模式与普通建造共用左键分支 | 会把输入系统改复杂；采用与楼层模式相同的“资源存在即让出” |

---

## 9. 交互速查

| 操作 | 行为 |
|:--|:--|
| `P` | 进入/退出结构放置模式（背包需有结构框架；楼层模式中不响应） |
| 鼠标悬停 | 结构幽灵随目标格显示（绿=可放置，红=不可；只读目标读数给出原因） |
| 左键 | 在悬停格放置结构框架（相邻核心/结构模块 + 空间合法才成功） |
| `Esc` | 退出结构模式（不影响已放置的结构） |
| 点击成员/结构模块 | 选中单零件；同时识别所属组合，显示整体边界与成员/结构标记 |
| `Delete` / `Backspace` | 拆除选中的结构框架（返还物品）或成员核心（现有规则） |
