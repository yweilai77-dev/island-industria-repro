// M2.0-P2-E2 工作包 A 验收脚本的共用工具（DOM 读取、轮询、Tab/页签/按钮点击）。
//
// 边界：只读玩家看到的 DOM（页签、科技页、追踪卡、存档页脚）与 GameRead(mechanical)；
// 所有交互都是真实鼠标点击/按键，不调用 __II_TEST_TECH__ / __II_TEST_ENDGAME__。

export const NODE = {
  gear: 'tech:gear-manufacture',
  chute: 'tech:chute-logistics',
  input: 'tech:input-interface',
  output: 'tech:output-interface',
};

export const SAVE_KEY = 'p2e2-tech-ui/slot-1';
export const REAL_SAVE_KEY = 'island-industria/save/slot-1';

export function createUiKit(play) {
  const observedStatuses = new Set();

  const readHud = () => play.page.evaluate(() => {
    const rectOf = (el) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const goal = document.querySelector('.ii-goal');
    const tracker = document.querySelector('.ii-tracker');
    const hotbar = document.querySelector('.ii-hotbar');
    const visible = (el) => !!el && !el.hidden;
    return {
      goalHidden: !visible(goal),
      goalState: goal?.dataset.state ?? '',
      trackerHidden: !visible(tracker),
      mode: tracker?.dataset.mode ?? '',
      title: tracker?.querySelector('.ii-tracker-title')?.textContent ?? '',
      badge: tracker?.querySelector('.ii-tracker-badge')?.textContent ?? '',
      mats: Array.from(tracker?.querySelectorAll('.ii-tracker-mat') ?? []).map((el) => ({
        itemId: el.dataset.itemId ?? '',
        text: (el.textContent ?? '').trim(),
        complete: el.classList.contains('complete'),
      })),
      blocked: visible(tracker?.querySelector('.ii-tracker-blocked'))
        ? (tracker.querySelector('.ii-tracker-blocked').textContent ?? '')
        : '',
      note: (tracker?.querySelector('.ii-tracker-note')?.textContent ?? ''),
      hint: (tracker?.querySelector('.ii-tracker-hint')?.textContent ?? ''),
      trackerRect: rectOf(tracker),
      hotbarRect: rectOf(hotbar),
    };
  });

  const readBook = () => play.page.evaluate(() => {
    const backdrop = document.querySelector('.ii-backpack');
    const paneVisible = (id) => {
      const pane = document.querySelector('.ii-pane[data-pane="' + id + '"]');
      return !!pane && !pane.hidden;
    };
    const frame = document.querySelector('.ii-frame');
    const save = document.querySelector('.ii-save');
    const techPane = document.querySelector('.ii-pane[data-pane="tech"]');
    const rectOf = (el) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    return {
      open: backdrop ? !backdrop.hasAttribute('hidden') : false,
      tabs: Array.from(document.querySelectorAll('.ii-tab')).map((el) => ({
        tab: el.dataset.tab ?? '',
        label: (el.textContent ?? '').trim(),
        active: el.classList.contains('active'),
      })),
      panes: {
        backpack: paneVisible('backpack'),
        tech: paneVisible('tech'),
        diagnostics: paneVisible('diagnostics'),
        project: paneVisible('project'),
      },
      title: document.querySelector('.ii-title')?.textContent ?? '',
      subtitle: document.querySelector('.ii-sub')?.textContent ?? '',
      saveStatus: document.querySelector('.ii-save-status')?.textContent ?? '',
      saveButtons: Array.from(document.querySelectorAll('.ii-save-btn')).map((el) => el.dataset.iiAction ?? ''),
      frameRect: rectOf(frame),
      saveRect: rectOf(save),
      techRect: rectOf(techPane),
    };
  });

  const readTech = () => play.page.evaluate(() => {
    const pane = document.querySelector('.ii-pane[data-pane="tech"]');
    const nodes = Array.from(document.querySelectorAll('.ii-tech-node')).map((el) => ({
      id: el.dataset.nodeId ?? '',
      status: el.dataset.status ?? '',
      name: el.querySelector('.ii-tech-node-name')?.textContent ?? '',
      badge: el.querySelector('.ii-tech-badge')?.textContent ?? '',
      prereq: el.querySelector('.ii-tech-prereq')?.textContent ?? '',
      mats: el.querySelector('.ii-tech-node-mats')?.textContent ?? '',
      unlocks: el.querySelector('.ii-tech-node-unlocks')?.textContent ?? '',
      awaiting: el.querySelector('.ii-tech-node-awaiting')?.textContent ?? '',
    }));
    const detail = document.querySelector('.ii-tech-detail');
    const error = document.querySelector('.ii-tech-error');
    return {
      paneVisible: !!pane && !pane.hidden,
      stages: Array.from(document.querySelectorAll('.ii-tech-stage')).map((el) => ({
        stage: el.dataset.stage ?? '',
        label: el.querySelector('.ii-tech-stage-label')?.textContent ?? '',
        count: el.querySelector('.ii-tech-stage-count')?.textContent ?? '',
      })),
      nodes,
      detailNodeId: detail?.dataset.nodeId ?? '',
      detailStatus: detail?.querySelector('.ii-tech-detail-status')?.textContent ?? '',
      materials: Array.from(detail?.querySelectorAll('.ii-tech-material') ?? []).map((el) => ({
        itemId: el.dataset.itemId ?? '',
        count: el.querySelector('.ii-tech-material-count')?.textContent ?? '',
        have: el.querySelector('.ii-tech-material-have')?.textContent ?? '',
        buttons: Array.from(el.querySelectorAll('button')).map((button) => ({
          action: button.dataset.iiAction ?? '',
          label: (button.textContent ?? '').trim(),
          disabled: button.disabled,
        })),
      })),
      unlocks: Array.from(detail?.querySelectorAll('.ii-tech-unlock-line') ?? []).map((el) => (el.textContent ?? '').trim()),
      error: error && !error.hidden ? (error.textContent ?? '') : '',
      errorCode: error?.dataset.code ?? '',
      trackLabel: (detail?.querySelector('[data-ii-action="tech-track"]')?.textContent ?? ''),
    };
  });

  const poll = async (label, reader, predicate, timeoutMs = 15000) => {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
      last = await reader();
      if (predicate(last)) return last;
      await play.wait(140);
    }
    throw new Error(label + ' timeout; last=' + JSON.stringify(last));
  };
  const pollHud = (label, predicate, timeoutMs) => poll(label, readHud, predicate, timeoutMs);
  const pollBook = (label, predicate, timeoutMs) => poll(label, readBook, predicate, timeoutMs);
  const pollTech = (label, predicate, timeoutMs) => poll(label, readTech, predicate, timeoutMs);

  const openBookOn = async (tab) => {
    if ((await readBook()).open) {
      await play.page.click('.ii-tab[data-tab="' + tab + '"]');
    } else {
      await play.keyboard.press('Tab');
      await play.advance(0.1);
      await play.wait(260);
      await pollBook('backpack open', (book) => book.open);
      await play.page.click('.ii-tab[data-tab="' + tab + '"]');
    }
    await play.wait(160);
    const book = await readBook();
    if (!book.panes[tab]) throw new Error('tab ' + tab + ' must show its pane');
    const other = tab === 'tech' ? 'backpack' : 'tech';
    if (book.panes[other]) throw new Error('only one pane must be visible at a time');
    return book;
  };

  const closeBook = async () => {
    await play.keyboard.press('Escape');
    await play.advance(0.1);
    await play.wait(280);
    const book = await readBook();
    if (book.open) throw new Error('Escape must close the modal');
  };

  const clickNode = async (nodeId) => {
    await play.page.click('.ii-tech-node[data-node-id="' + nodeId + '"]');
    await play.wait(150);
    const tech = await readTech();
    if (tech.detailNodeId !== nodeId) {
      throw new Error('detail must switch to ' + nodeId + ', got ' + tech.detailNodeId);
    }
    return tech;
  };

  const clickAction = async (action, itemId = '') => {
    const selector = itemId
      ? '.ii-tech-material[data-item-id="' + itemId + '"] [data-ii-action="' + action + '"]'
      : '[data-ii-action="' + action + '"]';
    await play.page.click(selector);
    await play.wait(80);
  };

  return {
    observedStatuses,
    readHud, readBook, readTech, pollHud, pollBook, pollTech,
    openBookOn, closeBook, clickNode, clickAction,
  };
}
