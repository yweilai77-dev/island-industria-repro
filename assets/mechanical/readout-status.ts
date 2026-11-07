import type { PowerComponent } from './power.ts';

/**
 * M1.7-C 读数状态映射（纯逻辑，可单测）。
 *
 * 读数必须与动力解算器一致：本模块只做"解算结果 → 显示状态"的映射，
 * 不重新计算负载/转速，避免显示层出现第二套物理结果。
 */

export type ReadoutStatus =
  | 'powered'
  | 'loaded'
  | 'disabled'
  | 'idle'
  | 'source-overload'
  | 'branch-overload'
  | 'cyclic'
  | 'unsupported';

export const STATUS_TEXT: Readonly<Record<ReadoutStatus, string>> = {
  powered: 'POWERED',
  loaded: 'LOADED',
  disabled: 'DISABLED',
  idle: 'IDLE',
  'source-overload': 'SOURCE OVERLOAD',
  'branch-overload': 'BRANCH OVERLOAD',
  cyclic: 'CYCLIC UNSUPPORTED',
  unsupported: 'UNSUPPORTED',
};

export interface ReadoutTarget {
  /** 当前转速（RPM）；null 表示该零件没有解算结果。 */
  readonly rpm: number | null;
  /** 该零件轴上的负载扭矩（N·m）；null 表示没有解算数据。 */
  readonly torque: number | null;
  /** 该零件承载能力（N·m）。 */
  readonly capacity: number;
  readonly status: ReadoutStatus;
}

export interface ReadoutInput {
  readonly component: PowerComponent | undefined;
  /** 该零件是否被局部/整体过载停转。 */
  readonly stalled: boolean;
  /** 解算出的角速度（rad/s），无动力时为 0。 */
  readonly omega: number;
  /** 解算出的该零件扭矩（N·m）。 */
  readonly torque: number;
  readonly capacity: number;
  /** 组件速度因子（1 = 额定）；未解算时传 0。 */
  readonly speedFactor: number;
  /** 转速因子 ≥ 该值时显示 POWERED，否则 LOADED。 */
  readonly poweredFactor?: number;
}

const DEFAULT_POWERED_FACTOR = 0.75;

export function readoutStatusOf(input: ReadoutInput): ReadoutStatus {
  const { component } = input;
  if (!component) return 'idle';
  if (component.status === 'unsupported') {
    return component.reason === 'cyclic-network' ? 'cyclic' : 'unsupported';
  }
  if (component.status === 'stalled') {
    return component.reason === 'source-overload' ? 'source-overload' : 'branch-overload';
  }
  if (input.stalled) return 'branch-overload';
  if (component.status === 'idle') {
    return component.sourceIds.length > 0 ? 'disabled' : 'idle';
  }
  const threshold = input.poweredFactor ?? DEFAULT_POWERED_FACTOR;
  return input.speedFactor >= threshold ? 'powered' : 'loaded';
}

/** 组装读数：数值直接取自解算结果；不支持的网络没有解算数据，显示 —。 */
export function readoutTargetOf(input: ReadoutInput): ReadoutTarget {
  const status = readoutStatusOf(input);
  const solved = input.component !== undefined && input.component.status !== 'unsupported';
  return {
    rpm: solved ? (Math.abs(input.omega) * 60) / (Math.PI * 2) : null,
    torque: solved ? input.torque : null,
    capacity: input.capacity,
    status,
  };
}
