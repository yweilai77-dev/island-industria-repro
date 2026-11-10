import {
  describeTechError,
  type TechMaterialRow,
  type TechNodeView,
  type TechView,
} from './frontend-tech-view.ts';

/**
 * P2-E2 科技页（背包模态里的第二个页签）。
 *
 * 交互边界：
 * - 只读：渲染 `TechView`（由引擎 tech 快照 + 背包库存派生），不本地扣材料、不改节点状态；
 * - 所有提交走 `tech/submit` / `tech/submit-all` / `tech/track` 协议命令，
 *   等下一帧 state 回来后重绘；请求在途时按钮 disabled（体验层防抖，事务原子性在引擎侧）；
 * - 错误码由 `describeTechError` 翻成中文（库存不足给出缺多少、前置未完成给出节点名）。
 */

export interface TechPanelHandle {
  readonly element: HTMLDivElement;
  render(view: TechView | null, inventory: ReadonlyMap<string, number>, projectBlocks?: readonly string[]): void;
  /** 把引擎错误码翻成中文并显示在详情区；返回文案（同时交给全局提示）。 */
  showError(code: string, message: string, inventory: ReadonlyMap<string, number>): string;
  /** 收到新的 state（bridge 已应用命令），清空在途请求。 */
  stateApplied(): void;
  isBusy(): boolean;
  selectedNodeId(): string | null;
}

type PendingKind = 'submit' | 'submit-all' | 'track';

interface PendingRequest {
  readonly kind: PendingKind;
  readonly nodeId: string;
  readonly itemId?: string;
  readonly count?: number;
}

interface TechPanelOptions {
  /** 发送协议命令（frontend-ui 的 send：自动带 v: PROTOCOL_VERSION）。 */
  send(message: Record<string, unknown>): void;
  /** 打开联合工厂页（「等待运行证明」提示的入口）。 */
  openProjectPage?(): void;
}

function span(doc: Document, className: string, text = ''): HTMLSpanElement {
  const element = doc.createElement('span');
  element.className = className;
  if (text) element.textContent = text;
  return element;
}

function button(doc: Document, className: string, text: string, action: string): HTMLButtonElement {
  const element = doc.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = text;
  element.dataset.iiAction = action;
  return element;
}

export function createTechPanel(doc: Document, options: TechPanelOptions): TechPanelHandle {
  const element = doc.createElement('div');
  element.className = 'ii-tech';
  const list = doc.createElement('div');
  list.className = 'ii-tech-list';
  const detail = doc.createElement('div');
  detail.className = 'ii-tech-detail';
  element.append(list, detail);

  let lastView: TechView | null = null;
  let lastInventory: ReadonlyMap<string, number> = new Map();
  let projectBlocks: readonly string[] = [];
  let selectedId: string | null = null;
  let pending: PendingRequest | null = null;
  /** 最近一次提交失败的中文反馈（保留到下一次操作；state 广播不冲掉它）。 */
  let errorText = '';
  let errorCode = '';

  const selectedNode = (): TechNodeView | null =>
    lastView?.nodes.find((node) => node.id === selectedId) ?? null;

  const renderNodeCard = (node: TechNodeView): HTMLButtonElement => {
    const card = doc.createElement('button');
    card.type = 'button';
    card.className = 'ii-tech-node';
    card.dataset.nodeId = node.id;
    card.dataset.status = node.status;
    card.dataset.tone = node.statusTone;
    card.dataset.selected = node.id === selectedId ? '1' : '0';
    card.dataset.iiAction = 'tech-select-node';
    if (node.id === selectedId) card.classList.add('selected');

    const head = doc.createElement('div');
    head.className = 'ii-tech-node-head';
    head.append(
      span(doc, 'ii-tech-node-name', node.name),
      span(doc, 'ii-tech-node-route', node.routeLabel),
    );
    const badge = span(doc, 'ii-tech-badge', node.statusIcon + ' ' + node.statusLabel);
    badge.dataset.tone = node.statusTone;
    badge.dataset.status = node.status;
    head.appendChild(badge);
    card.appendChild(head);

    if (node.description) card.appendChild(span(doc, 'ii-tech-node-desc', node.description));
    const prereq = span(doc, 'ii-tech-prereq');
    prereq.textContent = node.requires.length === 0
      ? '前置：无'
      : '前置：' + node.requires.map((row) => row.name + (row.ok ? ' ✓' : ' ✗')).join(' / ');
    card.appendChild(prereq);
    const mats = span(doc, 'ii-tech-node-mats');
    mats.textContent = '材料：' + node.materials
      .map((row) => row.name + ' ' + row.delivered + '/' + row.required + '（余 ' + row.remaining + '）')
      .join(' · ');
    card.appendChild(mats);
    const unlocks = span(doc, 'ii-tech-node-unlocks');
    unlocks.textContent = '解锁：' + (node.unlocks.length === 0 ? '无' : node.unlocks.map((row) => row.text).join(' / '));
    card.appendChild(unlocks);

    if (node.requiredTotal > 0) {
      const bar = span(doc, 'ii-tech-node-bar');
      const fill = doc.createElement('i');
      fill.style.width = node.progressPercent + '%';
      bar.appendChild(fill);
      card.appendChild(bar);
    }
    if (node.awaitingProof) {
      card.appendChild(span(doc, 'ii-tech-node-awaiting', '材料已齐 ' + node.deliveredTotal + '/' + node.requiredTotal + ' · 等待运行证明'));
    } else if (node.completed) {
      card.appendChild(span(doc, 'ii-tech-node-awaiting', '已完成 · 已交付 ' + node.deliveredTotal + '/' + node.requiredTotal));
    }
    card.addEventListener('click', () => {
      selectedId = node.id;
      errorText = '';
      errorCode = '';
      draw();
    });
    return card;
  };

  const renderMaterialRow = (node: TechNodeView, row: TechMaterialRow): HTMLDivElement => {
    const line = doc.createElement('div');
    line.className = 'ii-tech-material';
    line.dataset.itemId = row.itemId;
    line.dataset.remaining = String(row.remaining);
    const name = span(doc, 'ii-tech-material-name', row.name);
    const count = span(doc, 'ii-tech-material-count', '已交 ' + row.delivered + '/' + row.required + ' · 余 ' + row.remaining);
    const have = span(doc, 'ii-tech-material-have', '库存 ' + row.have);
    const actions = doc.createElement('div');
    actions.className = 'ii-tech-material-actions';
    const one = button(doc, 'ii-tech-btn', '提交 1', 'tech-submit-one');
    one.disabled = pending !== null || !node.submitEnabled || row.remaining <= 0 || row.have <= 0;
    one.title = row.remaining <= 0 ? '该项已交满' : row.have <= 0 ? '库存不足' : '';
    one.addEventListener('click', () => submit(node, row, 1));
    const rest = button(doc, 'ii-tech-btn', '提交全部（' + row.remaining + '）', 'tech-submit-rest');
    rest.disabled = pending !== null || !node.submitEnabled || row.remaining <= 0 || row.have <= 0;
    rest.addEventListener('click', () => submit(node, row, row.remaining));
    actions.append(one, rest);
    line.append(name, count, have, actions);
    return line;
  };

  const submit = (node: TechNodeView, row: TechMaterialRow, count: number): void => {
    if (pending !== null || count <= 0) return;
    errorText = '';
    errorCode = '';
    pending = { kind: 'submit', nodeId: node.id, itemId: row.itemId, count };
    options.send({ type: 'tech/submit', nodeId: node.id, itemId: row.itemId, count });
    draw();
  };

  const drawDetail = (): void => {
    detail.replaceChildren();
    detail.dataset.nodeId = selectedId ?? '';
    const node = selectedNode();
    if (!node) {
      const empty = doc.createElement('div');
      empty.className = 'ii-tech-detail-empty';
      empty.textContent = '选择左侧节点查看详情与交付';
      detail.appendChild(empty);
      return;
    }
    const head = doc.createElement('div');
    head.className = 'ii-tech-detail-head';
    head.append(span(doc, 'ii-tech-detail-name', node.name));
    const badge = span(doc, 'ii-tech-detail-badge', node.statusIcon + ' ' + node.statusLabel);
    badge.dataset.tone = node.statusTone;
    badge.dataset.status = node.status;
    head.appendChild(badge);
    detail.appendChild(head);
    detail.appendChild(span(doc, 'ii-tech-detail-sub', '阶段 ' + node.stage + ' · ' + node.stageLabel + ' · ' + node.routeLabel));
    if (node.description) detail.appendChild(span(doc, 'ii-tech-detail-desc', node.description));
    if (node.purpose) detail.appendChild(span(doc, 'ii-tech-detail-purpose', '目的：' + node.purpose));
    const status = span(doc, 'ii-tech-detail-status', '状态：' + node.statusLabel
      + (node.requiredTotal > 0 ? '（已交付 ' + node.deliveredTotal + '/' + node.requiredTotal + '）' : ''));
    status.dataset.tone = node.statusTone;
    detail.appendChild(status);

    if (node.requiredTotal > 0) {
      const bar = span(doc, 'ii-tech-detail-bar');
      const fill = doc.createElement('i');
      fill.style.width = node.progressPercent + '%';
      bar.appendChild(fill);
      detail.appendChild(bar);
    }

    detail.appendChild(span(doc, 'ii-tech-section', '前置'));
    if (node.requires.length === 0) {
      detail.appendChild(span(doc, 'ii-tech-prereq-line ok', '无前置，可直接研究'));
    } else {
      for (const row of node.requires) {
        const line = span(doc, 'ii-tech-prereq-line ' + (row.ok ? 'ok' : 'off'));
        line.dataset.nodeId = row.id;
        line.dataset.status = row.status;
        line.textContent = row.name + ' · ' + row.statusLabel + ' ' + (row.ok ? '✓' : '✗');
        detail.appendChild(line);
      }
    }

    detail.appendChild(span(doc, 'ii-tech-section', '材料交付'));
    for (const row of node.materials) detail.appendChild(renderMaterialRow(node, row));
    const all = button(doc, 'ii-tech-btn primary', '一键交齐（剩余 ' + Math.max(0, node.requiredTotal - node.deliveredTotal) + ' 件）', 'tech-submit-all');
    all.disabled = pending !== null || !node.submitEnabled || node.requiredTotal <= node.deliveredTotal;
    all.addEventListener('click', () => {
      if (pending !== null) return;
      errorText = '';
      errorCode = '';
      pending = { kind: 'submit-all', nodeId: node.id };
      options.send({ type: 'tech/submit-all', nodeId: node.id });
      draw();
    });
    detail.appendChild(all);

    if (node.awaitingProof) {
      const awaiting = doc.createElement('div');
      awaiting.className = 'ii-tech-awaiting';
      awaiting.textContent = '材料已齐 ' + node.deliveredTotal + '/' + node.requiredTotal + ' · 等待运行证明';
      if (options.openProjectPage) {
        const go = button(doc, 'ii-tech-btn', '去联合工厂页', 'tech-open-project');
        go.addEventListener('click', () => options.openProjectPage?.());
        awaiting.appendChild(go);
      }
      detail.appendChild(awaiting);
    }

    detail.appendChild(span(doc, 'ii-tech-section', '完成后解锁'));
    if (node.unlocks.length === 0) {
      detail.appendChild(span(doc, 'ii-tech-unlock-line', '无'));
    } else {
      for (const row of node.unlocks) {
        const line = span(doc, 'ii-tech-unlock-line');
        line.dataset.kind = row.kind;
        line.dataset.unlockId = row.id;
        line.textContent = row.text;
        detail.appendChild(line);
      }
    }

    const track = button(doc, 'ii-tech-btn' + (node.tracked ? ' active' : ''),
      node.tracked ? '取消追踪' : '追踪此节点', 'tech-track');
    track.disabled = pending !== null;
    track.addEventListener('click', () => {
      if (pending !== null) return;
      errorText = '';
      errorCode = '';
      pending = { kind: 'track', nodeId: node.id };
      options.send({ type: 'tech/track', nodeId: node.tracked ? null : node.id });
      draw();
    });
    detail.appendChild(track);

    const error = doc.createElement('div');
    error.className = 'ii-tech-error';
    error.hidden = errorText.length === 0;
    error.textContent = errorText;
    if (errorCode) error.dataset.code = errorCode;
    detail.appendChild(error);
  };

  const draw = (): void => {
    list.replaceChildren();
    element.classList.toggle('busy', pending !== null);
    if (!lastView) {
      const empty = doc.createElement('div');
      empty.className = 'ii-tech-empty';
      empty.textContent = '科技服务未就绪…';
      list.appendChild(empty);
      detail.replaceChildren();
      return;
    }
    for (const group of lastView.groups) {
      const stage = doc.createElement('div');
      stage.className = 'ii-tech-stage';
      stage.dataset.stage = String(group.stage);
      const head = doc.createElement('div');
      head.className = 'ii-tech-stage-head';
      head.append(
        span(doc, 'ii-tech-stage-label', '阶段 ' + group.stage + ' · ' + group.label),
        span(doc, 'ii-tech-stage-count', group.completedCount + '/' + group.total),
      );
      stage.appendChild(head);
      for (const node of group.nodes) stage.appendChild(renderNodeCard(node));
      list.appendChild(stage);
    }
    drawDetail();
  };

  const render = (view: TechView | null, inventory: ReadonlyMap<string, number>, blocks: readonly string[] = []): void => {
    const hadPending = pending !== null;
    lastView = view;
    lastInventory = inventory;
    projectBlocks = blocks;
    pending = null;
    if (selectedId === null || view === null || !view.nodes.some((node) => node.id === selectedId)) {
      selectedId = view?.tracked?.id ?? view?.nodes.find((node) => node.status === 'available')?.id
        ?? view?.nodes[0]?.id ?? null;
      errorText = '';
      errorCode = '';
    }
    if (hadPending) element.dataset.pending = '0';
    draw();
  };

  const showError = (code: string, message: string, inventory: ReadonlyMap<string, number>): string => {
    const context = pending;
    const text = describeTechError(code, {
      view: lastView,
      inventory,
      nodeId: context?.nodeId ?? selectedId,
      itemId: context?.itemId ?? null,
      count: context?.count ?? null,
      projectBlocks,
      message,
    });
    pending = null;
    errorText = text;
    errorCode = code;
    if (lastView) {
      drawDetail();
      element.classList.remove('busy');
    }
    return text;
  };

  const stateApplied = (): void => {
    if (pending === null) return;
    pending = null;
    draw();
  };

  render(null, lastInventory);
  return {
    element,
    render,
    showError,
    stateApplied,
    isBusy: () => pending !== null,
    selectedNodeId: () => selectedId,
  };
}
