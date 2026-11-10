import type {
  DiagnosticsView,
  ProjectView,
} from './frontend-service-view.ts';

/**
 * P2-E2 服务页签 DOM：产线诊断页 + 联合工厂页。
 *
 * 只渲染 `DiagnosticsView` / `ProjectView`（引擎服务快照的纯映射）；
 * 页里的按钮只发协议命令（project/proof/begin|cancel），不改任何服务状态。
 */

export interface DiagnosticsPanelHandle {
  readonly element: HTMLDivElement;
  render(view: DiagnosticsView): void;
}

export interface ProjectPanelHandle {
  readonly element: HTMLDivElement;
  render(view: ProjectView | null): void;
}

function div(doc: Document, className: string, text = ''): HTMLDivElement {
  const element = doc.createElement('div');
  element.className = className;
  if (text) element.textContent = text;
  return element;
}

function span(doc: Document, className: string, text = ''): HTMLSpanElement {
  const element = doc.createElement('span');
  element.className = className;
  if (text) element.textContent = text;
  return element;
}

function machineStateText(row: DiagnosticsView['machines'][number]): string {
  if (!row.powered) return '无动力';
  if (row.block !== 'ok') return row.blockLabel;
  return row.running ? '运行中' : '空闲';
}

export function createDiagnosticsPanel(doc: Document): DiagnosticsPanelHandle {
  const element = div(doc, 'ii-diag');

  const render = (view: DiagnosticsView): void => {
    element.replaceChildren();
    element.dataset.locked = view.locked ? '1' : '0';
    if (view.locked) {
      const locked = div(doc, 'ii-diag-locked');
      locked.append(
        span(doc, 'ii-diag-locked-title', '产线诊断未解锁'),
        span(doc, 'ii-diag-locked-hint', view.lockedText ?? '完成 T3.2 多级产线整合后解锁'),
      );
      element.appendChild(locked);
      return;
    }

    const summary = div(doc, 'ii-diag-summary');
    const entries: readonly (readonly [string, number, string])[] = [
      ['机器', view.summary.total, 'total'],
      ['运行', view.summary.running, 'running'],
      ['空闲', view.summary.idle, 'idle'],
      ['阻塞', view.summary.blocked, 'blocked'],
      ['有动力', view.summary.powered, 'powered'],
    ];
    for (const [label, value, key] of entries) {
      const cell = div(doc, 'ii-diag-summary-cell');
      cell.dataset.metric = key;
      cell.append(span(doc, 'ii-diag-summary-value', String(value)), span(doc, 'ii-diag-summary-label', label));
      summary.appendChild(cell);
    }
    if (view.hasError) summary.dataset.error = '1';
    element.appendChild(summary);

    if (view.bottleneck) {
      const bottleneck = div(doc, 'ii-diag-bottleneck');
      bottleneck.dataset.kind = view.bottleneck.kind;
      bottleneck.append(
        span(doc, 'ii-diag-bottleneck-label', '瓶颈：' + view.bottleneck.label),
        span(doc, 'ii-diag-bottleneck-detail', view.bottleneck.detail),
      );
      element.appendChild(bottleneck);
    }

    element.appendChild(div(doc, 'ii-diag-section', '加工核心（' + view.machines.length + '）'));
    if (view.machines.length === 0) {
      element.appendChild(div(doc, 'ii-diag-empty', '还没有可诊断的加工核心。'));
    }
    for (const row of view.machines) {
      const card = div(doc, 'ii-diag-machine');
      card.dataset.partId = String(row.partId);
      card.dataset.coreId = row.coreId;
      card.dataset.severity = row.severity;
      card.dataset.running = row.running ? '1' : '0';
      card.dataset.powered = row.powered ? '1' : '0';
      const head = div(doc, 'ii-diag-machine-head');
      head.append(span(doc, 'ii-diag-machine-name', row.label + ' #' + row.partId));
      const state = span(doc, 'ii-diag-machine-state', machineStateText(row));
      state.dataset.severity = row.severity;
      head.appendChild(state);
      card.appendChild(head);
      const line1 = span(doc, 'ii-diag-machine-line',
        '配方：' + (row.recipeLabel ?? '无') + ' · 进度 ' + row.progressPercent + '%');
      const line2 = span(doc, 'ii-diag-machine-line',
        '输入：' + row.inputText + ' · 输出：' + row.outputText);
      const portFlags: string[] = [];
      if (row.inputPortFull) portFlags.push('输入口满');
      if (row.outputPortFull) portFlags.push('输出口满');
      const line3 = span(doc, 'ii-diag-machine-line',
        '接口盒：' + (portFlags.length > 0 ? portFlags.join(' / ') : '正常')
        + (row.blockedLinkId ? ' · 阻塞连接：' + row.blockedLinkId : ''));
      card.append(line1, line2, line3);
      if (row.conditions.length > 0) {
        const conditions = div(doc, 'ii-diag-conditions');
        for (const condition of row.conditions) {
          const line = span(doc, 'ii-diag-condition ' + (condition.ok ? 'ok' : 'off'));
          line.dataset.conditionId = condition.id;
          line.dataset.ok = condition.ok ? '1' : '0';
          line.textContent = (condition.ok ? '✓ ' : '✗ ') + condition.label
            + (condition.detail ? '：' + condition.detail : '');
          conditions.appendChild(line);
        }
        card.appendChild(conditions);
      }
      if (row.message) card.appendChild(span(doc, 'ii-diag-machine-message', row.message));
      element.appendChild(card);
    }

    element.appendChild(div(doc, 'ii-diag-section', '物料连接（' + view.links.length + '）'));
    if (view.links.length === 0) {
      element.appendChild(div(doc, 'ii-diag-empty', '还没有物料连接。'));
    }
    for (const link of view.links) {
      const row = div(doc, 'ii-diag-link');
      row.dataset.linkId = link.id;
      row.dataset.state = link.state;
      row.dataset.blocked = link.blocked ? '1' : '0';
      row.dataset.severity = link.severity;
      row.append(
        span(doc, 'ii-diag-link-route', link.fromCoreId + ' → ' + link.toCoreId),
        span(doc, 'ii-diag-link-state', link.stateLabel + ' · 已传 ' + link.transferred + ' 件'
          + (link.blocked ? ' · 阻塞' : '')),
      );
      if (link.message) row.appendChild(span(doc, 'ii-diag-link-message', link.message));
      element.appendChild(row);
    }
  };

  return { element, render };
}

export interface ProjectPanelOptions {
  send(message: Record<string, unknown>): void;
}

export function createProjectPanel(doc: Document, options: ProjectPanelOptions): ProjectPanelHandle {
  const element = div(doc, 'ii-project');

  const render = (view: ProjectView | null): void => {
    element.replaceChildren();
    if (!view) {
      element.appendChild(div(doc, 'ii-project-empty', '终局服务未就绪…'));
      return;
    }
    element.dataset.completed = view.completed ? '1' : '0';
    element.dataset.deliveryComplete = view.deliveryComplete ? '1' : '0';
    element.dataset.proofState = view.proof.state;

    if (view.banner) {
      const banner = div(doc, 'ii-project-banner');
      banner.append(span(doc, 'ii-project-banner-title', 'Demo 通关'), span(doc, 'ii-project-banner-text', view.banner));
      element.appendChild(banner);
    }

    const head = div(doc, 'ii-project-head');
    head.append(span(doc, 'ii-project-title', '联合工厂总成'));
    const status = span(doc, 'ii-project-status',
      view.completed ? '已完成' : view.unlocked ? '可交付' : '未解锁');
    status.dataset.tone = view.completed ? 'ok' : view.unlocked ? 'accent' : 'muted';
    head.appendChild(status);
    element.appendChild(head);

    // ---- 成套交付 ----
    const deliveryHead = div(doc, 'ii-project-section');
    deliveryHead.append(
      span(doc, 'ii-project-section-title', '成套设备交付'),
      span(doc, 'ii-project-section-count', view.totalDelivered + '/' + view.totalRequired
        + (view.deliveryComplete ? ' · 已交齐' : '')),
    );
    element.appendChild(deliveryHead);
    const deliveryList = div(doc, 'ii-project-delivery');
    for (const row of view.deliveryRows) {
      const line = div(doc, 'ii-project-item');
      line.dataset.itemId = row.itemId;
      line.dataset.complete = row.complete ? '1' : '0';
      line.append(
        span(doc, 'ii-project-item-name', row.name),
        span(doc, 'ii-project-item-count', row.delivered + '/' + row.required),
        span(doc, 'ii-project-item-have', '库存 ' + row.have),
        span(doc, 'ii-project-item-ok', row.complete ? '✓ 已交付' : '— 未交付'),
      );
      deliveryList.appendChild(line);
    }
    element.appendChild(deliveryList);

    // ---- 运行证明 ----
    const proofHead = div(doc, 'ii-project-section');
    proofHead.append(
      span(doc, 'ii-project-section-title', '运行证明'),
      span(doc, 'ii-project-section-count', view.proof.stateLabel),
    );
    element.appendChild(proofHead);
    const proof = div(doc, 'ii-project-proof');
    proof.dataset.state = view.proof.state;
    proof.append(
      span(doc, 'ii-project-proof-window',
        '观察窗口：已观察 ' + Math.floor(view.proof.elapsedSeconds) + 's / ' + view.proof.durationSeconds
        + 's（剩余 ' + view.proof.remainingSeconds + 's）'),
      span(doc, 'ii-project-proof-produced',
        '窗口产出：' + view.proof.produced + ' / ' + view.proof.target),
    );
    const bar = div(doc, 'ii-project-proof-bar');
    const fill = doc.createElement('i');
    fill.style.width = view.proof.progressPercent + '%';
    bar.appendChild(fill);
    proof.appendChild(bar);
    for (const condition of view.proof.conditions) {
      const line = div(doc, 'ii-project-condition');
      line.dataset.conditionId = condition.id;
      line.dataset.ok = condition.ok ? '1' : '0';
      line.append(
        span(doc, 'ii-project-condition-icon', condition.ok ? '✓' : '✗'),
        span(doc, 'ii-project-condition-label', condition.label),
        span(doc, 'ii-project-condition-value', condition.current + ' / ' + condition.required),
      );
      proof.appendChild(line);
    }
    if (view.proof.failureReason) {
      proof.appendChild(div(doc, 'ii-project-failure', '失败原因：' + view.proof.failureReason));
    }
    element.appendChild(proof);

    const actions = div(doc, 'ii-project-actions');
    const begin = doc.createElement('button');
    begin.type = 'button';
    begin.className = 'ii-project-btn primary';
    begin.textContent = '开始运行证明';
    begin.dataset.iiAction = 'project-begin-proof';
    begin.disabled = !view.canBegin;
    begin.title = view.completed ? '联合工厂已完成'
      : !view.unlocked ? 'T3.3 联合工厂总成尚未解锁'
        : !view.deliveryComplete ? '成套设备尚未交齐' : '';
    begin.addEventListener('click', () => options.send({ type: 'project/proof/begin' }));
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ii-project-btn';
    cancel.textContent = '取消运行证明';
    cancel.dataset.iiAction = 'project-cancel-proof';
    cancel.disabled = !view.canCancel;
    cancel.addEventListener('click', () => options.send({ type: 'project/proof/cancel' }));
    actions.append(begin, cancel);
    element.appendChild(actions);

    // ---- 还差什么 ----
    const blocksHead = div(doc, 'ii-project-section');
    blocksHead.append(span(doc, 'ii-project-section-title', '还差什么'));
    element.appendChild(blocksHead);
    const blocks = div(doc, 'ii-project-blocks');
    if (view.blocks.length === 0) {
      if (view.completed) {
        blocks.appendChild(div(doc, 'ii-project-block ok', '已全部完成。'));
      } else {
        blocks.appendChild(div(doc, 'ii-project-block', '暂时没有阻塞项。'));
      }
    } else {
      for (const block of view.blocks) blocks.appendChild(div(doc, 'ii-project-block', block));
    }
    element.appendChild(blocks);
  };

  return { element, render };
}
