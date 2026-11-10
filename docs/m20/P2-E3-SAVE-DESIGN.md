# M2.0-P2-E3 正式存档设计（快照 v1）

- 阶段：M2.0-P2-E3（工作包 E：持久化与恢复）
- 状态：第一轮落地「数据层 + 世界状态快照/恢复」；真实游戏验收脚本已写、待 Lead 串行运行。
- 结论先行：项目此前没有任何存档实现；本设计把 docs/design/SAVE-ARCHITECTURE.md 的快照 v1
  **扩展并落地**为正式存档（不是临时科技存档）。科技进度直接复用 E1 的
  tech.serialize()/restore()，没有第二套科技存档。

---

## 1. 真实现状（逐系统：状态在哪、现有接口、缺口）

| 系统 | 状态位置（真源） | 现有接口 | 本轮处理 |
|:--|:--|:--|:--|
| 库存 | assets/inventory/inventory.ts 的 InventoryState.stacks | inventory 服务：add/remove/count/has/stacks | 新增 snapshot()/restore() |
| 快捷栏 | assets/hotbar/hotbar.ts 的 HotbarState.slots/selected/revision | hotbar 服务：select/bind/unbind/dropUnavailable | 新增 snapshot()/restore()；revision 不存（读档后自增） |
| 玩家 | assets/player/player.pack.ts 的 PlayerState（position/level/supportId/cell/facingYaw）+ World 资源 PLAYER_STATE_KEY | player 服务只读；无设位接口 | 新增 restorePosition()：内部一次垂直解算，失败回出生点 |
| 资源节点 | assets/resource/resource.pack.ts 的 nodes[].amount/depleted + 实体 | resourceNodes 服务：nodes/isCellBlocked/nodeAtCell/harvest | 新增 snapshot()/restore()（restore 走既有 applyVisual） |
| 普通建筑 | assets/build/build.pack.ts 的 buildings Map<id,{typeIndex,height,placement}> + nextBuildingId | **原先没有服务** | 新增 buildings 服务：snapshotSave/restoreSave；内部重建视图与空间索引 |
| 楼层结构 | assets/build/floors.pack.ts 的 records Map + nextId + columnSlot/slabSlot/pillarCells | **原先没有服务** | 新增 floors 服务：snapshotSave/restoreSave；**楼层是玩家建造的世界状态，必须存**（原先 SAVE-ARCHITECTURE 的 14 类状态漏了它） |
| 机械零件 | registry.ts 的 parts Map<id,{def,placement}> + nextId；mechanical.pack 的 kitGranted World 资源 | mechanical 服务：parts/connections/placePart/updatePlacement 等 | 新增 saveSnapshot()/restoreSave()：不消耗物品、不查科技门控、不重复发起步包 |
| 动力源启停 | assets/mechanical/runtime-state.ts 的 sourceEnabled | 无存档接口 | mechanical-runtime 新增 mechanicalRuntimeSave.snapshotSources/restoreSources |
| 加工运行时 | assets/production/production-runtime.ts 的 machines（输入/输出缓冲+progress+producedTotal）/chutes（在途物品）/producedTotals | 无服务暴露 | mechanical/runtime.ts 通过公开方法暴露 mechanicalRuntimeSave.snapshotProduction/restoreProduction（不复制第二套状态） |
| 接口盒 | assets/industrial/port-runtime.ts 的 byPart（安装位+module+缓冲） | ports 服务读投影 snapshot() | 新增 PortRuntime.restore + ports.saveSnapshot/restoreSave |
| 物料连接 | assets/industrial/link-runtime.ts 的 byId + movedById + 轮询游标 | ports.links() 读投影 | 新增 MaterialLinkRuntime.restore（只校验两端，几何状态运行时重算）；游标不存（派生） |
| 科技 | assets/tech/state.ts 的 TechState（E1） | tech.serialize()/restore() | 直接复用，不新增接口 |
| 订单 | assets/goal/goal-service.ts 的 GoalState（baseline + completed） | goalProgress 只读 state()/snapshot() | **未恢复**：本轮到 goal-service 只读为止，见 §7 |
| 终局 | endgame-types.ts 读投影；完成标记在 TechState 的 T3.3 交付 | endgame 服务只读 | 无需单独切片：终局完成 = tech 进度；运行证明窗口是瞬时状态 |
| 诊断 | diagnostics 完全由动力/加工/接口盒状态派生 | diagnostics 只读 | **不存**（派生量） |
| 组合机械 | assembly 每帧从结构相邻关系推导 | assembly 只读 | **不存**（派生量） |
| 相机/UI/采集/幽灵预览 | camera.pack、frontend、harvest、build 局部变量 | 只读/瞬时 | **不存**（观感或瞬态） |

结论：世界状态此前同样「刷新即丢」，最大缺口是**接口**而非格式；建筑/楼层/机械恢复必须
走既有 SpatialIndex / SupportRegistry / StructureRegistry 原语，否则会得到撞格/悬空的世界。

---

## 2. 快照 v1 完整 JSON 结构

纯 JSON，禁止 EntityHandle / Map / Set / 类实例；所有 id 都是逻辑 id。
未知字段一律丢弃；每个切片独立校验。硬上限 512 KB，超过直接拒绝读取。

    {
      "version": 1,
      "savedAt": "2026-11-10T12:00:00.000Z",
      "engine": "0.4.19",
      "player": { "x": -1.5, "z": 2.5, "level": 0, "yaw": 0 },
      "inventory": { "stacks": [ { "itemId": "iron_ore", "count": 12 } ] },
      "hotbar": { "slots": ["shaft", null, "crusher", null, null, null, null, null, null, null, null, null], "selected": 2 },
      "kitGranted": true,
      "counters": { "nextBuildingId": 4, "nextPartId": 8, "nextFloorId": 4 },
      "floors":   [ { "id": 1, "kind": "pillar", "gx": 0, "gz": 0, "rotation": 0, "level": 0 } ],
      "buildings":[ { "id": 1, "kind": "shed", "gx": 1, "gz": 2, "rotation": 0, "level": 0 } ],
      "parts":    [ { "id": 1, "kind": "shaft", "gx": -6, "gz": 7, "rotation": 0, "level": 0 } ],
      "sources":  [ { "partId": 1, "enabled": true } ],
      "resources":[ { "id": 1, "amount": 17, "depleted": false } ],
      "ports":    [ { "partId": 4, "slotId": "slot.crusher.in.nz", "moduleId": "port.through", "itemId": "iron_ore", "count": 2 } ],
      "links":    [ { "id": "link:4:slot.crusher.out.px->5:slot.smelter.in.nz",
                      "from": { "entityId": 4, "slotId": "slot.crusher.out.px" },
                      "to":   { "entityId": 5, "slotId": "slot.smelter.in.nz" }, "moved": 9 } ],
      "production": {
        "machines": [ { "partId": 4, "recipeId": "crush-iron-ore", "progress": 0.3,
                        "inputItem": "iron_ore", "inputCount": 2,
                        "outputItem": "crushed_ore", "outputCount": 1, "producedTotal": 9 } ],
        "chutes": [ { "partId": 7, "itemId": "iron_ore", "t": 0.4, "blocked": false, "delivered": 3 } ]
      },
      "tech": { "version": 1, "mode": "player", "delivered": {}, "unlocked": [], "trackedId": null },
      "goal": { "baseline": { "crushedOre": 0, "ironIngot": 0, "shaft": 0 }, "completed": [] }
    }

字段决策：
- **只存逻辑 id + kind + placement**：建筑/楼层/零件的宽深高由静态定义（BuildingType、
  floorFootprint、MechanicalPartDef）派生，不重复存。
- **计数器显式存**：sources/ports/links 引用 partId，读档后若重排 id 会断引用，
  所以 nextPartId / nextBuildingId / nextFloorId 必须落盘；解码还会再抬高到
  「已恢复最大 id + 1」以上，防止损坏存档造成 id 冲突。
- **楼层（floors）是 v1 新增的必需切片**：它是玩家建造的支撑面来源，不是派生量。
  不存楼层会导致多层工厂的楼板/楼梯/上层建筑全部丢失。
- **接口盒缓冲与加工缓冲都存**：它们是真实物品所有权，不存等于读档吞物品。
- **tech 是原样 TechState JSON**：版本由 TECH_STATE_VERSION 管理，存档版本不越界解释。
- **goal 预留**：本轮保存 baseline/completed（goalProgress.state() 只读），但恢复未接。
- 体积实测：空快照 445 B；一个 20 零件 + 2 建筑 + 2 楼层 + 2 接口盒 + 1 连接 + 4 矿点的
  中型工厂快照约 3.3 KB（encodeSnapshot 实测）。硬上限 512 KB 只用于防御损坏数据。

---

## 3. 不存派生量（读档后重建）

| 派生量 | 重建方式 |
|:--|:--|
| SpatialIndex（占地/AABB） | 楼层 → 建筑 → 机械按保存顺序重新 register |
| SupportRegistry（支撑面） | 固定平台/楼梯 + floors.restoreSave 的楼板/开孔支撑面 |
| TraversalRegistry（可通行面） | floors.restoreSave 的楼梯 |
| StructureRegistry（碰撞体） | 楼层/建筑/机械恢复时各自注册 |
| 动力拓扑 / 动力解算 / 转速 | 零件恢复后 commitTopology，运行时按 revision 重建 |
| 旋转角 angles / 机器位姿 | 从 0 继续转（视觉量） |
| 连接拓扑（机械动力连接） | registry.rebuildConnections() |
| 物料连接运行状态与轮询游标 | MaterialLinkRuntime 内部索引；状态由 statusOf 按当前几何重算，游标从 0 开始 |
| 加工 running/block 锁存与阻塞原因 | 下一帧由 tickMachine 重新判定 |
| 加工累计产出 producedTotals 全局表 | 不存（见 §7：订单基线随订单重新开始；不涉及物品所有权） |
| 视图实体（建筑 mesh、零件 view、溜槽在途物品 view、幽灵、选中框） | 恢复时重新 spawn，销毁时清理 |
| 玩家 cell / supportId | 由 x/z/level 经一次垂直解算派生 |
| 诊断 / 终局运行证明读数 | 全量派生 |
| 组合机械（assembly） | 从结构相邻关系每帧推导 |

---

## 4. 恢复顺序与事务策略

恢复在 persistence 服务内**一次性解码整包**，再按固定顺序应用：

1. floors（building blocks 的支撑面，必须先于玩家/建筑/机械）
2. player.restorePosition（站在恢复后的支撑面/楼梯上）
3. inventory → 4. hotbar（快捷栏绑定依赖物品 id，不依赖数量）
5. resources（建筑/机械的建造校验会读资源格）
6. buildings（用恢复后的支撑面 + 空间索引校验）
7. mechanical（零件+计数器+起步包标记；用恢复后的支撑面/空间索引校验）
8. sources（动力源启停；先 sync 拓扑再写开关）
9. ports（接口盒安装+盒内缓冲）
10. links（物料连接；只校验两端，几何状态运行时重算）
11. production（机器缓冲/进度 + 溜槽在途物品）
12. tech（复用 tech.restore，未知节点/物品逐条修复）
13. goal（预留：本轮到 goal-service 只读为止，见 §7）

事务策略（诚实边界）：
- **整包不可解析**（坏 JSON / 非对象 / 未来版本 / 超限）→ 不碰世界，status=error，
  message 给人话原因，onStorageData 返回 ok:false。
- **单个切片失败** → 只记录 issue 并继续下一切片；每个系统的 restore 是「替换」语义
  （先清空自己的权威状态再重建），失败条目逐条跳过，不会留下「一半旧一半新」的实体：
  建筑/机械/楼层在恢复前先清理旧实体与空间注册；接口盒/连接/加工在恢复前 clear。
- **单个实体的异常** → 系统内部清理该实体已创建的视图/注册后继续（例如机械零件
  register 成功后 createPartView 失败会反注册并跳过）。
- 无法完全回滚到读档前世界（读档本身就是替换世界）；因此失败时报告 issues 而不是静默。
- **幂等**：同一份快照连续恢复两次得到相同世界；requestSave 同一 JS 回合内多次调用
  合并为一次 transport.post。

---

## 5. 版本与迁移

- 快照版本常量：save-schema.ts 的 SAVE_VERSION = 1。
- migrateSnapshot(raw)：
  - version 缺失 / 非整数 / 负数 → 按 v0 处理，记录 issue，再迁到 v1；
  - version === SAVE_VERSION → 原样通过；
  - version > SAVE_VERSION → **拒绝读取**（保护当前世界，不把新存档写坏）；
  - 迁移函数表 MIGRATIONS 按版本串联；v0→v1 只补版本号（缺失字段由各切片规整补默认）。
- 科技版本独立：TechState.version = 1，由 tech.restore 自己修复；快照版本不越界解释科技。
- 未来新增字段必须可选（解码端缺失即默认），删除/重命名字段必须升 SAVE_VERSION 并加迁移；
  未知字段一律丢弃，因此旧代码读新存档会安全降级（若版本相同）。

---

## 6. 损坏/缺失字段容错策略

统一模式：每个切片有一个纯函数 normalizeXxxSlice(raw) → { value, issues }。
- 未知 itemId / part kind / building kind / floor kind / moduleId / node id → 逐条丢弃；
- 非法数量：负数/小数/NaN/Infinity/超额 → 钳制到合法区间；0 堆叠丢弃；
- placement：非整数格/超范围/非法 rotation → 该条丢弃或 rotation 归 0；level 非法归 0；
- 玩家坐标：有限数并夹到地图边界；level 夹到 [0,64]；yaw 非法归 0；
- 资源储量夹到 [0, IRON_ORE_MAX_AMOUNT]；depleted 由 amount 派生，不一致以 amount 为准；
- 接口盒缓冲件数夹到安装位容量；count>0 但 itemId 为空 → 清空并记录；
- 连接两端必须存在 output→input，缺失的逐条跳过；
- 加工缓冲件数夹到机器容量；recipeId 不存在 → 回退默认配方并记录；
- 重复 id / 重复堆叠 / 重复绑定 → 保留第一个，后续丢弃并记录；
- 计数器小于已恢复最大 id → 自动抬高（防 id 冲突）；
- savedAt 非法 → 使用 epoch（确定性，便于测试）。

所有失败都进入 issues（人话），onStorageData 返回 repaired=true；UI 通过 save.message 显示前 3 条。

---

## 7. 明确不保存 / 剩余集成清单

### 7.1 本轮明确不保存（有理由，不是遗漏）

| 项 | 理由 | 影响 / 后续 |
|:--|:--|:--|
| 飞轮储能 energy | 属于运行中的瞬时能量；SAVE-ARCHITECTURE 只要求存启停 | 读档后飞轮需重新摇；若需要长时储能体验，可升 v2 增 energy 字段 |
| 相机 yaw / 距离；加工全局累计产出 producedTotals | 观感 / 不涉及物品所有权（订单与终局按窗口增量判定） | 镜头回默认；生产目标基线重新开始 |
| 加工 running/block | 当帧派生 | 下一帧重算 |
| 诊断 / 终局运行证明窗口 | 纯派生 / 瞬时 | 读档后窗口回到 idle |
| 采集进度、UI 开关/页签、幽灵/选中/调整状态 | 瞬时 | 读档时取消 |
| 组合机械 assembly | 结构相邻关系派生 | 自动重建 |

### 7.2 剩余集成清单（需要谁配合）

1. **订单状态恢复（goal-service，Goal 工程师）**
   - 现状：goalProgress 只暴露 state()（只读），persistence 已把 goal 切片写进快照；
   - 需要：goal-service 增加 restoreState(raw)（校验 baseline/completed，锁存步骤按顺序），
     并在 mechanical/runtime.ts 的 goalProgress 服务上转发；persistence 已按
     restoreState 是否存在自动调用（不存在时记 issue）。
2. **前端存储通道 + 保存触发（Frontend/桥接工程师）** — 已落地（frontend-save-channel.ts）
   - 下行：persistence 经 transport 发 save/write {data} / save/read / save/clear；
     前端写/读 localStorage（key 由 saveStorageKey 覆盖），读取结果用 save/data 回灌。
   - 触发点：visibilitychange 隐藏、立即保存按钮、每 15 s、新游戏按钮；
     引擎只负责 requestSave（同回合合并）与 requestNewGame（清存储 + 不再自动恢复）。
   - 启动恢复握手：前端在首个 state 后自动发 save/restore；persistence 在 transport 首次注入时
     也兜底自动发一次 save/read（幂等；请求过 restore/newGame 的会话不再自动恢复）。
   - 验收脚本可用正式按钮 [data-ii-action=save-request|save-restore|save-new] 触发，
     或在前端提供 __II_TEST_SAVE__ 时走测试入口。
3. **真实游戏验收脚本（Lead 串行跑）**：scripts/p2e3-save-reload.mjs，见 §9。
4. **新游戏语义**：requestNewGame 只做「清存储 + 本会话不再自动恢复」，不原地重建世界
   （引擎没有「重开世界」的现有原语）；前端收到确认后应 reload 页面进入全新世界。
5. **多槽位/云存档/自动保存 UI**：不在 v1 范围。
6. docs/PROGRESS.md 与既有报告由 Lead 更新；本轮不修改。

---

## 8. 自动保存触发点（契约）

| 时机 | 负责人 | 说明 |
|:--|:--|:--|
| visibilitychange 隐藏 | 前端/桥接 | 页面隐藏前 requestSave（同步收集、transport.post） |
| 保存面板关闭 / 手动保存按钮 | 前端 | UI 显式 requestSave |
| 每 15 s（仅世界发生变化时） | 前端 | 建议与 UI 签名变化联动，避免空转 |
| 科技提交成功后 | 前端（收到 tech 成功回执） | 紧急保存点：避免刷新丢科技 |
| 新游戏 | 前端 | requestNewGame（save/new 命令带 confirm:true） |

引擎侧只保证：requestSave 幂等、同 JS 回合合并、transport 未注入时挂起并在注入后补发。

---

## 9. 验收方式

### 9.1 单测（本轮已跑，不依赖引擎）

- assets/__tests__/save-codec.test.ts（13 例）：
  - encode→JSON→decode 往返相等；防御性拷贝（改输入对象不影响解码结果）；
  - 未知字段/未知系统/未知物品/未知 kind 丢弃；非法值钳制；计数器自动抬高；
  - 缺失字段补默认；版本缺失/v0 迁移；未来版本拒绝；坏 JSON/null/数组/超大字符串不崩溃。
- assets/__tests__/save-slices.test.ts（12 例）：
  - 库存/快捷栏 snapshot→JSON→restore 往返与非法数据修复；
  - PortRuntime.restore 安装+缓冲、容量钳制、重装拒绝；
  - MaterialLinkRuntime.restore 两端校验/累计传递/moved 保留；
  - 加工运行时 snapshot→JSON→restore 后缓冲/进度/溜槽在途一致；
  - MechanicalRegistry nextPartId 存取与 clear 归位。
- assets/__tests__/save-persistence.test.ts（7 例）：用 fake EngineContext 验证编排层：
  - transport 注入前挂起、注入后补发；同回合多次 requestSave 合并；
  - 新游戏发 save/clear + hasSave 归 false；
  - 无存档/坏 JSON 保持世界不变；可解析存档逐切片恢复、缺失服务只记 issue；
  - 初始状态 idle + version=1 + 无存档。

### 9.2 真实游戏脚本（本轮写好，待 Lead 串行执行）

scripts/p2e3-save-reload.mjs（预期 9 个 step，真实键鼠）：
1. 启动 player 模式；2. 采矿石；3. 搭真实工厂（破碎-熔炼-锻压 + 飞轮 + 传动）；
4. 生产并交付一个科技节点；5. 放 1 个普通建筑（证明 buildings 切片）；
6. 断开动力后手动保存，校验存档 JSON 与当前世界一致、体积受限；
7. play.reload() 触发启动自动恢复；
8. 逐项断言库存/建筑/零件(id+kind+placement)/科技/矿量/玩家位置一致；
9. 稳定性：不重复发放起步包、零件 id 不重复、矿量不重复扣减、恢复后仍可重新启动动力。
断言失败信息带「期望/实际/存档字段」，便于定位。

### 9.3 负面用例

损坏 JSON / 未来版本 / 无存档 / 重复恢复由 save-codec 与 save-persistence 单测覆盖（不启动游戏）。

---

## 10. 交付物清单（本轮）

| 文件 | 说明 |
|:--|:--|
| assets/save/save-schema.ts | 快照类型 + SAVE_VERSION + 各切片纯规整函数 |
| assets/save/save-codec.ts | encodeSnapshot / decodeSnapshot / migrateSnapshot |
| assets/save/save-ports.ts | 各系统窄接口 + 待接入 TODO |
| assets/save/persistence.pack.ts | persistence 服务（收集/保存/读取/恢复编排/通道） |
| assets/inventory/inventory.ts | snapshot/restore |
| assets/hotbar/hotbar.ts | snapshot/restore |
| assets/resource/resource.ts + resource.pack.ts | snapshot/restore（applyVisual） |
| assets/player/player.ts + player.pack.ts | restorePosition（垂直解算 + 出生点回退） |
| assets/build/build.pack.ts | buildings 服务 snapshotSave/restoreSave |
| assets/build/floors.pack.ts | floors 服务 snapshotSave/restoreSave |
| assets/mechanical/registry.ts | nextPartId 存取 |
| assets/mechanical/mechanical.pack.ts | saveSnapshot/restoreSave |
| assets/mechanical/runtime.ts | mechanicalRuntimeSave（启停 + 加工） |
| assets/mechanical/production-save.ts | 加工运行时切片纯逻辑 |
| assets/industrial/port-runtime.ts | PortRuntime.restore |
| assets/industrial/link-runtime.ts | MaterialLinkRuntime.restore |
| assets/industrial/ports.ts + port.pack.ts | saveSnapshot/restoreSave |
| assets/__tests__/save-codec.test.ts | 编解码/迁移/容错（13 例） |
| assets/__tests__/save-slices.test.ts | 切片往返（12 例） |
| assets/__tests__/save-persistence.test.ts | 持久化编排（7 例，fake ctx） |
| scripts/p2e3-save-reload.mjs | 真实游戏验收（待跑；9 个 step） |
| docs/m20/P2-E3-SAVE-DESIGN.md | 本文档 |
| assets/mechanical/runtime.ts（GameRead 增量） | 唯一 GameRead 新增只读 buildings/resources 字段，供存档验收断言 |
