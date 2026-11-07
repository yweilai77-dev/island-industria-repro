# 存档架构调查（M1.8）

> 目的：在首条生产链落地**之前**确定存档范围与快照格式，避免生产系统做完后返工。
> 结论先行：**可以做，但当前 5 个系统里有 3 个没有对外的快照/恢复接口**，需要先补接口；
> 持久化通道用前端 realm 的 `zaohua-platform-sdk.storage`（异步、云端），Engine 侧通过现有
> MessagePort 传快照，不需要把 DOM/存储带进 Engine Worker。

## 1. 现状：状态都在内存里

| # | 状态 | 所有者（代码位置） | 生命周期 | 存档处理 |
|:--|:--|:--|:--|:--|
| 1 | 库存堆叠 `stacks[]`（itemId + count） | `inventory/inventory.ts`（服务 `inventory`） | 会话 | **必须存** |
| 2 | 快捷栏 8 格绑定 + 选中槽 | `hotbar/hotbar.ts`（服务 `hotbar`） | 会话 | **必须存**（玩家选择） |
| 3 | 建筑 `Map<buildingId,{typeIndex,height,placement}>` + `nextBuildingId` | `build/build.pack.ts:182,207`（**无服务接口**） | 会话 | **必须存**（类型 + placement） |
| 4 | 机械零件 `Map<partId,{def,placement}>` + `nextId` | `mechanical/registry.ts`（服务 `mechanical` 只读大部分） | 会话 | **必须存**（partId + 零件 kind + placement） |
| 5 | 动力源启停 `sourceEnabled` | `mechanical/runtime-state.ts:114` | 会话 | **必须存**（否则读档后机器全停） |
| 6 | 旋转角 `angles` / 机器位姿 `machinePoses` | `mechanical/runtime-state.ts:115-116` | 由 ω 推导 | 不存，读档后从 0 继续转 |
| 7 | 资源节点 `amount` / `depleted` | `resource/resource.pack.ts`（服务 `resourceNodes` 只读） | 会话 | **必须存**（否则刷新可无限刷矿） |
| 8 | 玩家位置 / 楼层 / 朝向 | `player/player.ts`（服务 `player`） | 会话 | **必须存**（「继续自己的工厂」） |
| 9 | 相机 yaw / 距离 | `camera/camera.pack.ts:47-50`（服务 `cameraRig` 只读 yaw） | 会话 | 可选（纯观感，默认值可接受） |
| 10 | 开局套件已发放 `KIT_GRANTED_KEY` | `mechanical/mechanical.pack.ts:49` | 会话 | **必须存**（否则读档重复送 24 轴/6+4 齿轮/2 源/5 机） |
| 11 | 建造选中 / 幽灵 / 调整状态 | `build/build.pack.ts` 局部变量 | 瞬时 | 不存（读档时取消） |
| 12 | 采集进度 `HarvestState` | `harvest/harvest.ts` | 瞬时 | 不存 |
| 13 | 前端 UI 开关 / 暂停 | `frontend/frontend-ui.ts` | 瞬时 | 不存 |
| 14 | 空间索引 / 支撑面 / 可通行面 / 连接 / 拓扑 / 动力解 / 视图实体 | spatial、mechanical、各 pack | **全部可派生** | 不存，读档后重建 |

## 2. 现有架构缺口（必须先补的接口）

| 缺口 | 现状 | 需要补什么 |
|:--|:--|:--|
| 建筑无服务 | `build` 是纯 pack，没有 `provide`；外部拿不到建筑列表 | `ctx.provide('buildings', ...)`：`snapshot()` + `restore(records)`（restore 内部重建视图/空间索引） |
| 机械无恢复接口 | `mechanical` 服务只有 `parts()/updatePlacement`，没有 add/remove/restore | `snapshot()`（已有读投影可复用）+ `restore(parts, sources)`；restore 需按「注册 + 建视图 + 重建拓扑」事务执行 |
| 资源节点只读 | `resourceNodes` 只有 `nodes/harvest`，不能设回 amount | `snapshot()` + `restore(amounts)`（内部走 `applyVisual`） |
| 玩家不可设位 | `player` 服务只读 state | `restorePosition(x,z,level,yaw)`（内部走一次垂直解算，避免卡进建筑） |
| 无存档消息 | UI 协议只有 `hotbar/*`、`hello` | 新增 `save/request`、`save/restored`、`save/error` 消息 + 协议版本号 |
| 无存储调用 | 工程里没有任何 `storage` 使用 | 前端 realm 调 `platformSdk.storage.set/get`（异步），`devStub` 已实现 localStorage 回退 |

## 3. 推荐快照格式（v1）

纯 JSON，禁止出现 EntityHandle / Map / 类实例。数量级：一个中型工厂约几十个零件、几十个建筑，< 20 KB。

```jsonc
{
  "version": 1,
  "savedAt": "2026-11-07T17:00:00.000Z",
  "engine": "0.4.19",
  "player": { "x": -1.5, "z": 2.5, "level": 0, "yaw": 0 },
  "inventory": { "stacks": [{ "itemId": "iron_ore", "count": 12 }] },
  "hotbar": { "slots": ["shaft", "gear_12", null, null, null, null, null, null], "selected": 0 },
  "kitGranted": true,
  "counters": { "nextBuildingId": 4, "nextPartId": 8 },
  "buildings": [
    { "id": 1, "kind": "shed", "gx": 1, "gz": 2, "rotation": 0, "level": 0 }
  ],
  "parts": [
    { "id": 1, "kind": "shaft", "gx": -6, "gz": 7, "rotation": 0, "level": 0 }
  ],
  "sources": [{ "partId": 1, "enabled": true }],
  "resources": [{ "id": 1, "amount": 17, "depleted": false }]
}
```

设计决定：

- **只存逻辑 ID + kind + placement**；高度/宽深由 `BuildingType`/`MechanicalPartDef` 派生。
- **计数器显式存**：`sources` 引用 `partId`，若读档后重排 ID 会断引用，所以 `nextPartId`/
  `nextBuildingId` 必须落盘。
- **不存 `spatial`**：读档时按建筑 → 机械的顺序重新注册，索引自然重建。
- **顺序**：玩家位置 → 库存/快捷栏 → 建筑 → 机械（机械要落在平台/地面支撑上）→ 资源 →
  重建连接与拓扑 → 触发一次 UI 状态广播。
- **事务**：任何一个实体恢复失败，整体回滚到「空世界 + 默认出生」并报 `save/error`，不进入半坏状态。
- **容错**：未知 itemId / 未知零件 kind / 越界 placement 逐条跳过并计数，写入错误日志；
  不整包拒绝（避免一个小改动毁掉整个存档）。

## 4. 存储通道

```
Browser(realm)               Engine Worker
  UI / 主菜单  ──MessagePort──▶  save:request
  storage.set(key, json) ◀────  快照 JSON（纯 JSON）
  storage.get(key) ─────────▶  save:restore
  (平台 SDK / devStub)         各系统 restore
```

- `zaohua-platform-sdk` 的 `storage.get/set` 是**异步**的（`Promise`），devStub 用
  `localStorage`（key 前缀 `__vag_cloud_data_`），生产环境走云端。
- 注意：当前模板**没有任何地方调用 `platformSdk.initialize(...)`**，`dist/` 里也没有
  `PlatformClient` 注入逻辑。接入存档前要先确认平台端的初始化/capability 声明方式
  （`contracts.ts` 里 `storage` 是一个 capability），本地预览则自动回退 devStub。
- 存档 key 建议 `island-industria/save/slot-1`；版本字段随快照走。
- 自动保存时机（M2 定）：拓扑变化后 debounce 5 s、`visibilitychange` 隐藏时、手动保存时。
- 目前**不做**多槽位/云同步 UI，先把「正常退出后能继续」做对。

## 5. 验收与测试计划

1. 纯逻辑单测：`serialize(state) → JSON → parse → deserialize(state)` 往返相等；
   非法输入逐条跳过；版本迁移（v1→v2）占位测试。
2. playthrough：造一座带机械的工厂 → 触发保存 → 重新加载页面 → 用读投影断言
   库存/建筑/零件/启停/矿量/玩家位置逐项一致（新增 `scripts/m2-save-reload.mjs`）。
3. 稳定性：连续保存/读取 3 次不泄漏、不重复发放套件、不重复扣矿。
4. 负面用例：损坏 JSON、版本过新、未知 itemId 时游戏仍可启动并给出提示。

## 6. 结论与优先级

- 结论：现有状态**都能被序列化**，没有不可导出状态；风险集中在「接口缺失」和「加载顺序」，
  不是格式本身。
- 优先级：P0 先补 5 个服务接口 + 消息协议（预计 1 个里程碑内的独立小步）；
  P1 接入存储与自动保存；P2 主菜单/多槽位/云存档。
- 触发点：**首条生产链动工前**补完 P0，因为生产链会新增「机器输入/输出/进度」状态，
  那时再补接口成本翻倍。
