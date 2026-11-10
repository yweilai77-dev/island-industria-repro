/**
 * P2-E2 Tab 模态外壳：在一个现有模态框里挂多个页签（背包 / 科技 / 诊断 / 联合工厂）。
 *
 * 约束：不新增世界热键、不改变打开/关闭语义（仍由 frontend-ui 的 Tab/Esc 控制）；
 * 页签只切换 DOM 可见性，不触发暂停/恢复，也不改游戏输入状态。
 */

export type UiTabId = 'backpack' | 'tech' | 'diagnostics' | 'project';

export interface UiTabDef {
  readonly id: UiTabId;
  readonly label: string;
  readonly pane: HTMLElement;
  /** 页签说明（显示在标题旁，可选）。 */
  readonly subtitle?: string;
}

export interface TabShell {
  readonly element: HTMLDivElement;
  readonly active: () => UiTabId;
  readonly show: (id: UiTabId) => void;
  readonly dispose: () => void;
}

export interface TabShellOptions {
  readonly tabs: readonly UiTabDef[];
  /** 页签按钮插入到该容器（通常是模态框标题栏）。 */
  readonly head: HTMLElement;
  /** 页签按钮插到该节点之前（关闭按钮）。 */
  readonly anchor: HTMLElement;
  /** 页签面板挂载到该容器（通常是模态框 body）。 */
  readonly body: HTMLElement;
  readonly initial?: UiTabId;
  readonly onChange?: (tab: UiTabDef) => void;
}

export function createTabShell(doc: Document, options: TabShellOptions): TabShell {
  const { tabs, head, anchor, body } = options;
  const element = doc.createElement('div');
  element.className = 'ii-tabs';
  element.setAttribute('role', 'tablist');
  const buttons = new Map<UiTabId, HTMLButtonElement>();
  let active: UiTabId = options.initial ?? tabs[0]?.id ?? 'backpack';

  const apply = (id: UiTabId, notify: boolean): void => {
    active = id;
    for (const tab of tabs) {
      const pane = tab.pane;
      pane.classList.add('ii-pane');
      pane.dataset.pane = tab.id;
      pane.hidden = tab.id !== id;
      const button = buttons.get(tab.id);
      if (!button) continue;
      const selected = tab.id === id;
      button.classList.toggle('active', selected);
      button.dataset.active = selected ? '1' : '0';
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
    if (notify) {
      const tab = tabs.find((entry) => entry.id === id);
      if (tab) options.onChange?.(tab);
    }
  };

  for (const tab of tabs) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'ii-tab';
    button.dataset.tab = tab.id;
    button.textContent = tab.label;
    button.setAttribute('role', 'tab');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.tab !== active) apply(tab.id, true);
    });
    element.appendChild(button);
    buttons.set(tab.id, button);
    body.appendChild(tab.pane);
  }
  head.insertBefore(element, anchor);
  apply(active, true);

  return {
    element,
    active: () => active,
    show: (id) => apply(id, true),
    dispose: () => {
      element.remove();
      for (const tab of tabs) tab.pane.remove();
    },
  };
}
