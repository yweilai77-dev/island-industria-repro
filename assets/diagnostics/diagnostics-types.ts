/**
 * M2.0-P2-E2/E3 生产线诊断（T3.2 `line-diagnostics` 能力）的**读投影契约**。
 *
 * 这是 Engine 侧、唯一 GameRead 与前端 UI 共用的数据形状：诊断信息必须来自真实运行时状态
 * （动力解算、加工状态机、接口盒缓冲、物料连接状态），不得由 UI 自行推断或伪造。
 * 未解锁 `line-diagnostics` 能力时服务的 `snapshot()` 返回 null（门控在业务入口生效）。
 */

/** 单条诊断的严重度。 */
export type DiagnosticsSeverity = 'ok' | 'warn' | 'error';

/** 一条「产线是否可运行」的条件（终局运行证明也复用同一形状）。 */
export interface DiagnosticsCondition {
  readonly id: string;
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** 一台加工核心的诊断（数值全部来自真实快照）。 */
export interface MachineDiagnostic {
  readonly partId: number;
  readonly coreId: string;
  readonly label: string;
  /** 机械动力是否有效（断轴/源停/过载 → false）。 */
  readonly powered: boolean;
  /** 本帧是否在推进加工。 */
  readonly running: boolean;
  /** 真实阻塞原因：ok / no-power / no-input / output-full / no-recipe。 */
  readonly block: string;
  readonly recipeId: string | null;
  readonly recipeLabel: string | null;
  readonly progress: number;
  readonly inputItem: string | null;
  readonly inputCount: number;
  readonly outputItem: string | null;
  readonly outputCount: number;
  /** 输入侧接口盒是否已满（没有输入位时为 false）。 */
  readonly inputPortFull: boolean;
  /** 输出侧接口盒是否已满（没有输出位时为 false）。 */
  readonly outputPortFull: boolean;
  /** 该机器输入侧当前被哪条阻塞的物料连接卡住（没有则为 null）。 */
  readonly blockedLinkId: string | null;
  readonly severity: DiagnosticsSeverity;
  readonly message: string;
}

/** 一条物料连接的诊断。 */
export interface LinkDiagnostic {
  readonly id: string;
  readonly fromCoreId: string;
  readonly toCoreId: string;
  /** 连接的当前状态枚举（来自 PortRuntime）。 */
  readonly state: string;
  readonly transferred: number;
  /** 连接是否在阻塞（下游满 / 上游无料 / 断电）。 */
  readonly blocked: boolean;
  readonly severity: DiagnosticsSeverity;
  readonly message: string;
}

/** 当前最值得玩家处理的一个瓶颈（没有则 null）。 */
export interface DiagnosticsBottleneck {
  readonly kind: 'supply' | 'power' | 'logistics' | 'output' | 'none';
  readonly label: string;
  readonly detail: string;
  readonly partId?: number;
  readonly linkId?: string;
}

/** 生产线诊断只读快照（前端「诊断」页与验收脚本共用）。 */
export interface DiagnosticsSnapshot {
  /** `line-diagnostics` 能力是否已解锁（未解锁时服务返回 null，不返回 false）。 */
  readonly unlocked: true;
  readonly machines: readonly MachineDiagnostic[];
  readonly links: readonly LinkDiagnostic[];
  readonly bottleneck: DiagnosticsBottleneck | null;
  readonly summary: {
    readonly total: number;
    readonly running: number;
    readonly idle: number;
    readonly blocked: number;
    readonly powered: number;
  };
  /** 是否存在至少一个 error 级诊断。 */
  readonly hasError: boolean;
}
