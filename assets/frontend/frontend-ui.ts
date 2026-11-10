// 正式背包与快捷栏 UI（浏览器前端 realm）。
// Engine 侧是库存/快捷栏的唯一权威；本文件只负责显示与把用户操作转换成 MessagePort 命令。
// 协议解析见 frontend-ui-protocol.ts，样式表见 frontend-ui-styles.ts。
import type {} from '@forgeax/engine/app';
import type { Plugin } from '@forgeax/engine/plugin';
import { HOTBAR_SLOT_COUNT } from '../hotbar/hotbar.ts';
import { itemIconSvg } from './icons.ts';
import { FRONTEND_UI_CSS } from './frontend-ui-styles.ts';
import { FRONTEND_TECH_CSS } from './frontend-tech-styles.ts';
import { createHudStack } from './frontend-hud.ts';
import { createPanelStack } from './frontend-panel-stack.ts';
import { resolveSaveMode } from './frontend-save-channel.ts';
import { installTestHooks } from './frontend-test-hooks.ts';
import { PROTOCOL_VERSION, isOkResult, parseState } from './frontend-ui-protocol.ts';
import type { CatalogItem, HostLike, StateMessage, UiState } from './frontend-ui-protocol.ts';

// 快捷栏键位：前 10 格对应 1-9、0；第 11、12 格没有数字键，只能鼠标点选。
const slotKeyLabel = (index: number): string => {
  if (index >= 0 && index < 9) return String(index + 1);
  return index === 9 ? '0' : '';
};

const slotFromKey = (key: string): number | undefined => {
  if (key >= '1' && key <= '9') return Number(key) - 1;
  return key === '0' ? 9 : undefined;
};

export const frontendUi: Plugin = {
  name: 'island-industria/frontend-ui',
  inject: ['gameHost'],
  apply(ctx) {
    const host = ctx.gameHost as HostLike | undefined;
    if (!host?.uiRoot) throw new Error('M1.4: frontend UI requires gameHost.uiRoot');
    const root = host.uiRoot;
    const port = host.port;
    const app = host.app ?? {};
    /**
     * P2-E1 测试脚手架标志（仅验收脚本通过 page.addInitScript 注入）：
     * - progression: 'legacy' 让旧 M1/P2 验收脚本回到历史套件/行为；
     * - techHooks: true 暴露 __II_TEST_TECH__（科技交付的真实事务入口，不做任何门控绕过）。
     * 正式玩家页面不会设置这个全局，因此正式流程既没有兼容模式也没有测试入口。
     */
    const testFlags = (globalThis as { __II_TEST_FLAGS__?: unknown }).__II_TEST_FLAGS__;
    const flags = typeof testFlags === 'object' && testFlags !== null
      ? testFlags as { progression?: 'player' | 'legacy'; techHooks?: boolean; saveStorageKey?: string }
      : undefined;
    // 存档模式：无 flags = 正式玩家（persistent）；有 saveStorageKey = 隔离档；
    // 只带 progression/techHooks 的旧验收脚本 = off（不读档、不自动保存）。
    const saveMode = resolveSaveMode(flags);
    const canvas = host.canvas;
    const onCanvasContextMenu = (event: MouseEvent): void => {
      // 只抑制游戏 canvas；页面其他区域保持浏览器默认右键菜单。
      event.preventDefault();
    };
    canvas?.addEventListener('contextmenu', onCanvasContextMenu);

    /** 测试入口清理函数（无 techHooks 时为 no-op）。 */
    let disposeTestHooks: () => void = () => {};

    const ui: UiState = {
      open: false,
      paused: false,
      revision: -1,
      items: [],
      hotbar: { slots: new Array(HOTBAR_SLOT_COUNT).fill(null), selected: 0 },
      selectedItemId: null,
      goal: null,
      tech: null,
      project: null,
      diagnostics: null,
      save: null,
    };

    const doc = root.ownerDocument;
    const style = doc.createElement('style');
    style.textContent = FRONTEND_UI_CSS + FRONTEND_TECH_CSS;
    doc.head.appendChild(style);

    const shell = doc.createElement('div');
    shell.className = 'ii-ui';
    root.appendChild(shell);

    // ---- 左上 HUD：订单 / 科技追踪卡 / Tab 提示（同一位置互斥显示，不拦截输入）----
    const hud = createHudStack(doc);
    shell.appendChild(hud.element);

    // ---- 快捷栏 ----
    const hotbar = doc.createElement('div');
    hotbar.className = 'ii-hotbar';
    shell.appendChild(hotbar);
    const slotElements: HTMLDivElement[] = [];
    for (let index = 0; index < HOTBAR_SLOT_COUNT; index += 1) {
      const slot = doc.createElement('div');
      slot.className = 'ii-slot empty';
      slot.dataset.slot = String(index);
      const key = doc.createElement('div');
      key.className = 'ii-slot-key';
      // 只有前 10 格有数字键提示（1-9、0）；第 11、12 格只能用鼠标点选，不显示键位。
      key.textContent = slotKeyLabel(index);
      const icon = doc.createElement('div');
      icon.className = 'ii-slot-icon';
      const count = doc.createElement('div');
      count.className = 'ii-slot-count';
      slot.append(key, icon, count);
      hotbar.appendChild(slot);
      slotElements.push(slot);
    }

    const hint = doc.createElement('div');
    hint.className = 'ii-hint';
    hint.textContent = 'Tab 打开背包';
    shell.appendChild(hint);

    // ---- 背包 ----
    const backdrop = doc.createElement('div');
    backdrop.className = 'ii-backpack';
    backdrop.hidden = true;
    shell.appendChild(backdrop);

    const frame = doc.createElement('div');
    frame.className = 'ii-frame';
    backdrop.appendChild(frame);

    const head = doc.createElement('div');
    head.className = 'ii-head';
    const titleWrap = doc.createElement('div');
    const title = doc.createElement('div');
    title.className = 'ii-title';
    title.textContent = '背包';
    const subtitle = doc.createElement('div');
    subtitle.className = 'ii-sub';
    subtitle.textContent = '管理物品与快捷栏绑定';
    const errorLabel = doc.createElement('span');
    errorLabel.className = 'ii-error';
    titleWrap.append(title, subtitle, errorLabel);
    const closeButton = doc.createElement('button');
    closeButton.className = 'ii-close';
    closeButton.textContent = '关闭 (Tab / Esc)';
    head.append(titleWrap, closeButton);
    frame.appendChild(head);

    const body = doc.createElement('div');
    body.className = 'ii-body';
    frame.appendChild(body);

    const listPanel = doc.createElement('div');
    listPanel.className = 'ii-list-panel';
    const list = doc.createElement('div');
    list.className = 'ii-list';
    listPanel.appendChild(list);

    const detail = doc.createElement('div');
    detail.className = 'ii-detail';

    // 背包是页签里的第一个 pane；科技/诊断/联合工厂由 panel stack 挂载。
    const backpackPane = doc.createElement('div');
    backpackPane.className = 'ii-pane';
    backpackPane.dataset.pane = 'backpack';
    backpackPane.append(listPanel, detail);

    let dragGhost: HTMLDivElement | undefined;
    let dragPointerId: number | undefined;
    let dragStart: { x: number; y: number } | undefined;
    let dragging = false;
    let dragItemId: string | undefined;

    const showError = (text: string): void => {
      errorLabel.textContent = text;
      window.setTimeout(() => {
        if (errorLabel.textContent === text) errorLabel.textContent = '';
      }, 3500);
    };

    const send = (message: Record<string, unknown>): void => {
      if (!port) {
        showError('与游戏通信失败（端口不可用）');
        return;
      }
      port.postMessage({ v: PROTOCOL_VERSION, ...message });
    };

    // 页签 + 科技/诊断/联合工厂面板 + 存档页脚。storageKey 可由测试脚手架隔离。
    const panels = createPanelStack(doc, {
      head,
      anchor: closeButton,
      body,
      frame,
      backpackPane,
      title,
      subtitle,
      send,
      showError,
      saveMode,
      ...(flags?.saveStorageKey ? { saveStorageKey: flags.saveStorageKey } : {}),
    });

    const slotIndexOfItem = (itemId: string): number =>
      ui.hotbar.slots.findIndex((slot) => slot === itemId);

    const itemById = (itemId: string | null): CatalogItem | undefined =>
      itemId === null ? undefined : ui.items.find((item) => item.id === itemId);

    // ---- 渲染 ----
    const renderHotbar = (): void => {
      for (let index = 0; index < HOTBAR_SLOT_COUNT; index += 1) {
        const element = slotElements[index]!;
        const itemId = ui.hotbar.slots[index] ?? null;
        const item = itemById(itemId);
        element.classList.toggle('selected', index === ui.hotbar.selected);
        element.classList.toggle('empty', item === undefined);
        const icon = element.querySelector<HTMLElement>('.ii-slot-icon')!;
        const count = element.querySelector<HTMLElement>('.ii-slot-count')!;
        if (item) {
          icon.innerHTML = itemIconSvg(item.icon);
          count.textContent = String(item.total);
        } else {
          icon.innerHTML = '';
          count.textContent = '';
        }
      }
      hotbar.classList.toggle('hidden-during-drag', false);
    };

    const renderList = (): void => {
      list.replaceChildren();
      if (ui.items.length === 0) {
        const empty = doc.createElement('div');
        empty.className = 'ii-empty';
        empty.textContent = '背包是空的。去采集一些铁矿石吧。';
        list.appendChild(empty);
        return;
      }
      for (const item of ui.items) {
        const row = doc.createElement('div');
        row.className = 'ii-row';
        row.dataset.itemId = item.id;
        if (item.id === ui.selectedItemId) row.classList.add('selected');
        const icon = doc.createElement('div');
        icon.className = 'ii-row-icon';
        icon.innerHTML = itemIconSvg(item.icon);
        const main = doc.createElement('div');
        main.className = 'ii-row-main';
        const name = doc.createElement('span');
        name.className = 'ii-row-name';
        name.textContent = item.name;
        const count = doc.createElement('span');
        count.className = 'ii-row-count';
        count.textContent = `x ${item.total}`;
        main.append(name);
        const boundIndex = slotIndexOfItem(item.id);
        if (boundIndex >= 0) {
          const badge = doc.createElement('span');
          badge.className = 'ii-bound';
          badge.textContent = `快捷栏 ${boundIndex + 1}`;
          main.appendChild(badge);
        }
        row.append(icon, main, count);

        row.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          ui.selectedItemId = item.id;
          renderList();
          renderDetail();
          dragStart = { x: event.clientX, y: event.clientY };
          dragItemId = item.id;
          dragPointerId = event.pointerId;
          dragging = false;
        });
        list.appendChild(row);
      }
    };

    const renderDetail = (): void => {
      detail.replaceChildren();
      const item = itemById(ui.selectedItemId);
      if (!item) {
        const empty = doc.createElement('div');
        empty.className = 'ii-detail-empty';
        empty.textContent = '点击左侧物品查看详情';
        detail.appendChild(empty);
        return;
      }
      const icon = doc.createElement('div');
      icon.className = 'ii-detail-icon';
      icon.innerHTML = itemIconSvg(item.icon);
      const name = doc.createElement('div');
      name.className = 'ii-detail-name';
      name.textContent = item.name;
      const count = doc.createElement('div');
      count.className = 'ii-detail-count';
      count.textContent = `库存总数：${item.total}`;
      const desc = doc.createElement('div');
      desc.className = 'ii-detail-desc';
      desc.textContent = item.description || '暂无描述。';
      const boundIndex = slotIndexOfItem(item.id);
      const binding = doc.createElement('div');
      binding.className = 'ii-detail-binding';
      binding.textContent = boundIndex >= 0 ? `已绑定：快捷栏第 ${boundIndex + 1} 格` : '未绑定到快捷栏';
      detail.append(icon, name, count, desc, binding);
    };

    const render = (): void => {
      backdrop.hidden = !ui.open;
      hint.textContent = ui.open ? '' : 'Tab 打开背包';
      hint.style.display = ui.open ? 'none' : 'block';
      renderHotbar();
      const { techView, changed } = panels.render(ui);
      if (changed) hud.render(ui.goal, techView);
      if (ui.open) {
        renderList();
        renderDetail();
      }
    };

    // ---- 暂停 ----
    const pauseGame = (): boolean => {
      if (ui.paused) return true;
      try {
        const result = app.pause?.();
        if (!isOkResult(result)) {
          showError('无法暂停游戏，背包未打开');
          console.error('M1.4: app.pause failed', result);
          return false;
        }
        ui.paused = true;
        return true;
      } catch (error) {
        showError('无法暂停游戏，背包未打开');
        console.error('M1.4: app.pause threw', error);
        return false;
      }
    };

    const resumeGame = (): boolean => {
      if (!ui.paused) return true;
      try {
        app.input?.clear?.();
        const result = app.resume?.();
        if (!isOkResult(result)) {
          showError('无法恢复游戏，背包保持打开');
          console.error('M1.4: app.resume failed', result);
          return false;
        }
        ui.paused = false;
        return true;
      } catch (error) {
        showError('无法恢复游戏，背包保持打开');
        console.error('M1.4: app.resume threw', error);
        return false;
      }
    };

    const openBackpack = (): void => {
      if (ui.open) return;
      if (!pauseGame()) return;
      ui.open = true;
      render();
    };

    const closeBackpack = (): void => {
      if (!ui.open) return;
      if (!resumeGame()) return;
      ui.open = false;
      cancelDrag();
      // 关闭面板触发一次自动存档（与 15s 兜底、页面隐藏、科技提交成功共同覆盖所有进度点）。
      panels.saveChannel.requestSave();
      render();
    };

    // ---- 拖拽 ----
    const cancelDrag = (): void => {
      dragging = false;
      dragStart = undefined;
      dragItemId = undefined;
      dragPointerId = undefined;
      dragGhost?.remove();
      dragGhost = undefined;
      for (const slot of slotElements) slot.classList.remove('drop-target');
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (dragStart === undefined || dragItemId === undefined) return;
      const distance = Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y);
      if (!dragging && distance > 6) {
        dragging = true;
        const item = itemById(dragItemId);
        dragGhost = doc.createElement('div');
        dragGhost.className = 'ii-drag-ghost';
        dragGhost.innerHTML = itemIconSvg(item?.icon ?? 'unknown');
        doc.body.appendChild(dragGhost);
      }
      if (!dragging || !dragGhost) return;
      dragGhost.style.left = `${event.clientX}px`;
      dragGhost.style.top = `${event.clientY}px`;
      for (const slot of slotElements) {
        slot.classList.toggle('drop-target', slot.contains(doc.elementFromPoint(event.clientX, event.clientY)));
      }
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (dragPointerId !== undefined && event.pointerId !== dragPointerId) return;
      const wasDragging = dragging;
      const itemId = dragItemId;
      cancelDrag();
      if (!wasDragging || itemId === undefined) return;
      const target = doc.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.ii-slot');
      if (!target) return;
      const slot = Number(target.dataset.slot);
      if (!Number.isInteger(slot)) return;
      send({ type: 'hotbar/bind', slot, itemId });
    };

    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);

    // ---- 快捷栏点击 ----
    hotbar.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('.ii-slot');
      if (!target) return;
      const slot = Number(target.dataset.slot);
      if (!Number.isInteger(slot)) return;
      if (ui.open && ui.selectedItemId !== null) {
        send({ type: 'hotbar/bind', slot, itemId: ui.selectedItemId });
      } else {
        send({ type: 'hotbar/select', slot });
      }
    });
    hotbar.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });
    hotbar.addEventListener('contextmenu', (event) => event.preventDefault());

    closeButton.addEventListener('click', () => closeBackpack());
    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === backdrop) closeBackpack();
    });

    // ---- 键盘：Tab/Esc/数字 ----
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') {
        event.preventDefault();
        if (ui.open) closeBackpack();
        else openBackpack();
        return;
      }
      if (event.key === 'Escape') {
        if (!ui.open) return;
        event.preventDefault();
        closeBackpack();
        return;
      }
      if (!ui.open) return;
      const slot = slotFromKey(event.key);
      if (slot !== undefined) {
        event.preventDefault();
        send({ type: 'hotbar/select', slot });
      }
    };
    window.addEventListener('keydown', onKeyDown, true);

    if (port) {
      port.onmessage = (event: MessageEvent<StateMessage>) => {
        const message = event.data;
        if (!message || typeof message !== 'object') return;
        if (message.type === 'error') {
          const result = panels.handleError(message.code ?? 'unknown', message.message ?? '', ui);
          if (!result.handled) showError(result.text);
          return;
        }
        // 存档下行消息（save/write|read|clear）由存档通道消费，不是 state。
        if (panels.saveChannel.handleMessage(message)) return;
        const parsed = parseState(message);
        if (!parsed) return;
        if (typeof message.revision === 'number' && message.revision <= ui.revision) return;
        const wasTechBusy = panels.techPanel.isBusy();
        ui.revision = typeof message.revision === 'number' ? message.revision : ui.revision;
        ui.items = parsed.items;
        ui.hotbar = parsed.hotbar;
        ui.goal = parsed.goal;
        ui.tech = parsed.tech;
        ui.project = parsed.project;
        ui.diagnostics = parsed.diagnostics;
        ui.save = parsed.save;
        // 科技页发起的提交/追踪：拿到新 state 后立即落一次存档。
        if (wasTechBusy) panels.saveChannel.requestSave();
        // 首个 state 之后才自动读档（避免在引擎服务就绪前发命令），并刷新存档页脚。
        panels.notifyState(ui);
        if (ui.selectedItemId !== null && !ui.items.some((item) => item.id === ui.selectedItemId)) {
          ui.selectedItemId = null;
        }
        render();
      };
      port.start?.();
      send({ type: 'hello', ...(flags ? { flags } : {}) });
      // E1/E2/E3 验收入口：与正式 UI 完全相同的协议命令（细节见 frontend-test-hooks.ts）。
      disposeTestHooks = installTestHooks(window, send, flags ?? {});
    } else {
      showError('与游戏通信失败（端口不可用）');
    }

    render();

    // 让游戏 iframe 获得键盘焦点，确保首次按 Tab 就能打开背包（同源时可用）。
    try {
      (window.frameElement as HTMLElement | null)?.focus();
    } catch {
      // 跨域预览环境忽略：用户点击游戏窗口后 Tab 仍然有效。
    }

    ctx.effect(() => () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      canvas?.removeEventListener('contextmenu', onCanvasContextMenu);
      if (port) port.onmessage = null;
      disposeTestHooks();
      panels.dispose();
      cancelDrag();
      shell.remove();
      style.remove();
    }, 'island-industria/frontend-ui');
  },
};