# ISLAND INDUSTRIA

ForgeaX Engine 0.4.19 上的**工厂自动化 Demo**（M2.0-P2：科技树 + 机械动力 + 生产链 + 联合工厂终局）。
本仓库同时用于向 ForgeaX 官方复现一个**阻塞性缺陷**：`project play` 的 `advance()` 在真实游戏状态下永久不返回。

## 这个仓库是什么

- **能玩**：一块采矿场 + 12 节点科技树 + 3 类加工机器 + 物料接口盒 + 联合工厂交付与 60 秒稳定性证明。
- **技术门全绿**：77 个测试文件 / 822 个用例、`typecheck` 0 错误、`forgeax project check` ok、构建 239 个产物。
- **唯一未完成**：21 步完整 Playthrough 被上游 `advance()` 挂起阻断（已写成可直接提交的缺陷报告）。

### 三个最重要的入口

| 想知道 | 打开 |
|:--|:--|
| 这个 bug 怎么复现、怎么提给官方 | [`UPSTREAM-REPRO.md`](UPSTREAM-REPRO.md) + [`docs/m20/UPSTREAM-forgeax-advance-hang-report.md`](docs/m20/UPSTREAM-forgeax-advance-hang-report.md) |
| 项目做到哪一步了 | [`docs/PROGRESS.md`](docs/PROGRESS.md) + [`docs/m20/`](docs/m20/) 六份阶段报告 |
| 怎么跑、怎么验 | 本文件下面的「快速开始」 |

## 快速开始

**环境**：Node 24.x、pnpm 12.x（Windows / macOS / Linux 均可）。首次先装依赖：

```bash
pnpm install
```

| 想做什么 | 命令 |
|:--|:--|
| 跑起来玩 | `pnpm exec forgeax dev`（按提示打开 URL） |
| 工程检查 | `pnpm exec forgeax project check --json` |
| 单元测试 | `pnpm test` |
| 类型检查 | `pnpm typecheck` |
| 构建 | `pnpm exec forgeax project build --json` |
| 打包 Web ZIP | `pnpm exec forgeax project package --output release/island-industria-web.zip --json` |
| 跑长流程验收（21 步） | `pnpm exec forgeax project play scripts/p2e3-full-playthrough.mjs --json --timeout-ms 1800000` |
| 复现上游缺陷（约 3–5 分钟必现） | `pnpm exec forgeax project play scripts/probe-order03.mjs --json --headless --timeout-ms 900000` |

> `project play` 会启动临时浏览器自动玩；不要同时跑两个（会互相抢资源）。长流程建议按上表加 `--timeout-ms`。

## 怎么玩（键位）

| 操作 | 按键 |
|:--|:--|
| 移动 | `W` `A` `S` `D` |
| 旋转视角 / 缩放 | `Q` / `E`，鼠标滚轮 |
| 放置建造物 | 鼠标左键（`R` 旋转方向，`Esc` 取消） |
| 交互 | 鼠标右键（机器取货、飞轮离合、安装位） |
| 采集矿石 | 靠近矿点**按住** `F` |
| 储能 / 投料 | 靠近飞轮**按住** `C` 摇柄；**悬停机器**时按 `C` 投料 |
| 装接口盒 | 悬停机器安装位按 `T` |
| 背包 / 科技 / 诊断 / 联合工厂 | `Tab`（`Esc` 关闭） |
| 快捷栏 | 数字键 `1`–`0` |

**一局的目标**：接第一份工业订单 → 逐步完成科技节点 → 用轴/齿轮/飞轮搭动力网络、接上加工机器与物料接口盒 → 交付出联合工厂并完成 60 秒稳定性证明。

## 复现上游缺陷

```bash
pnpm install
pnpm exec forgeax project play scripts/probe-order03.mjs --json --headless --timeout-ms 900000
```

- **预期**：跑到教学订单步骤并完成，或给出可读的断言失败。
- **实际**：约 3–5 分钟后卡在 `03-tutorial-order-8-steps` 的某次 `advance`/`wait`，页面主线程 100% CPU，直到 `--timeout-ms` 预算耗尽（`play-timeout`）。
- **对照**：不建工厂、不按键连续 `advance(1)` × 1500 次全部正常返回 —— 说明需要特定游戏状态才触发。
- 细节（环境、栈位置、已排除项、证据、给维护者的请求项）全在 [`docs/m20/UPSTREAM-forgeax-advance-hang-report.md`](docs/m20/UPSTREAM-forgeax-advance-hang-report.md)。

## 目录地图

| 路径 | 职责 |
|:--|:--|
| `assets/` | 游戏源码：机械动力、生产、工业接口、科技树、终局、前端 HUD 等 Cordis 插件与资产 |
| `assets/__tests__/` | 与源码就近的 Vitest 测试（77 文件 / 822 用例） |
| `scripts/` | playthrough 与诊断脚本：`p2e3-full-playthrough.mjs`（21 步验收）、`probe-order03.mjs`（复现）、`p2f-watchdog.mjs` / `p2f-trace.mjs`（卡死诊断） |
| `docs/m20/` | M2.0-P2 六份最终报告 + 上游缺陷报告 |
| `docs/PROGRESS.md` | 当前进度与实测证据快照 |
| `docs/feedback.md` | 开发期间确认的 Engine/SDK 问题清单（会随 Web 包发布） |
| `forge.json` | 工程身份、默认场景与持久插件组合的权威配置 |

## 工程边界（ForgeaX 约定）

- `dist/`、`pack-index.json`、DDC 与 `.forgeax/` 都是构建产物，**不要手改**；从 `assets/` 的 author source 重建。
- 资产身份由 GUID 决定；新增内容优先用 `*.pack.ts` 声明 GUID、依赖和输出。
- 只 import `@forgeax/engine` 或 `@forgeax/engine/<package>`，不要直接 import `@forgeax/engine-*`。
- 游戏逻辑是原生 Cordis `Plugin`；清理逻辑放 `ctx.effect()`；DOM/Web Audio 归前端 root。
- 反馈问题写进 `docs/feedback.md`（范围 / 复现 / 期望 / 实际 / 证据 / 状态），不要写密钥。

## 测试与门禁现状

| 门禁 | 结果 |
|:--|:--|
| `pnpm test` | ✅ 77 files / 822 passed |
| `pnpm typecheck` | ✅ 0 errors |
| `pnpm exec forgeax project check --json` | ✅ ok |
| `pnpm exec forgeax project build --json` | ✅ 239 artifacts / 31,867,483 B |
| 21 步完整 Playthrough | ⛔ 被上游 `advance()` 挂起阻断（见上） |

---

## English (short)

**ISLAND INDUSTRIA** — a factory-automation demo on ForgeaX Engine 0.4.19 (tech tree, mechanical power, production chains, combined-works delivery).
All technical gates are green (822 tests, typecheck, project check, build). The only unfinished item is the 21-step acceptance playthrough, blocked by an upstream defect: `play.advance()` never returns on a real gameplay state.
See [`UPSTREAM-REPRO.md`](UPSTREAM-REPRO.md) and the [detailed upstream report](docs/m20/UPSTREAM-forgeax-advance-hang-report.md).
Quick start: `pnpm install`, then `pnpm test` / `pnpm exec forgeax dev`; repro: `pnpm exec forgeax project play scripts/probe-order03.mjs --json --headless --timeout-ms 900000`.