import type { UiState } from './frontend-ui-protocol.ts';
import { createTabShell, type TabShell, type UiTabDef } from './frontend-tab-shell.ts';
import { createTechPanel, type TechPanelHandle } from './frontend-tech-panel.ts';
import { createDiagnosticsPanel, createProjectPanel } from './frontend-service-panel.ts';
import { createSaveChannel, type SaveChannelHandle } from './frontend-save-channel.ts';
import { buildDiagnosticsView, buildProjectView } from './frontend-service-view.ts';
import { buildTechView, describeTechError, type TechView } from './frontend-tech-view.ts';

/**
 * P2-E2 模态框内容编排：页签（背包 / 科技 / 诊断 / 联合工厂）、四块面板、存档页脚。
 *
 * frontend-ui.ts 只负责打开/关闭、暂停/恢复和快捷栏；这里把「每个 state 消息该渲染什么」
 * 集中起来，避免 frontend-ui.ts 继续膨胀（项目单文件 < 20KB 硬限制）。
 */

export interface PanelStackOptions {
  readonly head: HTMLElement;
  readonly anchor: HTMLElement;
  readonly body: HTMLElement;
  readonly frame: HTMLElement;
  /** 既有背包列表 + 详情（保持原行为，只换成页签里的一个 pane）。 */
  readonly backpackPane: HTMLElement;
  readonly title: HTMLElement;
  readonly subtitle: HTMLElement;
  send(message: Record<string, unknown>): void;
  showError(text: string): void;
  /** 测试脚手架可覆盖存档键（验收脚本隔离真实存档）。 */
  readonly saveStorageKey?: string;
}

export interface PanelStackHandle {
  readonly tabs: TabShell;
  readonly techPanel: TechPanelHandle;
  readonly saveChannel: SaveChannelHandle;
  /** 返回科技视图；changed=false 表示快照内容没变（可跳过 HUD 重绘）。 */
  render(ui: UiState): { techView: TechView | null; changed: boolean };
  /** 每次收到 state 消息后调用：更新存档页脚并触发启动时的自动读档。 */
  notifyState(ui: UiState): void;
  /** 引擎 error 消息 → 中文；handled=false 时由调用方走通用提示。 */
  handleError(code: string, message: string, ui: UiState): { handled: boolean; text: string };
  dispose(): void;
}

const TAB_META: Readonly<Record<string, { readonly title: string; readonly subtitle: string }>> = Object.freeze({
  backpack: { title: '背包', subtitle: '管理物品与快捷栏绑定' },
  tech: { title: '科技', subtitle: '交付材料，解锁配方、机器与能力' },
  diagnostics: { title: '产线诊断', subtitle: '真实运行状态：动力 / 加工 / 物料连接' },
  project: { title: '联合工厂', subtitle: '成套交付与 60 秒运行证明' },
});

function inventoryMapOf(ui: UiState): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const item of ui.items) map.set(item.id, item.total);
  return map;
}

export function createPanelStack(doc: Document, options: PanelStackOptions): PanelStackHandle {
  const techPanel = createTechPanel(doc, {
    send: options.send,
    openProjectPage: () => tabs.show('project'),
  });
  const diagnosticsPanel = createDiagnosticsPanel(doc);
  const projectPanel = createProjectPanel(doc, { send: options.send });
  const saveChannel = createSaveChannel(doc, { send: options.send, storageKey: options.saveStorageKey });
  options.frame.appendChild(saveChannel.element);

  const tabs: TabShell = createTabShell(doc, {
    tabs: [
      { id: 'backpack', label: '背包', pane: options.backpackPane, subtitle: TAB_META.backpack.subtitle },
      { id: 'tech', label: '科技', pane: techPanel.element, subtitle: TAB_META.tech.subtitle },
      { id: 'diagnostics', label: '诊断', pane: diagnosticsPanel.element, subtitle: TAB_META.diagnostics.subtitle },
      { id: 'project', label: '联合工厂', pane: projectPanel.element, subtitle: TAB_META.project.subtitle },
    ] as UiTabDef[],
    head: options.head,
    anchor: options.anchor,
    body: options.body,
    initial: 'backpack',
    onChange: (tab) => {
      const meta = TAB_META[tab.id] ?? TAB_META.backpack;
      options.title.textContent = meta.title;
      options.subtitle.textContent = meta.subtitle;
    },
  });
  options.title.textContent = TAB_META.backpack.title;
  options.subtitle.textContent = TAB_META.backpack.subtitle;

  /**
   * 渲染签名：桥接层会因诊断/终局服务快照的实时字段（加工进度、运行证明倒计时）变化而
   * 每帧广播；这里只在「玩家可见内容」真的变化时重绘面板，避免每帧重建 12 个节点卡。
   */
  const renderSignature = (ui: UiState, techView: TechView | null): string => JSON.stringify([
    ui.goal?.complete, ui.goal?.completedCount, ui.goal?.currentStepId, ui.goal?.blocker?.code ?? null,
    ui.items.map((item) => item.id + ':' + item.total),
    techView?.nodes.map((node) => node.id + node.status + node.deliveredTotal + (node.tracked ? 'T' : '-')),
    ui.project
      ? [ui.project.completed, ui.project.delivery.totalDelivered, ui.project.proof.state,
        Math.floor(ui.project.proof.elapsedSeconds), ui.project.proof.produced, ui.project.blocks]
      : null,
    ui.diagnostics
      ? [ui.diagnostics.summary, ui.diagnostics.hasError, ui.diagnostics.machines.length, ui.diagnostics.links.length]
      : null,
  ]);

  let lastSignature = '';
  const render = (ui: UiState): { techView: TechView | null; changed: boolean } => {
    const inventory = inventoryMapOf(ui);
    const techView = buildTechView(ui.tech, inventory);
    const signature = renderSignature(ui, techView);
    if (signature === lastSignature) return { techView, changed: false };
    lastSignature = signature;
    const project = buildProjectView(ui.project, inventory);
    techPanel.render(techView, inventory, project?.blocks ?? []);
    diagnosticsPanel.render(buildDiagnosticsView(ui.diagnostics));
    projectPanel.render(project);
    return { techView, changed: true };
  };

  const notifyState = (ui: UiState): void => {
    saveChannel.onStateApplied(ui.save);
  };

  const handleError = (code: string, message: string, ui: UiState): { handled: boolean; text: string } => {
    const inventory = inventoryMapOf(ui);
    const techView = buildTechView(ui.tech, inventory);
    if (techPanel.isBusy()) {
      return { handled: true, text: techPanel.showError(code, message, inventory) };
    }
    const project = buildProjectView(ui.project, inventory);
    const text = describeTechError(code, {
      view: techView,
      inventory,
      nodeId: techPanel.selectedNodeId(),
      projectBlocks: project?.blocks ?? [],
      message,
    });
    return { handled: false, text };
  };

  return {
    tabs,
    techPanel,
    saveChannel,
    render,
    notifyState,
    handleError,
    dispose: () => {
      tabs.dispose();
      saveChannel.dispose();
    },
  };
}
