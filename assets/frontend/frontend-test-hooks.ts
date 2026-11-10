/**
 * P2-E1/E2 验收脚本测试入口（只在 `__II_TEST_FLAGS__.techHooks === true` 时暴露）。
 *
 * 这些入口调用与正式 UI 完全相同的 MessagePort 命令（真实校验、真实扣料），
 * 不绕过任何门控、不直接改状态；正式玩家页面没有这个全局，因此没有测试后门。
 */

export interface TestHookFlags {
  readonly techHooks?: boolean;
}

export function installTestHooks(
  win: Window,
  send: (message: Record<string, unknown>) => void,
  flags: TestHookFlags,
): () => void {
  if (flags.techHooks !== true) return () => {};
  const target = win as unknown as Record<string, unknown>;
  target.__II_TEST_TECH__ = {
    submit: (nodeId: string, itemId: string, count: number) => send({ type: 'tech/submit', nodeId, itemId, count }),
    submitAll: (nodeId: string) => send({ type: 'tech/submit-all', nodeId }),
    track: (nodeId: string | null) => send({ type: 'tech/track', nodeId }),
    requestState: () => send({ type: 'state/request' }),
  };
  target.__II_TEST_ENDGAME__ = {
    beginProof: () => send({ type: 'project/proof/begin' }),
    cancelProof: () => send({ type: 'project/proof/cancel' }),
    requestState: () => send({ type: 'state/request' }),
  };
  return () => {
    delete target.__II_TEST_TECH__;
    delete target.__II_TEST_ENDGAME__;
  };
}
