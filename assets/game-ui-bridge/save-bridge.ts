import type { PersistenceSnapshot } from '../save/persistence.pack.ts';
import type { UiCommand } from './protocol.ts';

/**
 * P2-E2 存档桥接（纯函数，零引擎依赖）。
 *
 * 引擎侧正式 persistence 服务由存档工程师实现，契约（Lead 对齐）：
 * `setTransport({ post })` 注入下行通道；`requestSave/Restore/NewGame` 触发行动作；
 * 前端把存储读写结果用 `save/data` 命令送回 `onStorageData(payload)`。
 *
 * 这里用「结构类型 + 可选方法」而不是直接依赖某个版本的 PersistenceService：
 * - 当前仓库里还是 Lead 的骨架（只有 snapshot/request*，没有 setTransport），
 *   桥接层每秒重试 attach，服务实现落地后自动接上；
 * - 存/读方法缺失时返回明确的 error 码，不让异常打断帧循环。
 */

export interface SaveTransport {
  post(message: unknown): void;
}

/** 引擎侧存档服务的最小结构契约（后续版本可多字段，不改变这里的判断）。 */
export interface PersistenceServiceLike {
  setTransport?(transport: SaveTransport): void;
  snapshot?(): PersistenceSnapshot | null;
  status?(): PersistenceSnapshot;
  requestSave?(): void;
  requestRestore?(): void;
  requestNewGame?(): void;
  onStorageData?(payload: { readonly found: boolean; readonly data?: string }): unknown;
}

export interface SaveCommandError {
  readonly code: string;
  readonly message: string;
}

export interface SaveCommandOutcome {
  readonly consumed: boolean;
  readonly error: SaveCommandError | null;
}

/** 存档通道相关的上行命令（bridge 只把这几条转给 persistence 服务）。 */
export type SaveCommand = Extract<
  UiCommand,
  { type: 'save/request' | 'save/restore' | 'save/new' | 'save/data' }
>;

export function isSaveCommand(command: UiCommand): command is SaveCommand {
  return command.type === 'save/request'
    || command.type === 'save/restore'
    || command.type === 'save/new'
    || command.type === 'save/data';
}

/**
 * 注入下行通道。返回 false = 服务缺失或还没有 `setTransport`（调用方每帧重试一次）。
 * 重复调用是安全的：以最新一次注入的通道为准。
 */
export function attachSaveTransport(
  service: PersistenceServiceLike | null | undefined,
  post: (message: unknown) => void,
): boolean {
  if (!service || typeof service.setTransport !== 'function') return false;
  try {
    service.setTransport({ post });
    return true;
  } catch {
    return false;
  }
}

/** 读取存档快照：优先 `snapshot()`（当前骨架），其次 `status()`（Lead 对齐的新契约）。 */
export function readSaveSnapshot(
  service: PersistenceServiceLike | null | undefined,
): PersistenceSnapshot | null {
  if (!service) return null;
  try {
    if (typeof service.snapshot === 'function') return service.snapshot() ?? null;
    if (typeof service.status === 'function') return service.status() ?? null;
    return null;
  } catch {
    return null;
  }
}

const SAVE_UNAVAILABLE: SaveCommandError = {
  code: 'save-unavailable',
  message: 'persistence service is not ready',
};

/** 把一条存档命令转给引擎服务；返回值只描述「是否处理/错误码」，不抛异常。 */
export function forwardSaveCommand(
  service: PersistenceServiceLike | null | undefined,
  command: SaveCommand,
): SaveCommandOutcome {
  if (!service) return { consumed: true, error: SAVE_UNAVAILABLE };
  const missing = (method: string): SaveCommandOutcome => ({
    consumed: true,
    error: { code: 'save-unavailable', message: 'persistence service is missing ' + method },
  });
  try {
    switch (command.type) {
      case 'save/request':
        if (typeof service.requestSave !== 'function') return missing('requestSave');
        service.requestSave();
        return { consumed: true, error: null };
      case 'save/restore':
        if (typeof service.requestRestore !== 'function') return missing('requestRestore');
        service.requestRestore();
        return { consumed: true, error: null };
      case 'save/new':
        if (typeof service.requestNewGame !== 'function') return missing('requestNewGame');
        service.requestNewGame();
        return { consumed: true, error: null };
      case 'save/data':
        if (typeof service.onStorageData !== 'function') return missing('onStorageData');
        if (command.found) {
          service.onStorageData(
            command.data === undefined ? { found: true } : { found: true, data: command.data },
          );
        } else {
          service.onStorageData({ found: false });
        }
        return { consumed: true, error: null };
      default:
        return { consumed: false, error: null };
    }
  } catch (error) {
    return {
      consumed: true,
      error: { code: 'command-failed', message: error instanceof Error ? error.message : String(error) },
    };
  }
}
