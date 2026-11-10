// 阶段 0/1 诊断探针：跑到教学订单（step 03）为止，带 P2F-ORDER-PROGRESS 日志。
import { createHarness } from './m18-helpers.mjs';
import { createP2f, TECH_NODES } from './p2f-lib.mjs';
import { runEarlyStages } from './p2f-stages-early.mjs';
import { installPlayWatchdog } from './p2f-watchdog.mjs';

const SAVE_KEY = 'p2f/probe-order/' + Date.now();

export default async function playthrough(play) {
  installPlayWatchdog(play);
  const h = createHarness(play);
  await play.page.addInitScript((key) => {
    globalThis.__II_TEST_FLAGS__ = { progression: 'player', techHooks: true, saveStorageKey: key };
  }, SAVE_KEY);
  await play.step('00-boot', async () => {
    await play.reload();
    await play.advance(1.0);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const s = await play.state('mechanical');
        if (s && s.tech) {
          h.assert(s.tech.mode === 'player', 'player mode');
          await h.learnMovement();
          console.log('P2F-PROBE-BOOT=' + JSON.stringify({ mode: s.tech.mode, inventory: s.inventory }));
          return;
        }
      } catch (error) { /* 启动中 */ }
      await play.wait(200);
    }
    throw new Error('state not readable');
  });
  const F = createP2f(play, h);
  await runEarlyStages(play, F, { stopAfterStep: '03' });
}