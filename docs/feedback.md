# Game Feedback

记录开发期间确认的 Engine、SDK、模板、构建、资产、运行时或浏览器问题。该文件会和根
`README.md` 一起原样进入 Web ZIP；不要写入 token、密码、私有 URL 或其他敏感信息。

```markdown
### YYYY-MM-DD — Short issue title

- Scope: Engine | SDK | template | build | asset | runtime | browser
- Reproduction: exact command or smallest user-visible sequence
- Expected: what should happen
- Actual: what happened
- Evidence: log, screenshot, URL, or commit path
- Status: open | workaround | fixed | blocked
```
### 2026-11-11 — `project play` 的 `advance()` 在真实游戏状态下永久不返回（devkit/engine 层，阻塞长流程验收）

- Scope: SDK（@forgeax/engine 0.4.19 devkit `project play`）+ Engine（疑似 `app.stepFrame` 同步阻塞）
- Reproduction: `pnpm exec forgeax project play scripts/probe-order03.mjs --json --headless --timeout-ms 900000`；约 3–5 分钟后卡在 step 03 的某次 `advance`（见 `docs/m20/UPSTREAM-forgeax-advance-hang-report.md`）
- Expected: `play.advance(seconds)` 在有限时间内返回（失败也应返回 `advance-failed`，而不是永久挂起）
- Actual: 页面侧 `advanceGameTime()` 调用 `app.stepFrame()` 后不返回；devkit 的 120 s `ADVANCE_TIMEOUT_MS` 只在 `stepFrame` 返回后检查，对同步阻塞无效；之后 `play.advance` / `play.state` / `play.wait` / 截图全部挂起，只有 CLI 脚本预算能终止进程。对照实验：不建工厂、不按键连续 `advance(1)` × 1500 次全部正常返回，说明需要特定游戏状态才触发
- Evidence: `docs/m20/UPSTREAM-forgeax-advance-hang-report.md`（环境/栈位置/已排除项/证据/复现率）、`.verify/p2f-live.log` 逐动作追踪、`artifacts/play/scripts/probe-order03/` 运行产物
- Status: open（已上报，等待上游定位；本仓库长流程验收因此被阻断）