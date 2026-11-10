// Play 驱动看门狗：给 CDP/等待类调用加墙钟上限，挂起时快速失败并指出是哪个调用。
// 目的：把「整条 playthrough 神秘卡死 10+ 分钟」变成「某个具体调用 20 s 无响应」的可定位错误。
export function installPlayWatchdog(play, overrides = {}) {
  const base = {
    state: 15000,
    advance: 40000,
    wait: 25000,
    reload: 90000,
    screenshot: 40000,
    keyboard: 30000,
    mouse: 20000,
    evaluate: 25000,
  };
  const limits = { ...base, ...overrides };
  const wrapMethod = (target, name, timeoutOf) => {
    if (!target || typeof target[name] !== 'function') return;
    const original = target[name].bind(target);
    target[name] = async (...args) => {
      const limit = typeof timeoutOf === 'function' ? timeoutOf(...args) : timeoutOf;
      let timer = null;
      const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('play-watchdog: ' + name + ' did not settle in ' + limit + ' ms')), limit);
      });
      const call = original(...args);
      call.catch(() => {});
      try {
        return await Promise.race([call, timeout]);
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    };
  };
  wrapMethod(play, 'state', limits.state);
  wrapMethod(play, 'advance', limits.advance);
  wrapMethod(play, 'wait', (ms) => Math.max(limits.wait, Number(ms) + 10000));
  wrapMethod(play, 'reload', limits.reload);
  wrapMethod(play, 'screenshot', limits.screenshot);
  if (play.keyboard) {
    wrapMethod(play.keyboard, 'press', limits.keyboard);
    wrapMethod(play.keyboard, 'hold', (keys, until) => (typeof until === 'number' ? Math.max(limits.keyboard, until + 10000) : limits.keyboard));
  }
  if (play.mouse) {
    wrapMethod(play.mouse, 'move', limits.mouse);
    wrapMethod(play.mouse, 'click', limits.mouse);
    wrapMethod(play.mouse, 'drag', limits.mouse);
  }
  if (play.page) {
    wrapMethod(play.page, 'evaluate', limits.evaluate);
    if (play.page.keyboard) {
      wrapMethod(play.page.keyboard, 'down', limits.keyboard);
      wrapMethod(play.page.keyboard, 'up', limits.keyboard);
      wrapMethod(play.page.keyboard, 'press', limits.keyboard);
    }
    if (play.page.mouse) {
      wrapMethod(play.page.mouse, 'move', limits.mouse);
      wrapMethod(play.page.mouse, 'click', limits.mouse);
      wrapMethod(play.page.mouse, 'down', limits.mouse);
      wrapMethod(play.page.mouse, 'up', limits.mouse);
    }
  }
  return limits;
}
