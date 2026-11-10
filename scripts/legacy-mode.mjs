// 旧 M1/M2 验收脚本的 legacy 兼容模式入口（P2-E1）。
//
// 背景：P2-E1 把开局从「临时原型套件」换成「继承工坊」正式起步包并启用科技门控，
// 旧验收脚本依赖的历史原型套件数量 / 快捷栏槽位（Digit1-5 语义、6 号空槽）/ 未解锁配方
// 全部随之改变。引擎为此提供 legacy 兼容模式：
//   - 前端读取页面全局 `__II_TEST_FLAGS__ = { progression: 'legacy' }`，在 hello 里发给引擎；
//   - tech 服务切到 legacy（所有科技门控放行）；
//   - mechanical / ports / assembly 补发历史套件（原型机械套件 + 接口盒 + 结构框架）。
//
// 用法（必须在入口脚本 default export 的第一条语句、任何 calibrate / 放置 / 读取之前）：
//   import { enterLegacyMode } from './legacy-mode.mjs';
//   export default async function playthrough(play) {
//     await enterLegacyMode(play);
//     ...
//   }
//
// 注意：reload 之后是一个全新的世界，原脚本的屏幕↔格子标定与布局必须重新做。
// 分阶段子模块不需要重复调用本函数；如果某个阶段自己 reload 了页面，用 waitForLegacy(play)
// 重新等待「模式 + 套件」就绪即可。

/** 历史原型套件（mechanical 为来源：assets/mechanical/parts.ts 的 PROTOTYPE_KIT）。 */
export const LEGACY_MECHANICAL_KIT = Object.freeze({
  shaft: 24,
  gear_12: 6,
  gear_24: 4,
  power_source: 4,
  machine: 5,
  chute: 3,
  vertical_drive: 2,
  crusher: 3,
  smelter: 3,
  forge: 1,
  flywheel_source: 1,
});

/** 历史接口盒套件（P2-B）：4 + 3 + 1 + 1 = 9 个接口盒。 */
export const LEGACY_PORT_KIT = Object.freeze({
  interface_box: 4,
  output_interface_box: 3,
  splitter_box: 1,
  merger_box: 1,
});

/** 历史结构框架套件（P2-D）：4 个。 */
export const LEGACY_STRUCTURE_KIT = Object.freeze({
  structure_frame: 4,
});

/** legacy 模式期望的全部开局物品与数量（接口盒合计 9 + 结构框架 4）。 */
export const LEGACY_KIT = Object.freeze({
  ...LEGACY_MECHANICAL_KIT,
  ...LEGACY_PORT_KIT,
  ...LEGACY_STRUCTURE_KIT,
});

const ENTER_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 250;
/** reload 是冷启动后的第一次导航；dev runtime 的 bootstrap 需要一点时间才能安全重启。 */
const RELOAD_SETTLE_MS = 1500;
const RELOAD_ATTEMPTS = 3;
const RELOAD_RETRY_MS = 2000;

/** 当前状态里的库存计数（itemId -> count）。 */
function inventoryCounts(state) {
  const counts = new Map();
  const stacks = Array.isArray(state?.inventory) ? state.inventory : [];
  for (const stack of stacks) {
    if (!stack || typeof stack.itemId !== 'string') continue;
    if (typeof stack.count !== 'number') continue;
    counts.set(stack.itemId, stack.count);
  }
  return counts;
}

/**
 * 与 legacy 期望的差异清单；空数组 = 模式与套件都到位。
 * 逐项精确比对（不是「≥」）：legacy 套件只发一次，双重发放或残留正式起步包都必须暴露。
 */
export function legacyMismatches(state) {
  const mismatches = [];
  if (state?.tech?.mode !== 'legacy') {
    mismatches.push(`tech.mode=${String(state?.tech?.mode)} (expected legacy)`);
  }
  const counts = inventoryCounts(state);
  for (const [itemId, expected] of Object.entries(LEGACY_KIT)) {
    const actual = counts.get(itemId) ?? 0;
    if (actual !== expected) mismatches.push(`${itemId}=${actual} (expected ${expected})`);
  }
  return mismatches;
}

/**
 * 轮询唯一 GameRead，直到 tech.mode === 'legacy' 且历史套件全部到账。
 * 30s 内任一条件不满足就抛错（绝不静默继续），错误里带最后一次读到的模式与差异。
 */
export async function waitForLegacy(play) {
  const startedAt = Date.now();
  let lastState;
  let lastError;
  for (;;) {
    try {
      lastState = await play.state('mechanical');
      lastError = undefined;
    } catch (error) {
      lastState = undefined;
      lastError = error;
    }
    if (lastState !== undefined) {
      const mismatches = legacyMismatches(lastState);
      if (mismatches.length === 0) {
        console.log(`[legacy-mode] ready in ${Date.now() - startedAt}ms (tech.mode=legacy, kit=${Object.keys(LEGACY_KIT).length} 项已到账)`);
        return lastState;
      }
    }
    if (Date.now() - startedAt >= ENTER_TIMEOUT_MS) {
      const detail = lastState === undefined
        ? `state('mechanical') unavailable: ${String(lastError)}`
        : `mode=${String(lastState?.tech?.mode)}; mismatches=${JSON.stringify(legacyMismatches(lastState))}`;
      throw new Error(`legacy mode not ready within ${ENTER_TIMEOUT_MS}ms: ${detail}`);
    }
    await play.wait(POLL_INTERVAL_MS);
  }
}

/**
 * 进入 legacy 兼容模式：
 * 1) page.addInitScript 注入 `__II_TEST_FLAGS__ = { progression: 'legacy' }`（每次导航都生效，
 *    因此脚本自己 reload 之后依然是 legacy）；
 * 2) reload 让页面带着 flag 重新启动；
 * 3) 等待 tech.mode === 'legacy' 且历史套件到账。
 *
 * 幂等：如果当前页面已经是 legacy（例如入口脚本 A 调用了另一个入口脚本 B），不重复 reload。
 */
export async function enterLegacyMode(play, options = {}) {
  if (!play || typeof play.page?.addInitScript !== 'function') {
    throw new Error('enterLegacyMode requires a PlayContext whose page supports addInitScript');
  }
  /** 可选：隔离存档键（验收脚本互不污染；不传时与历史行为完全一致）。 */
  const flags = {
    progression: 'legacy',
    ...(typeof options.saveStorageKey === 'string' && options.saveStorageKey.length > 0
      ? { saveStorageKey: options.saveStorageKey } : {}),
  };
  let current;
  try {
    current = await play.state('mechanical');
  } catch {
    current = undefined;
  }
  if (current !== undefined && legacyMismatches(current).length === 0) {
    console.log('[legacy-mode] already in legacy mode; skip reload');
    return current;
  }
  await play.page.addInitScript((value) => {
    globalThis.__II_TEST_FLAGS__ = value;
  }, flags);
  await settleBeforeReload(play);
  await reloadWithRetry(play);
  return waitForLegacy(play);
}

/**
 * reload 前先让当前会话稳定一下：冷启动后立刻导航会让旧 bootstrap 的 domain 还没释放，
 * 新页面可能以 plugin-startup-failed 失败（实测）。这里只等时间，不改任何游戏状态。
 */
async function settleBeforeReload(play) {
  try {
    await play.state('mechanical');
  } catch {
    // 首次读取失败只说明服务尚在启动，继续等时间即可。
  }
  await play.wait(RELOAD_SETTLE_MS);
}

/**
 * reload 失败重试：dev runtime 的冷启动导航偶发 plugin-startup-failed（错误本身提示
 * 「start a new session」，即重新导航）。重试只针对 reload 这一步的偶发失败；
 * 重试仍失败就抛错，绝不带着旧页面静默继续。
 */
async function reloadWithRetry(play) {
  let lastError;
  for (let attempt = 1; attempt <= RELOAD_ATTEMPTS; attempt += 1) {
    try {
      await play.reload();
      return;
    } catch (error) {
      lastError = error;
      const firstLine = String(error?.message ?? error).split('\n')[0];
      console.log(`[legacy-mode] reload attempt ${attempt}/${RELOAD_ATTEMPTS} failed: ${firstLine}`);
      if (attempt < RELOAD_ATTEMPTS) await play.page.waitForTimeout(RELOAD_RETRY_MS);
    }
  }
  throw new Error('legacy mode reload failed after ' + RELOAD_ATTEMPTS + ' attempts: ' + String(lastError?.message ?? lastError));
}
