import type { PersistenceSnapshot } from '../save/persistence.pack.ts';
import { buildSaveView, type SaveView } from './frontend-service-view.ts';

/**
 * P2-E2 正式存档通道（前端侧）+ 模态框页脚状态条。
 *
 * 通道协议（Lead 对齐，与引擎 persistence 服务约定）：
 * - 引擎下行：`save/write {data}` 写存储、`save/read` 读存储、`save/clear` 清存储；
 * - 前端上行：收到 read 后回 `save/data {found, data?}`；三个按钮分别发
 *   `save/request` / `save/restore` / `save/new`。
 *
 * 存储优先用测试脚手架注入的 `globalThis.__II_STORAGE__`（键名可由
 * `__II_TEST_FLAGS__.saveStorageKey` 覆盖），否则用 localStorage。
 * 所有存储操作都 try/catch：失败只写 console.error + 页脚「保存失败」，绝不让游戏崩溃。
 */

export const DEFAULT_SAVE_STORAGE_KEY = 'island-industria/save/slot-1';
const LOCAL_STATUS_TTL_MS = 3000;
const AUTOSAVE_INTERVAL_MS = 15000;
const NEW_GAME_RELOAD_DELAY_MS = 250;

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SaveChannelOptions {
  send(message: Record<string, unknown>): void;
  /** 覆盖默认键（验收脚本用它隔离存档，避免污染真实存档）。 */
  storageKey?: string | null;
}

export interface SaveChannelHandle {
  /** 页脚状态条（挂在模态框 frame 底部）。 */
  readonly element: HTMLDivElement;
  /** 处理引擎下行消息；返回 true 表示已消费（不是 state 消息）。 */
  handleMessage(message: unknown): boolean;
  /** 首个 state 后自动读取存档，并刷新页脚状态。 */
  onStateApplied(save: PersistenceSnapshot | null): void;
  requestSave(): void;
  requestRestore(): void;
  requestNewGame(): void;
  storageKey(): string;
  dispose(): void;
}

interface LocalStatus {
  readonly text: string;
  readonly tone: SaveView['tone'];
  readonly until: number;
}

function resolveStorage(): SaveStorage | null {
  const injected = (globalThis as unknown as { __II_STORAGE__?: unknown }).__II_STORAGE__;
  if (injected && typeof injected === 'object') {
    const candidate = injected as Partial<SaveStorage>;
    if (typeof candidate.getItem === 'function'
      && typeof candidate.setItem === 'function'
      && typeof candidate.removeItem === 'function') {
      return candidate as SaveStorage;
    }
  }
  try {
    const storage = globalThis.localStorage;
    if (storage && typeof storage.getItem === 'function') return storage;
  } catch {
    // 隐私模式/禁用存储：返回 null，页脚会显示「保存失败」。
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function createSaveChannel(doc: Document, options: SaveChannelOptions): SaveChannelHandle {
  const key = options.storageKey && options.storageKey.length > 0
    ? options.storageKey
    : DEFAULT_SAVE_STORAGE_KEY;

  const element = doc.createElement('div');
  element.className = 'ii-save';
  const status = doc.createElement('span');
  status.className = 'ii-save-status';
  status.dataset.tone = 'muted';
  status.dataset.iiSaveStatus = '1';
  const actions = doc.createElement('div');
  actions.className = 'ii-save-actions';

  const makeButton = (label: string, action: string): HTMLButtonElement => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'ii-save-btn';
    button.textContent = label;
    button.dataset.iiAction = action;
    actions.appendChild(button);
    return button;
  };
  const saveButton = makeButton('立即保存', 'save-request');
  const restoreButton = makeButton('读取存档', 'save-restore');
  const resetButton = makeButton('清空存档并重开', 'save-new');
  element.append(status, actions);

  let localStatus: LocalStatus | null = null;
  let restoreRequested = false;
  let resetPending = false;
  let disposed = false;

  const setStatus = (view: SaveView | LocalStatus): void => {
    if (!('until' in view)) {
      status.textContent = view.text;
      status.dataset.tone = view.tone;
      return;
    }
    status.textContent = view.text;
    status.dataset.tone = view.tone;
  };

  const flash = (text: string, tone: SaveView['tone'], ttlMs = LOCAL_STATUS_TTL_MS): void => {
    localStatus = { text, tone, until: Date.now() + ttlMs };
    setStatus(localStatus);
  };

  const storageFailure = (action: string, error: unknown): void => {
    console.error('P2-E2: save storage ' + action + ' failed', error);
    flash('保存失败：浏览器存储不可用', 'danger', 8000);
  };

  const storage = (): SaveStorage | null => resolveStorage();

  const requestSave = (): void => {
    if (disposed || resetPending) return;
    options.send({ type: 'save/request' });
  };

  const requestRestore = (): void => {
    if (disposed) return;
    options.send({ type: 'save/restore' });
    flash('读取中…', 'info');
  };

  const requestNewGame = (): void => {
    if (disposed || resetPending) return;
    resetPending = true;
    options.send({ type: 'save/new', confirm: true });
    flash('正在清空存档…', 'info', 8000);
  };

  saveButton.addEventListener('click', () => requestSave());
  restoreButton.addEventListener('click', () => requestRestore());
  resetButton.addEventListener('click', () => requestNewGame());

  const handleMessage = (message: unknown): boolean => {
    if (!isRecord(message) || typeof message.type !== 'string') return false;
    if (message.type === 'save/write') {
      const data = typeof message.data === 'string' ? message.data : null;
      if (data === null) {
        console.error('P2-E2: save/write without a data string');
        flash('保存失败：存档数据无效', 'danger', 8000);
        return true;
      }
      try {
        const target = storage();
        if (!target) throw new Error('storage unavailable');
        target.setItem(key, data);
        flash('保存中…', 'info');
      } catch (error) {
        storageFailure('write', error);
      }
      return true;
    }
    if (message.type === 'save/read') {
      try {
        const target = storage();
        if (!target) throw new Error('storage unavailable');
        const data = target.getItem(key);
        if (typeof data === 'string' && data.length > 0) {
          options.send({ type: 'save/data', found: true, data });
          flash('读取中…', 'info');
        } else {
          options.send({ type: 'save/data', found: false });
          flash('未找到存档', 'muted');
        }
      } catch (error) {
        console.error('P2-E2: save storage read failed', error);
        options.send({ type: 'save/data', found: false });
        flash('读取存档失败：浏览器存储不可用', 'danger', 8000);
      }
      return true;
    }
    if (message.type === 'save/clear') {
      try {
        const target = storage();
        if (!target) throw new Error('storage unavailable');
        target.removeItem(key);
      } catch (error) {
        storageFailure('clear', error);
        return true;
      }
      if (resetPending) {
        flash('存档已清空，正在重开…', 'info', 8000);
        globalThis.setTimeout?.(() => {
          if (!disposed) globalThis.location?.reload();
        }, NEW_GAME_RELOAD_DELAY_MS);
      } else {
        flash('存档已清空', 'muted');
      }
      return true;
    }
    return false;
  };

  const onStateApplied = (save: PersistenceSnapshot | null): void => {
    if (disposed) return;
    // 启动自动读取存档：等存档服务就绪（save 字段非 null）后才发命令；
    // 无存档时引擎保持初始状态（不会报错）。
    if (!restoreRequested && save !== null) {
      restoreRequested = true;
      requestRestore();
    }
    if (localStatus && Date.now() < localStatus.until) {
      setStatus(localStatus);
      return;
    }
    localStatus = null;
    setStatus(buildSaveView(save));
  };

  const onVisibilityChange = (): void => {
    if (doc.visibilityState === 'hidden') requestSave();
  };
  doc.addEventListener('visibilitychange', onVisibilityChange);
  const timer = globalThis.setInterval?.(() => requestSave(), AUTOSAVE_INTERVAL_MS);

  setStatus(buildSaveView(null));

  return {
    element,
    handleMessage,
    onStateApplied,
    requestSave,
    requestRestore,
    requestNewGame,
    storageKey: () => key,
    dispose: () => {
      disposed = true;
      doc.removeEventListener('visibilitychange', onVisibilityChange);
      if (timer !== undefined) globalThis.clearInterval?.(timer);
      element.remove();
    },
  };
}
