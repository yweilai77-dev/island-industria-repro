# ISLAND INDUSTRIA — ForgeaX 官方问题复现仓库

这个仓库是 **ISLAND INDUSTRIA**（ForgeaX Engine 0.4.19 上的工厂自动化小游戏）在 M2.0-P2 阶段的完整项目代码，
同时用于向 ForgeaX 官方提交一个**阻塞性缺陷的复现**。

## 问题（一句话）

`forgeax project play` 的页面侧推进函数 `advanceGameTime()` 调用 `app.stepFrame()` 后**永久不返回**；
devkit 的 120 s deadline 只在 `stepFrame` 返回后才检查，因此对同步阻塞无效。
之后所有 CDP 调用（`play.advance` / `play.state` / `play.wait` / 截图）全部挂起，只有 CLI 脚本预算能终止。

详细报告（环境、栈位置、已排除项、证据、给维护者的请求项）：
**[docs/m20/UPSTREAM-forgeax-advance-hang-report.md](docs/m20/UPSTREAM-forgeax-advance-hang-report.md)**

## 复现步骤

```bash
pnpm install
pnpm exec forgeax project play scripts/probe-order03.mjs --json --headless --timeout-ms 900000
```

- 预期：跑到教学订单步骤并完成（或给出可读的断言失败）。
- 实际：约 3–5 分钟后卡在 step 03 的某个 `advance`/`wait`，页面主线程 100% CPU，直到 900 s 预算耗尽（`play-timeout`）。
- 对照实验（不建工厂、不按键，连续 `advance(1)` × 1500 次）：全部正常返回，说明纯帧推进没问题，
  卡死需要特定游戏状态（建好 15 个零件 + 3 台机器 + 飞轮，投料加工 + 鼠标/键盘交互后）。

## 仓库内容

- `assets/`：游戏源码（机械/生产/工业接口/科技树/终局等系统）与 822 个单测
- `docs/m20/`：M2.0-P2 六份最终报告 + 本缺陷报告
- `scripts/`：play 脚本与诊断工具（`probe-order03.mjs` 是本次复现入口；`p2f-watchdog.mjs`、`p2f-trace.mjs` 是卡死诊断工具）
- 复现日志样例：脚本运行时会把逐动作追踪写到 `.verify/p2f-live.log`（仓库不包含该文件）

## 状态

项目自身门禁：`pnpm test` 77 文件 / 822 用例全绿，`typecheck` 0 错误，`forgeax project check` ok。
唯一未完成项就是上面的 `advance()` 挂起——它阻断了 21 步完整 playthrough 验收。

---

## English

Full project code for **ISLAND INDUSTRIA** (a factory-automation game on ForgeaX Engine 0.4.19), plus a reproduction of a blocking defect:
`project play` `advance()` hangs forever because the page-side `advanceGameTime()` calls `app.stepFrame()` synchronously and its 120 s deadline is only checked after `stepFrame` returns.
After the hang, every CDP call queues forever; only the CLI script budget can terminate the run.

See **[the detailed report](docs/m20/UPSTREAM-forgeax-advance-hang-report.md)** for environment, stack location, ruled-out causes, evidence, and requests to the maintainers.
Repro: `pnpm install && pnpm exec forgeax project play scripts/probe-order03.mjs --json --headless --timeout-ms 900000`.