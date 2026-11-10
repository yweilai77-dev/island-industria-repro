/**
 * M2.0-P2-E3 终局联合工厂（T3.3 `combined-works`）的**读投影契约**。
 *
 * 终局由两个**独立**条件组成（任务书 §五 C1/C2）：
 * 1. 成套设备交付：16 件真实物品通过 E1 交付事务逐项/一键提交（已交付计数来自 TechState）；
 * 2. 运行证明：真实世界状态满足结构条件，并在观察窗口内观察到组合成员核心
 *    `producedTotal` 增量合计 ≥ 12。
 *
 * 两者都完成才判定终局完成。这里不写入任何完成标记，全部从真实状态派生。
 */

/** 一条运行证明条件。 */
export interface ProofCondition {
  readonly id: string;
  readonly label: string;
  readonly ok: boolean;
  readonly current: string;
  readonly required: string;
}

/** 运行证明的观察窗口状态。 */
export type ProofState = 'idle' | 'running' | 'passed' | 'failed';

export interface ProofSnapshot {
  readonly state: ProofState;
  /** 窗口已过秒数（idle/passed 时保留上次值）。 */
  readonly elapsedSeconds: number;
  /** 观察窗口长度（秒）。 */
  readonly durationSeconds: number;
  /** 窗口内组合成员核心 producedTotal 增量合计。 */
  readonly produced: number;
  /** 要求的最小增量。 */
  readonly target: number;
  /** 五条结构/运行条件（实时求值，窗口结束时全部为 true 才通过）。 */
  readonly conditions: readonly ProofCondition[];
  /** failed 时的人话原因；其余为 null。 */
  readonly failureReason: string | null;
}

/** 成套交付的一项。 */
export interface DeliveryEntry {
  readonly itemId: string;
  readonly name: string;
  readonly required: number;
  readonly delivered: number;
}

/** 终局只读快照（UI 终局面板与验收脚本共用）。 */
export interface EndgameSnapshot {
  readonly projectId: string;
  /** T3.3 节点是否已完成（= 终局完成）。 */
  readonly completed: boolean;
  /** T3.3 节点是否可交付（前置已完成）。 */
  readonly unlocked: boolean;
  readonly delivery: {
    readonly entries: readonly DeliveryEntry[];
    readonly totalRequired: number;
    readonly totalDelivered: number;
    readonly complete: boolean;
  };
  readonly proof: ProofSnapshot;
  /** 当前还差什么（人话，按优先级）。 */
  readonly blocks: readonly string[];
}
