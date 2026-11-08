import type { UiGoalState } from '../game-ui-bridge/goal-view.ts';

/**
 * M2.0-P1-C 工业订单 HUD 面板（DOM 前端组件）。
 * 只消费桥接层传来的 UiGoalState：文案、八步顺序、当前步骤与阻塞原因全部来自引擎，
 * 前端不重新定义任务流程，也不计算完成状态。
 * 面板主体 pointer-events: none，不拦截游戏鼠标操作；只有右上角的展开/收起按钮可点击。
 */

export interface GoalPanelHandle {
  readonly element: HTMLDivElement;
  /** 用最新订单数据重绘；null 表示引擎侧尚未就绪（显示初始化状态）。 */
  render(goal: UiGoalState | null): void;
}

interface StepRow {
  readonly item: HTMLLIElement;
  readonly icon: HTMLSpanElement;
  readonly name: HTMLSpanElement;
  readonly progress: HTMLSpanElement;
}

const INIT_SUBTITLE = '正在同步订单进度…';
const STATUS_OK = '无阻塞 · 按当前目标继续。';

export function createGoalPanel(doc: Document): GoalPanelHandle {
  const element = doc.createElement('div');
  element.className = 'ii-goal';
  element.dataset.state = 'init';
  element.dataset.collapsed = '0';

  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ii-goal-toggle';
  toggle.title = '展开 / 收起工业订单';
  toggle.setAttribute('aria-expanded', 'true');
  toggle.textContent = '▾';

  const head = doc.createElement('div');
  head.className = 'ii-goal-head';
  const titleRow = doc.createElement('div');
  titleRow.className = 'ii-goal-title-row';
  const title = doc.createElement('span');
  title.className = 'ii-goal-title';
  const count = doc.createElement('span');
  count.className = 'ii-goal-count';
  titleRow.append(title, count);
  const subtitle = doc.createElement('div');
  subtitle.className = 'ii-goal-sub';
  const bar = doc.createElement('div');
  bar.className = 'ii-goal-bar';
  const barFill = doc.createElement('i');
  bar.appendChild(barFill);
  const currentLine = doc.createElement('div');
  currentLine.className = 'ii-goal-current-line';
  head.append(toggle, titleRow, subtitle, bar, currentLine);

  const body = doc.createElement('div');
  body.className = 'ii-goal-body';
  const list = doc.createElement('ol');
  list.className = 'ii-goal-steps';
  const detail = doc.createElement('div');
  detail.className = 'ii-goal-detail';
  const detailHead = doc.createElement('div');
  detailHead.className = 'ii-goal-detail-head';
  const detailLabel = doc.createElement('span');
  detailLabel.className = 'ii-goal-detail-label';
  detailLabel.textContent = '当前目标';
  const detailProgress = doc.createElement('span');
  detailProgress.className = 'ii-goal-detail-progress';
  detailHead.append(detailLabel, detailProgress);
  const detailTitle = doc.createElement('div');
  detailTitle.className = 'ii-goal-detail-title';
  const detailDesc = doc.createElement('div');
  detailDesc.className = 'ii-goal-detail-desc';
  const blockerLine = doc.createElement('div');
  blockerLine.className = 'ii-goal-blocker';
  blockerLine.hidden = true;
  blockerLine.dataset.severity = 'warn';
  const statusLine = doc.createElement('div');
  statusLine.className = 'ii-goal-status';
  detail.append(detailHead, detailTitle, detailDesc, blockerLine, statusLine);
  const completeBanner = doc.createElement('div');
  completeBanner.className = 'ii-goal-complete';
  completeBanner.hidden = true;
  body.append(list, detail, completeBanner);
  element.append(head, body);

  let stepRows: StepRow[] = [];
  let collapsed = false;

  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    collapsed = !collapsed;
    element.classList.toggle('ii-goal-collapsed', collapsed);
    element.dataset.collapsed = collapsed ? '1' : '0';
    toggle.textContent = collapsed ? '▸' : '▾';
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });

  const ensureStepRows = (goal: UiGoalState): void => {
    if (stepRows.length === goal.steps.length) return;
    list.replaceChildren();
    stepRows = goal.steps.map(() => {
      const item = doc.createElement('li');
      item.className = 'ii-goal-step pending';
      const icon = doc.createElement('span');
      icon.className = 'ii-goal-step-icon';
      const name = doc.createElement('span');
      name.className = 'ii-goal-step-name';
      const progress = doc.createElement('span');
      progress.className = 'ii-goal-step-progress';
      item.append(icon, name, progress);
      list.appendChild(item);
      return { item, icon, name, progress };
    });
  };

  const renderSteps = (goal: UiGoalState): void => {
    for (let index = 0; index < goal.steps.length; index += 1) {
      const step = goal.steps[index]!;
      const row = stepRows[index]!;
      row.item.className = `ii-goal-step ${step.completed ? 'completed' : step.current ? 'current' : 'pending'}`;
      row.item.dataset.stepId = step.id;
      row.item.dataset.current = step.current ? '1' : '0';
      row.icon.textContent = step.completed ? '✓' : step.current ? '▶' : String(step.index);
      row.name.textContent = step.title;
      row.progress.textContent = step.progress ? `${step.progress.current} / ${step.progress.required}` : '';
    }
  };

  const render = (goal: UiGoalState | null): void => {
    if (goal === null) {
      element.dataset.state = 'init';
      title.textContent = '工业订单';
      subtitle.textContent = INIT_SUBTITLE;
      count.textContent = '— / —';
      barFill.style.width = '0%';
      currentLine.textContent = '正在载入订单…';
      list.replaceChildren();
      stepRows = [];
      detail.hidden = true;
      completeBanner.hidden = true;
      return;
    }
    element.dataset.state = goal.complete ? 'complete' : 'active';
    element.dataset.collapsed = collapsed ? '1' : '0';
    title.textContent = goal.title;
    subtitle.textContent = goal.subtitle;
    count.textContent = `${goal.completedCount} / ${goal.totalCount}`;
    barFill.style.width = goal.totalCount > 0 ? `${(goal.completedCount / goal.totalCount) * 100}%` : '0%';
    currentLine.textContent = goal.complete
      ? '订单完成'
      : goal.currentStep
        ? `当前：${goal.currentStep.title}`
        : '';
    ensureStepRows(goal);
    renderSteps(goal);

    if (goal.complete) {
      detail.hidden = true;
      completeBanner.hidden = false;
      const last = goal.steps[goal.steps.length - 1];
      completeBanner.textContent = last ? `订单完成 · ${last.instruction}` : '订单完成';
      return;
    }
    completeBanner.hidden = true;
    const current = goal.currentStep;
    detail.hidden = current === null;
    if (current === null) return;
    detailTitle.textContent = current.title;
    detailDesc.textContent = current.instruction;
    detailProgress.textContent = current.progress
      ? `${current.progress.current} / ${current.progress.required}`
      : '';
    if (goal.blocker) {
      blockerLine.hidden = false;
      blockerLine.textContent = `⚠ ${goal.blocker.message}`;
      statusLine.hidden = true;
    } else {
      blockerLine.hidden = true;
      statusLine.hidden = false;
      statusLine.textContent = STATUS_OK;
    }
  };

  render(null);
  return { element, render };
}
