import type { GoalSnapshot } from '../goal/goal.ts';

/**
 * M2.0-P1-C 工业订单 HUD 的共享视图模型（引擎桥接与 DOM 前端共用）。
 *
 * 职责边界：
 * - 只把 A 阶段已验收的 GoalSnapshot 映射成 UI 需要的扁平数据，不重算订单步骤、完成条件或 baseline；
 * - 前端只消费这份数据，不重新定义任务流程；
 * - 纯函数、零引擎依赖，便于单测与前后端共用同一套类型。
 */

export interface UiGoalProgress {
  readonly current: number;
  readonly required: number;
}

export interface UiGoalStep {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly instruction: string;
  readonly completed: boolean;
  /** 是否是「当前目标」（由引擎快照的 currentStep 决定，前端不再推导）。 */
  readonly current: boolean;
  /** 有数量要求的步骤显示真实订单进度（baseline 差值）。 */
  readonly progress: UiGoalProgress | null;
}

export interface UiGoalBlocker {
  readonly code: string;
  readonly message: string;
}

export interface UiGoalState {
  readonly title: string;
  readonly subtitle: string;
  readonly complete: boolean;
  readonly completedCount: number;
  readonly totalCount: number;
  readonly currentStepId: string | null;
  readonly currentStep: UiGoalStep | null;
  readonly steps: readonly UiGoalStep[];
  readonly blocker: UiGoalBlocker | null;
}

/** GoalSnapshot（纯数据）→ HUD 视图模型；未就绪时返回 null，由前端显示初始化状态。 */
export function buildGoalView(snapshot: GoalSnapshot | undefined | null): UiGoalState | null {
  if (!snapshot || !Array.isArray(snapshot.steps) || snapshot.steps.length === 0) return null;
  const currentStepId = snapshot.complete ? null : snapshot.currentStep?.id ?? null;
  const steps: UiGoalStep[] = snapshot.steps.map((step) => ({
    id: step.id,
    index: step.index,
    title: step.title,
    instruction: step.instruction,
    completed: step.completed === true,
    current: currentStepId !== null && step.id === currentStepId,
    progress: step.progress
      ? { current: step.progress.current, required: step.progress.required }
      : null,
  }));
  const currentStep = steps.find((step) => step.current) ?? null;
  return {
    title: snapshot.title,
    subtitle: snapshot.subtitle,
    complete: snapshot.complete === true,
    completedCount: steps.filter((step) => step.completed).length,
    totalCount: steps.length,
    currentStepId,
    currentStep,
    steps,
    blocker: snapshot.blocker
      ? { code: snapshot.blocker.code, message: snapshot.blocker.message }
      : null,
  };
}

/** 视图签名：内容不变时桥接层不重复广播（避免每帧刷新 DOM）。 */
export function goalViewSignature(view: UiGoalState | null): string {
  if (!view) return 'goal:none';
  const steps = view.steps
    .map((step) => `${step.id}${step.completed ? '+' : ''}${step.progress ? `:${step.progress.current}` : ''}`)
    .join(',');
  const blocker = view.blocker ? `${view.blocker.code}:${view.blocker.message}` : '-';
  return `goal:${view.complete ? 'C' : 'P'}:${view.currentStepId ?? '-'}:${view.completedCount}:${steps}:${blocker}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 前端侧防御性解析：结构不合法时返回 null（显示初始化态），绝不猜测缺失字段。 */
export function parseGoalView(raw: unknown): UiGoalState | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.title !== 'string' || typeof raw.subtitle !== 'string') return null;
  if (typeof raw.complete !== 'boolean') return null;
  if (!Array.isArray(raw.steps) || raw.steps.length === 0 || raw.steps.length > 16) return null;
  const steps: UiGoalStep[] = [];
  for (const rawStep of raw.steps) {
    if (!isRecord(rawStep)) return null;
    if (typeof rawStep.id !== 'string' || typeof rawStep.title !== 'string' || typeof rawStep.instruction !== 'string') {
      return null;
    }
    if (typeof rawStep.index !== 'number' || !Number.isInteger(rawStep.index) || rawStep.index < 1) return null;
    if (typeof rawStep.completed !== 'boolean' || typeof rawStep.current !== 'boolean') return null;
    let progress: UiGoalProgress | null = null;
    if (rawStep.progress !== null && rawStep.progress !== undefined) {
      if (!isRecord(rawStep.progress)) return null;
      const { current, required } = rawStep.progress;
      if (typeof current !== 'number' || typeof required !== 'number') return null;
      if (!Number.isFinite(current) || !Number.isFinite(required)) return null;
      progress = {
        current: Math.max(0, Math.floor(current)),
        required: Math.max(0, Math.floor(required)),
      };
    }
    steps.push({
      id: rawStep.id,
      index: rawStep.index,
      title: rawStep.title,
      instruction: rawStep.instruction,
      completed: rawStep.completed,
      current: rawStep.current,
      progress,
    });
  }
  let blocker: UiGoalBlocker | null = null;
  if (raw.blocker !== null && raw.blocker !== undefined) {
    if (!isRecord(raw.blocker)) return null;
    if (typeof raw.blocker.code !== 'string' || typeof raw.blocker.message !== 'string') return null;
    blocker = { code: raw.blocker.code, message: raw.blocker.message };
  }
  const completedCount = steps.filter((step) => step.completed).length;
  const currentStepId = typeof raw.currentStepId === 'string' ? raw.currentStepId : null;
  const currentStep = steps.find((step) => step.current)
    ?? (currentStepId === null ? null : steps.find((step) => step.id === currentStepId) ?? null);
  return {
    title: raw.title,
    subtitle: raw.subtitle,
    complete: raw.complete,
    completedCount,
    totalCount: steps.length,
    currentStepId,
    currentStep,
    steps,
    blocker,
  };
}
