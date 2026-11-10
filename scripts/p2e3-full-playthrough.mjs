// M2.0-P2-E3 工作包 F：完整新游戏 Playthrough（阶段 0 → 3 + 终局运行证明 + 存读档）。
//
// 约束：
// - player 正式模式，全程真实键鼠/真实生产/真实科技交付事务；
// - 只允许 __II_TEST_TECH__ / __II_TEST_ENDGAME__（与 UI 同一协议命令，不注入物品/进度/标记）；
// - 唯一读取是 GameRead `mechanical`（含 tech / project / diagnostics）；
// - 存档用隔离键（__II_TEST_FLAGS__.saveStorageKey），避免污染真实存档槽；
// - reload 后由前端存档通道自动读档，断言科技/终局/库存/机械/玩家位置全部恢复且不重复发起步包。
//
// 文件拆分（单文件 < 20KB）：p2f-lib.mjs（工具）、p2f-stages-early.mjs（阶段 0/1/2）、
// p2f-stages-late.mjs（阶段 3/证明/存档）、本文件（启动 + 编排）。
import { createHarness } from './m18-helpers.mjs';
import { createP2f, TECH_NODES } from './p2f-lib.mjs';
import { runEarlyStages } from './p2f-stages-early.mjs';
import { runLateStages } from './p2f-stages-late.mjs';

/** 每次运行一个隔离存档键：既有真实存档/上次失败运行的残留都不会被自动读档。 */
const SAVE_KEY = 'p2f/full-playthrough/' + Date.now();

const STARTER_KIT = {
  shaft: 8, gear_12: 4, gear_24: 2, chute: 2, vertical_drive: 1,
  flywheel_source: 1, crusher: 1, smelter: 1, forge: 1,
};
const FORBIDDEN_IN_KIT = ['interface_box', 'output_interface_box', 'splitter_box', 'merger_box', 'structure_frame', 'power_source', 'machine'];

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  const h = createHarness(play);
  await play.page.addInitScript((key) => {
    globalThis.__II_TEST_FLAGS__ = { progression: 'player', techHooks: true, saveStorageKey: key };
  }, SAVE_KEY);

  await play.step('00-boot-new-game', async () => {
    await play.reload();
    await play.advance(1.0);
    let s = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const candidate = await play.state('mechanical');
        if (candidate && candidate.tech) { s = candidate; break; }
      } catch (error) {
        // 启动中的瞬时不可读：继续等（不修改任何状态）。
      }
      await play.wait(200);
    }
    h.assert(s !== null, 'mechanical GameRead with tech snapshot must become readable');
    h.assert(s.tech.mode === 'player', 'new game must run in player progression mode, got ' + s.tech.mode);
    h.assert(s.diagnostics === null, 'line-diagnostics must be locked at a fresh start (diagnostics=null)');
    h.assert(s.project !== null && s.project.completed === false, 'combined-works must start incomplete');
    h.assert(s.tech.nodes.length === 12, '12 tech nodes must be readable, got ' + s.tech.nodes.length);
    const inv = (itemId) => s.inventory.find((entry) => entry.itemId === itemId)?.count ?? 0;
    for (const [itemId, count] of Object.entries(STARTER_KIT)) {
      h.assert(inv(itemId) === count, 'starter kit ' + itemId + ' must be ' + count + ', got ' + inv(itemId));
    }
    for (const itemId of FORBIDDEN_IN_KIT) {
      h.assert(inv(itemId) === 0, 'starter kit must not grant ' + itemId + ', got ' + inv(itemId));
    }
    h.assert(s.ui.hotbar.selected === 5, 'default hotbar slot must stay 5, got ' + s.ui.hotbar.selected);
    const stored = await play.page.evaluate((key) => globalThis.localStorage.getItem(key), SAVE_KEY);
    h.assert(stored === null, 'isolated save slot must start empty (no stale autosave): ' + String(stored).slice(0, 40));
    await h.learnMovement();
    console.log('P2F-00-BOOT=' + JSON.stringify({ mode: s.tech.mode, diagnostics: s.diagnostics, inventory: s.inventory, saveKey: SAVE_KEY }));
    await play.screenshot('00-boot');
  });

  const F = createP2f(play, h);
  await runEarlyStages(play, F);
  await runLateStages(play, F, SAVE_KEY);

  await play.step('36-final-report', async () => {
    const s = await play.state('mechanical');
    console.log('P2F-FINAL=' + JSON.stringify({
      techUnlocked: s.tech.unlocked,
      tracked: s.tech.trackedId,
      project: s.project?.completed,
      proof: s.project?.proof?.state,
      diagnostics: s.diagnostics ? { summary: s.diagnostics.summary, hasError: s.diagnostics.hasError } : null,
      inventory: s.inventory,
      parts: s.parts.length,
      links: s.links.length,
      assemblies: s.assemblies.map((assembly) => assembly.id + ':' + assembly.memberIds.length),
      produced: s.production.produced,
      saveKey: SAVE_KEY,
      techNodeCount: s.tech.nodes.length,
      expectedNodes: Object.keys(TECH_NODES).length,
    }));
    h.assert(s.project?.completed === true, 'final report requires a completed project');
    await play.screenshot('36-final-report');
  });
}
