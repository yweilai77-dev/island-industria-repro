// 最小复现探针：不建工厂、不按键，只反复推进模拟时间。
// 目的：区分「advance 自身在长循环里卡死」与「某个游戏内状态触发卡死」。
import { installPlayWatchdog } from './p2f-watchdog.mjs';
import { trace } from './p2f-trace.mjs';

const SAVE_KEY = 'p2f/probe-advance-min/' + Date.now();

export default async function playthrough(play) {
  installPlayWatchdog(play, { advance: 20000, state: 15000, wait: 15000, evaluate: 15000 });
  await play.step('00-boot', async () => {
    await play.page.addInitScript((key) => {
      globalThis.__II_TEST_FLAGS__ = { progression: 'player', saveStorageKey: key };
    }, SAVE_KEY);
    await play.reload();
    await play.advance(1);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const s = await play.state('mechanical');
        if (s && s.tech) {
          await play.page.evaluate(() => {
            globalThis.__hb = 0;
            setInterval(() => { globalThis.__hb = (globalThis.__hb ?? 0) + 1; }, 100);
          });
          trace('BOOT-OK', { mode: s.tech.mode });
          return;
        }
      } catch (error) { /* booting */ }
      await play.wait(200);
    }
    throw new Error('state not readable');
  });

  await play.step('01-advance-loop', async () => {
    for (let index = 0; index < 1500; index += 1) {
      if (index % 100 === 0) {
        let heartbeat = null;
        try { heartbeat = await play.page.evaluate(() => globalThis.__hb ?? null); } catch { heartbeat = 'unreadable'; }
        trace('ADV', { index, heartbeat });
      }
      await play.advance(1);
    }
    trace('ADV-DONE', {});
  });

  await play.step('02-report', async () => {
    const heartbeat = await play.page.evaluate(() => globalThis.__hb ?? null);
    trace('FINAL', { heartbeat });
  });
}
