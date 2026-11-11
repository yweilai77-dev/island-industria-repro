# UPSTREAM 问题报告：`project play` 的 `advance()` 在真实游戏状态下永久不返回

> 面向 ForgeaX Engine / Devkit 维护者的缺陷报告（供直接提交 issue）。
> 附：项目内复现脚本与证据。我们同时说明「已排除」与「未排除」的部分，避免误导。

## 1. 一句话结论

`forgeax project play` 的页面侧推进函数 `advanceGameTime()` 在调用 `app.stepFrame()` 时**同步阻塞、永不返回**：
devkit 自己的 120 s deadline 也无法生效（因为控制流没有回到 `advanceGameTime` 的循环里），
此后所有 CDP 调用（`play.advance`、`play.state`、`play.wait`、screenshot）全部排队不返回，只剩 CLI 的脚本预算能终止进程。

## 2. 环境

| 项 | 值 |
|:--|:--|
| OS | Windows 10/11 x64 |
| Node | v24.19.0 |
| pnpm | 12.15.0 |
| @forgeax/engine | 0.4.19 |
| Playwright Chromium | 153.0.8010.12（`ms-playwright/chromium-1243`） |
| 运行方式 | `pnpm exec forgeax project play scripts/probe-order03.mjs --json --headless --timeout-ms 900000` |
| 渲染后端 | hardware（NVIDIA Ampere，见 capture.json） |
| 项目 | ISLAND INDUSTRIA（本仓库，`@local/island-industria`） |

## 3. 症状

1. 前若干分钟一切正常（采集、放置 15 个零件、建动力网络、投料、加工都正常，`advance()` 单次约 0.15 s）。
2. 在游戏内推进约 20–60 s 后的某一次 `advance(4)` 开始**永不返回**。
3. 页面主线程持续占用 CPU（chrome renderer 进程 CPU 持续增长，WorkingSet 约 1.1 GB）；CLI 每 30 s 仍打印进度（Node 侧事件循环还活着），但脚本没有任何进展。
4. 把该处的 `advance` 换成 `play.wait(4000)` 同样卡住 —— 说明不是 `advance` 特有的语义问题，而是**页面/CDP 通道整体失去响应**。
5. 最终只有 `--timeout-ms` 能结束进程（`play-timeout`）。

## 4. 栈位置（我们读到的实现）

- devkit 页面侧推进：`@forgeax/engine/node_modules/@forgeax/engine-devkit/dist/chunk-FI3L5X3D.mjs`
  - `async function advanceGameTime(app, { seconds, stepSeconds, timeoutMs, render })`（约 4237 行）
  - 循环：`const result = app.stepFrame(delta, { render: render || stepped === frames - 1 });`
  - `stepFrame` 返回 `credit` 错误时才 `await yieldTask()`；**deadline 只在 `stepFrame` 返回后才检查**。
- CLI 侧超时：`engine-devkit/dist/play-Q4ZMD5L4.mjs:231`，`var ADVANCE_TIMEOUT_MS = 12e4;`（120 s）
- 帧步进实现：`@forgeax/engine/node_modules/@forgeax/engine-app/dist/chunk-TDDEDUDY.mjs`（`stepFrame` 约 2924 / 1174 / 1726 行）。

因此如果某一次 `app.stepFrame()` 进入同步死循环（或同步等待永远不完成的事情），
`advanceGameTime` 的 120 s deadline 永远没有机会生效，整个页面线程被占住，CDP 全部阻塞。

## 5. 复现步骤

```bash
git clone <this repo>
cd "ISLAND INDUSTRIA"
pnpm install
pnpm exec forgeax project play scripts/probe-order03.mjs --json --headless --timeout-ms 900000
```

- 预期：跑到教学订单步骤，打印 `P2F-TICK ...` 并完成（或按脚本断言失败并给出可读错误）。
- 实际：3–5 分钟后停在 `03-tutorial-order-8-steps` 的某个 `advance` / `wait`，页面线程占用 100% CPU，CLI 一直打印 30 s 进度直到预算结束。
- 复现率：本机长流程多次运行（不同布局、不同投料量）均命中；**最短一次在进入 step 03 后约 20 s 游戏时间**。

## 6. 我们已排除的

| 项 | 实验 | 结果 |
|:--|:--|:--|
| 纯 `advance` 长循环 | 不建工厂、不按键，boot 后连续 `advance(1)` **1500 次**（游戏内 1500 s） | ✅ 全部返回；页面内 `setInterval` 心跳持续增长；console/page 错误 0 |
| CLI 整体存活 | 卡死期间 CLI 每 30 s 仍能打印进度 | ✅ Node 事件循环正常，卡的是页面/CDP |
| 内存崩溃/未捕获异常 | `errors.console`、`errors.page` 卡死前均为 0 | ✅ 不是 JS 异常 |
| 断言/等待条件错误 | 卡死发生在 `advance()` 调用内部（追踪停在 BEFORE-ADVANCE），断言未执行 | ✅ 不是我们的断言问题 |

## 7. 我们尚未排除的（诚实说明）

- **我们自己的某个 Cordis 插件 system 在一次 `stepFrame` 里同步死循环**（这是最需要官方帮助定位的点：我们无法在卡死时拿到页面栈）。
- **引擎渲染路径在 headless/特定场景下的同步阻塞**（本场景约 20 个机械零件、动态视图实体、阴影/材质）。
- **输入系统在 `stepFrame` 期间的同步等待**：纯 advance 不按键不复现；而卡死都发生在「鼠标悬停机器 + 按键投料/摇杆」之后（多次观察到这一相关性）。

## 8. 希望官方提供 / 修复的内容（按优先级）

1. **让 `advanceGameTime` 的 deadline 对「同步阻塞」也生效**：例如把帧步进放到可中断的执行上下文，或在 `app.stepFrame` 内部加每帧/每系统的合作式时间预算，超时立刻 return 错误（`advance-failed`），而不是永久挂起。
2. **提供页面侧卡死时的栈采样手段**：play 期间暴露调试入口（CDP `Profiler`/`Debugger.pause` 或 devkit 内置 sampler），让外部脚本在 `advance` 超时后拿到当前 JS 栈/最后执行的 system 名。
3. **确定性帧驱动模式**：`--deterministic`（不依赖 rAF/合成器，按固定帧推进并在每帧后让出），避免页面/合成器状态影响长流程验收。
4. 如确认是引擎侧渲染/输入死锁，请给出最小修复版本；我们可以在本仓库上复测（脚本已就绪）。

## 9. 证据摘录

### 9.1 脚本内实时追踪（`.verify/p2f-live.log`，最后一行即卡死点）

```text
[2026-11-10T20:33:02.209Z] #15 FEED-END {"partId":6,"fed":2,"times":2,"attempts":2}
[2026-11-10T20:33:02.214Z] #16 BEFORE-ADVANCE order crush {"elapsed":8}
（之后数分钟无任何记录；同一次运行把此处换成 play.wait(4000) 也停在同一位置）
```

### 9.2 CLI 进度（卡死后只有 30 s 一行）

```text
forgeax project play: 150 s, running the script (step "03-tutorial-order-8-steps"), 500 steps done
forgeax project play: 180 s, ... 500 steps done
... 直到 900 s 预算耗尽（play-timeout）
```

### 9.3 进程侧

- chrome renderer：CPU 累计约 336 s，WorkingSet 约 1.1 GB（卡死后持续增长）。
- node（CLI）：CPU 累计约 334 s；仍在打印进度。

### 9.4 对照实验（不按键、只 advance）

```text
ADV {"index":1400,"heartbeat":238}
ADV-DONE {}
FINAL {"heartbeat":255}
# play 结果：passed（console 0 / page 0）
```

## 10. 附：我们游戏侧的自查（便于官方判断是否属于引擎）

- 已审查所有 per-frame 系统里的 `while` 循环：`power.ts`（BFS 带 visited）、`production-runtime.ts`（输出缓冲循环有递减）、`port-runtime.ts`、`assembly-runtime.ts`、`inventory.ts`、`tech/state.ts` —— 均有明确终止条件。
- 我们的 `diagnostics` / `endgame` / `persistence` 等新系统已加 5 Hz 节流，卡死前 revision 正常递增。
- **若官方判断更可能是游戏代码**，也请告诉我们建议的采样方式；我们会在本仓库继续缩小到具体 system 并修复。

---

## 11. English summary (for issue filing)

**Title:** `project play` `advance()` never returns on a real gameplay scene (page main thread blocked; devkit 120 s deadline not effective)

**Summary:** In `forgeax/engine@0.4.19` + `forgeax project play`, after several minutes of production gameplay, a single `play.advance(4)` call hangs forever. The page-side `advanceGameTime()` (devkit `chunk-FI3L5X3D.mjs`, about line 4237) calls `app.stepFrame()` and never returns; since the 120 s `ADVANCE_TIMEOUT_MS` deadline is only checked after `stepFrame` returns, it cannot interrupt a synchronous block. All subsequent CDP calls (including `play.wait`, which does not depend on rAF) queue and never resolve. Only the CLI script budget terminates the run.

**Ruled out:** a pure `advance(1)` loop x1500 with no input and no gameplay: all return, page heartbeat continues, 0 console/page errors. So plain stepping is fine; the hang needs a specific in-game state (building a 15-part machine line, feeding machines, mouse/keyboard interaction).

**Ask:** (1) make the advance deadline cover synchronous frame steps, (2) expose a stack-sampling hook when a frame step stalls, (3) provide a deterministic frame-stepping mode. Reproduction project and script are attached (see section 5).
