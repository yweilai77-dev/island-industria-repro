import type { UiGoalState } from '../game-ui-bridge/goal-view.ts';
import {
  buildTechTracker,
  hudModeFor,
  type TechTrackerModel,
  type TechView,
  type UiHudMode,
} from './frontend-tech-view.ts';
import { createGoalPanel } from './frontend-goal-panel.ts';

/**
 * P2-E2 HUD 栈：左上角同一块 302px 区域里「订单 HUD / 科技追踪卡 / Tab 提示」互斥显示。
 *
 * 规则（任务书 §三 A6 + 设计 §7.3）：
 * - 教学订单未完成（或订单数据未就绪）→ 订单 HUD；
 * - 订单完成后 → 有追踪目标就显示科技追踪卡，没有就显示「Tab→科技」提示；
 * - 两套 HUD 永远不同时堆叠，因此 1280×600 下不会互相挤压。
 * 面板本身 pointer-events: none（只有订单面板右上角收起按钮可点），不遮挡准星与快捷栏。
 */

export interface TechTrackerHandle {
  readonly element: HTMLDivElement;
  /** model 为 null 时显示「Tab→科技」提示。 */
  render(model: TechTrackerModel | null, mode: UiHudMode): void;
}

function textElement(doc: Document, className: string): HTMLDivElement {
  const element = doc.createElement('div');
  element.className = className;
  return element;
}

export function createTechTracker(doc: Document): TechTrackerHandle {
  const element = doc.createElement('div');
  element.className = 'ii-tracker';
  element.dataset.mode = 'hint';

  const head = textElement(doc, 'ii-tracker-head');
  const title = doc.createElement('span');
  title.className = 'ii-tracker-title';
  const badge = doc.createElement('span');
  badge.className = 'ii-tracker-badge';
  head.append(title, badge);
  const sub = textElement(doc, 'ii-tracker-sub');
  const bar = textElement(doc, 'ii-tracker-bar');
  const barFill = doc.createElement('i');
  bar.appendChild(barFill);
  const mats = textElement(doc, 'ii-tracker-mats');
  const blocked = textElement(doc, 'ii-tracker-blocked');
  blocked.hidden = true;
  const note = textElement(doc, 'ii-tracker-note');
  note.hidden = true;
  const hint = textElement(doc, 'ii-tracker-hint');
  element.append(head, sub, bar, mats, blocked, note, hint);

  const setMaterialRows = (model: TechTrackerModel): void => {
    mats.replaceChildren();
    for (const row of model.materials) {
      const line = textElement(doc, 'ii-tracker-mat');
      line.dataset.itemId = row.itemId;
      line.classList.toggle('complete', row.complete);
      const name = doc.createElement('span');
      name.className = 'ii-tracker-mat-name';
      name.textContent = row.name;
      const count = doc.createElement('span');
      count.className = 'ii-tracker-mat-count';
      // 追踪卡显示「现有/需要」；已交件数放在括号里，玩家一眼能看出是缺料还是没交。
      count.textContent = row.have + '/' + row.required + (row.delivered > 0 ? '（已交 ' + row.delivered + '）' : '');
      line.append(name, count);
      mats.appendChild(line);
    }
  };

  const render = (model: TechTrackerModel | null, mode: UiHudMode): void => {
    if (mode === 'hint' || model === null) {
      element.dataset.mode = 'hint';
      element.dataset.status = 'hint';
      title.textContent = '科技树';
      badge.textContent = '';
      badge.hidden = true;
      sub.textContent = '交付材料解锁配方与能力';
      bar.hidden = true;
      mats.replaceChildren();
      blocked.hidden = true;
      note.hidden = true;
      hint.hidden = false;
      hint.textContent = '按 Tab 打开背包 → 科技页';
      return;
    }
    element.dataset.mode = 'tracker';
    element.dataset.status = model.status;
    title.textContent = model.name;
    badge.hidden = false;
    badge.textContent = model.statusLabel;
    badge.dataset.tone = model.statusTone;
    sub.textContent = model.stageLabel + ' · ' + model.routeLabel;
    bar.hidden = false;
    barFill.style.width = model.progressPercent + '%';
    hint.hidden = true;
    blocked.hidden = model.blockedBy.length === 0;
    blocked.textContent = model.blockedBy.length > 0
      ? '先完成：' + model.blockedBy.join('、')
      : '';
    setMaterialRows(model);
    note.hidden = !(model.completed || model.awaitingProof);
    note.textContent = model.completed
      ? '已完成 · 按 Tab→科技 选择下一项'
      : '材料已齐 · 去联合工厂页开始运行证明';
  };

  render(null, 'hint');
  return { element, render };
}

export interface HudStackHandle {
  readonly element: HTMLDivElement;
  /** 返回本次渲染的 HUD 模式与追踪卡数据（供验收脚本从引擎状态侧交叉核对）。 */
  render(goal: UiGoalState | null, view: TechView | null): { mode: UiHudMode; tracker: TechTrackerModel | null };
}

export function createHudStack(doc: Document): HudStackHandle {
  const element = doc.createElement('div');
  element.className = 'ii-hud';
  const goalPanel = createGoalPanel(doc);
  const tracker = createTechTracker(doc);
  element.append(goalPanel.element, tracker.element);

  const render = (goal: UiGoalState | null, view: TechView | null): { mode: UiHudMode; tracker: TechTrackerModel | null } => {
    const mode = hudModeFor(goal, view);
    goalPanel.render(goal);
    goalPanel.element.hidden = mode !== 'order';
    tracker.element.hidden = mode === 'order';
    const trackerModel = mode === 'tracker' ? buildTechTracker(view) : null;
    tracker.render(trackerModel, mode);
    return { mode, tracker: trackerModel };
  };

  render(null, null);
  return { element, render };
}
