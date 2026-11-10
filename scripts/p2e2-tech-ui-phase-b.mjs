// P2-E2 科技 UI 验收 · 阶段 B：追踪卡 / 交付 T1.2 / 错误反馈 / 服务页签与布局。
import { NODE, REAL_SAVE_KEY } from './p2e2-tech-ui-lib.mjs';

/** @param {{ play: any, h: any, kit: any, ui: any }} ctx */
export async function runTechUiPhaseB({ play, kit, ui }) {
  const { assert, state, invOf, logStep } = kit;
  const {
    observedStatuses, readHud, readBook, readTech, pollHud, pollBook, pollTech,
    openBookOn, closeBook, clickNode, clickAction,
  } = ui;

  await play.step('05-track-and-persist-across-open-close', async () => {
    // 追踪 T1.2（可研究、未交付）→ 关闭面板后追踪卡必须出现并显示材料现有/需要。
    await clickNode(NODE.chute);
    await clickAction('tech-track');
    const tracked = await pollTech('T1.2 tracked', (view) => view.trackLabel.includes('取消追踪'));
    assert(tracked.trackLabel.includes('取消追踪'), 'track button must become 取消追踪, got ' + tracked.trackLabel);
    await closeBook();
    const hud = await pollHud('tracker visible', (view) => view.mode === 'tracker' && !view.trackerHidden);
    assert(hud.goalHidden, 'order HUD must stay hidden while the tracker is shown (never both)');
    assert(hud.title === '溜槽物流', 'tracker title mismatch: ' + hud.title);
    assert(hud.badge.includes('可研究'), 'tracker badge mismatch: ' + hud.badge);
    assert(hud.mats.length === 3, 'tracker must list all 3 materials, got ' + hud.mats.length);
    assert(hud.mats.every((row) => row.text.includes('/')), 'tracker material rows must show have/required: ' + JSON.stringify(hud.mats));
    assert(hud.trackerRect && hud.trackerRect.right <= 1280 && hud.trackerRect.bottom <= 720,
      'tracker outside 1280x720: ' + JSON.stringify(hud.trackerRect));
    assert(hud.hotbarRect && hud.trackerRect.bottom < hud.hotbarRect.top,
      'tracker must not overlap the hotbar');
    logStep('05-TRACKER', { title: hud.title, badge: hud.badge, mats: hud.mats, blocked: hud.blocked });

    // 关闭再打开，再关闭：追踪目标来自引擎 tech.trackedId，不随面板生命周期丢失。
    await openBookOn('tech');
    await closeBook();
    const again = await pollHud('tracker persists', (view) => view.mode === 'tracker' && view.title === '溜槽物流');
    assert(again.title === '溜槽物流', 'tracker must survive modal open/close');

    // 交付 T1.2 后追踪卡及时更新为已完成。
    await openBookOn('tech');
    await clickNode(NODE.chute);
    for (const itemId of ['shaft', 'gear_12', 'crushed_ore']) {
      const tech = await readTech();
      const row = tech.materials.find((entry) => entry.itemId === itemId);
      assert(row !== undefined && row.buttons.some((button) => button.action === 'tech-submit-rest' && !button.disabled),
        'T1.2 material ' + itemId + ' must be submittable through the UI');
      await clickAction('tech-submit-rest', itemId);
      await pollTech('T1.2 delivery ' + itemId,
        (view) => view.materials.find((entry) => entry.itemId === itemId)?.count.includes('余 0') === true);
    }
    const chuteDone = await pollTech('T1.2 completed',
      (view) => view.nodes.find((node) => node.id === NODE.chute)?.status === 'completed');
    assert(chuteDone.nodes.find((node) => node.id === NODE.input)?.status === 'available', 'T1.4 must unlock after T1.2');
    await closeBook();
    const updated = await pollHud('tracker completed update', (view) => view.mode === 'tracker' && view.badge.includes('已完成'));
    assert(updated.mats.every((row) => row.complete), 'completed tracker must show all materials delivered');
    assert(updated.note.includes('已完成'), 'completed tracker must hint the next step: ' + updated.note);
    logStep('05-TRACKER-COMPLETE', { badge: updated.badge, mats: updated.mats, note: updated.note });
  });

  await play.step('06-error-feedback-and-track-switch', async () => {
    // T1.4 现在可研究：铁锭库存不足 3 件 → 按钮可用但引擎拒绝，UI 必须给出缺多少。
    await openBookOn('tech');
    const tech = await clickNode(NODE.input);
    const iron = tech.materials.find((row) => row.itemId === 'iron_ingot');
    assert(iron !== undefined, 'T1.4 must require iron ingots');
    assert(iron.buttons.some((button) => button.action === 'tech-submit-rest' && !button.disabled),
      'submit button must be enabled when the player owns some but not enough ingots');
    await clickAction('tech-submit-rest', 'iron_ingot');
    const errored = await pollTech('insufficient-items message', (view) => view.error.length > 0);
    assert(errored.errorCode === 'insufficient-items', 'expected insufficient-items, got ' + errored.errorCode);
    assert(errored.error.includes('库存不足') && errored.error.includes('还缺'),
      'error text must explain the shortage: ' + errored.error);
    const s = await state();
    assert(s.tech.nodes.find((node) => node.id === NODE.input)?.status === 'available',
      'failed submission must not change node status');
    logStep('06-ERROR', { code: errored.errorCode, text: errored.error });

    // 切到 T2.1（前置 T1.4 未完成）：追踪卡必须显示「先完成：输入接口盒」，且旧目标消失。
    await clickNode(NODE.output);
    await clickAction('tech-track');
    await closeBook();
    const switched = await pollHud('blocked tracker',
      (view) => view.mode === 'tracker' && view.title === '输出接口与物料连接');
    assert(switched.blocked.includes('输入接口盒'), 'tracker must name the unmet prerequisite: ' + switched.blocked);
    assert(switched.badge.includes('未解锁'), 'tracked locked node must show 未解锁: ' + switched.badge);
    assert(!switched.mats.some((row) => row.itemId === 'crushed_ore'), 'old target materials must disappear after switching');
    logStep('06-TRACK-SWITCH', { title: switched.title, badge: switched.badge, blocked: switched.blocked });
  });

  await play.step('07-service-pages-and-layout', async () => {
    await openBookOn('diagnostics');
    const locked = await play.page.evaluate(() => {
      const pane = document.querySelector('.ii-pane[data-pane="diagnostics"]');
      return {
        title: pane?.querySelector('.ii-diag-locked-title')?.textContent ?? '',
        hint: pane?.querySelector('.ii-diag-locked-hint')?.textContent ?? '',
        machines: pane?.querySelectorAll('.ii-diag-machine').length ?? 0,
        summaryCells: pane?.querySelectorAll('.ii-diag-summary-cell').length ?? 0,
      };
    });
    if (locked.title) {
      assert(locked.hint.includes('T3.2'), 'locked diagnostics must point at T3.2, got ' + locked.hint);
    } else {
      // 若 E2/E3 已实现真实诊断，至少必须给出汇总而不是空白页。
      assert(locked.summaryCells === 5, 'unlocked diagnostics must render the 5 summary cells');
    }
    logStep('07-DIAGNOSTICS', locked);

    await play.page.click('.ii-tab[data-tab="project"]');
    await play.wait(160);
    const project = await play.page.evaluate(() => {
      const pane = document.querySelector('.ii-pane[data-pane="project"]');
      const rect = pane?.getBoundingClientRect();
      return {
        title: pane?.querySelector('.ii-project-title')?.textContent ?? '',
        empty: pane?.querySelector('.ii-project-empty')?.textContent ?? '',
        items: pane?.querySelectorAll('.ii-project-item').length ?? 0,
        proofState: pane?.querySelector('.ii-project-proof')?.getAttribute('data-state') ?? '',
        beginDisabled: pane?.querySelector('[data-ii-action="project-begin-proof"]')?.disabled ?? null,
        rect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
      };
    });
    assert(project.title.length > 0 || project.empty.length > 0, 'project page must render a title or an init state');
    if (project.title.length > 0) {
      assert(project.rect && project.rect.right <= 1280 && project.rect.bottom <= 720,
        'project pane outside 1280x720: ' + JSON.stringify(project.rect));
      assert(project.items === 0 || project.items === 16,
        'combined-works delivery list must be empty (service skeleton) or the full 16 items, got ' + project.items);
    }
    logStep('07-PROJECT', project);

    // 回到科技页做 1280×720 布局断言（面板、页脚、滚动区都在视口内）。
    await play.page.click('.ii-tab[data-tab="tech"]');
    await play.wait(160);
    const layout = await readBook();
    assert(layout.frameRect && layout.frameRect.left >= 0 && layout.frameRect.top >= 0
      && layout.frameRect.right <= 1280 && layout.frameRect.bottom <= 720,
      'modal frame outside 1280x720: ' + JSON.stringify(layout.frameRect));
    assert(layout.saveRect && layout.frameRect && layout.saveRect.bottom <= layout.frameRect.bottom,
      'save footer must stay inside the frame: ' + JSON.stringify([layout.frameRect, layout.saveRect]));
    assert(layout.techRect && layout.frameRect && layout.techRect.bottom <= layout.frameRect.bottom,
      'tech pane must stay inside the frame: ' + JSON.stringify([layout.frameRect, layout.techRect]));
    await play.screenshot('07-tech-page-layout-1280x720');
    await closeBook();
    const hud = await readHud();
    assert(hud.mode === 'tracker' && !hud.trackerHidden, 'HUD tracker must be back after closing the modal');
  });

  await play.step('08-final-evidence', async () => {
    const s = await state();
    const tech = s.tech;
    assert(tech.nodes.length === 12, 'all 12 nodes must remain readable');
    for (const status of ['locked', 'available', 'researching', 'completed']) {
      assert(observedStatuses.has(status), 'the UI never showed status ' + status);
    }
    assert(tech.nodes.find((node) => node.id === NODE.gear)?.status === 'completed');
    assert(tech.nodes.find((node) => node.id === NODE.chute)?.status === 'completed');
    assert(tech.trackedId === NODE.output, 'tracked node must come from tech.trackedId, got ' + tech.trackedId);
    const realSave = await play.page.evaluate((key) => localStorage.getItem(key), REAL_SAVE_KEY);
    assert(realSave === null, 'verification script must not pollute the real save slot: ' + realSave);
    const hud = await readHud();
    assert(hud.mode === 'tracker' && hud.title.includes('输出接口'), 'final HUD must show the tracked node');
    console.log('P2E2-UI-FINAL=' + JSON.stringify({
      statuses: Object.fromEntries(tech.nodes.map((node) => [node.id, node.status])),
      tracked: tech.trackedId,
      unlocked: tech.unlocked,
      inventory: s.inventory,
      observedStatuses: [...observedStatuses],
      hud: { mode: hud.mode, title: hud.title, badge: hud.badge, blocked: hud.blocked },
    }));
    await play.screenshot('08-final-1280x720');
  });
}
