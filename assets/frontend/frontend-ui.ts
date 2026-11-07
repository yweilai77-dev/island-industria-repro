// 正式背包与快捷栏 UI（浏览器前端 realm）。
// Engine 侧是库存/快捷栏的唯一权威；本文件只负责显示与把用户操作转换成 MessagePort 命令。
// 协议解析见 frontend-ui-protocol.ts，样式表见 frontend-ui-styles.ts。
import type {} from '@forgeax/engine/app';
import type { Plugin } from '@forgeax/engine/plugin';
import { itemIconSvg } from './icons.ts';
import { FRONTEND_UI_CSS } from './frontend-ui-styles.ts';
import { PROTOCOL_VERSION, SLOT_COUNT, isOkResult, parseState } from './frontend-ui-protocol.ts';
import type { CatalogItem, HostLike, StateMessage, UiState } from './frontend-ui-protocol.ts';

export const frontendUi: Plugin = {
  name: 'island-industria/frontend-ui',
  inject: ['gameHost'],
  apply(ctx) {
    const host = ctx.gameHost as HostLike | undefined;
    if (!host?.uiRoot) throw new Error('M1.4: frontend UI requires gameHost.uiRoot');
    const root = host.uiRoot;
    const port = host.port;
    const app = host.app ?? {};

    const ui: UiState = {
      open: false,
      paused: false,
      revision: -1,
      items: [],
      hotbar: { slots: new Array(SLOT_COUNT).fill(null), selected: 0 },
      selectedItemId: null,
    };

    const doc = root.ownerDocument;
    const style = doc.createElement('style');
    style.textContent = FRONTEND_UI_CSS;
    doc.head.appendChild(style);

    const shell = doc.createElement('div');
    shell.className = 'ii-ui';
    root.appendChild(shell);

    // ---- 快捷栏 ----
    const hotbar = doc.createElement('div');
    hotbar.className = 'ii-hotbar';
    shell.appendChild(hotbar);
    const slotElements: HTMLDivElement[] = [];
    for (let index = 0; index < SLOT_COUNT; index += 1) {
      const slot = doc.createElement('div');
      slot.className = 'ii-slot empty';
      slot.dataset.slot = String(index);
      const key = doc.createElement('div');
      key.className = 'ii-slot-key';
      key.textContent = String(index + 1);
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
    body.appendChild(listPanel);

    const detail = doc.createElement('div');
    detail.className = 'ii-detail';
    body.appendChild(detail);

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

    const slotIndexOfItem = (itemId: string): number =>
      ui.hotbar.slots.findIndex((slot) => slot === itemId);

    const itemById = (itemId: string | null): CatalogItem | undefined =>
      itemId === null ? undefined : ui.items.find((item) => item.id === itemId);

    // ---- 渲染 ----
    const renderHotbar = (): void => {
      for (let index = 0; index < SLOT_COUNT; index += 1) {
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
      if (event.key >= '1' && event.key <= '8') {
        event.preventDefault();
        send({ type: 'hotbar/select', slot: Number(event.key) - 1 });
      }
    };
    window.addEventListener('keydown', onKeyDown, true);

    if (port) {
      port.onmessage = (event: MessageEvent<StateMessage>) => {
        const message = event.data;
        if (!message || typeof message !== 'object') return;
        if (message.type === 'error') {
          showError(`命令失败：${message.message ?? message.code ?? 'unknown'}`);
          return;
        }
        const parsed = parseState(message);
        if (!parsed) return;
        if (typeof message.revision === 'number' && message.revision <= ui.revision) return;
        ui.revision = typeof message.revision === 'number' ? message.revision : ui.revision;
        ui.items = parsed.items;
        ui.hotbar = parsed.hotbar;
        if (ui.selectedItemId !== null && !ui.items.some((item) => item.id === ui.selectedItemId)) {
          ui.selectedItemId = null;
        }
        render();
      };
      port.start?.();
      send({ type: 'hello' });
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
      if (port) port.onmessage = null;
      cancelDrag();
      shell.remove();
      style.remove();
    }, 'island-industria/frontend-ui');
  },
};