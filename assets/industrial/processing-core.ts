import type { BufferSpec, Face, PartId } from '../mechanical/parts.ts';
import { MECHANICAL_PART_DEFS, PORT_HEIGHT, PRODUCTION_MACHINE_IDS } from '../mechanical/parts.ts';
import { inputCapacity, outputCapacity } from '../production/production.ts';
import { recipesFor } from '../production/recipes.ts';
import {
  makeCoreId,
  type CoreId,
  type PortSlotId,
  type PortSlotRole,
  type ProcessKind,
  type RecipeId,
} from './ids.ts';

/**
 * M2.0-P2-A 加工核心定义（纯数据、零引擎依赖、深度冻结）。
 *
 * 一个 ProcessingCoreDef 描述**一门加工工艺的载体**：
 *   加工什么（process）、多快（speedMultiplier + Recipe.seconds）、要多少动力（ratedLoadTorque）、
 *   有哪些表面安装位（portSlots）、能做哪些配方（recipeIds）。
 *
 * 它**不**描述：世界位置、实时进度、缓冲内容、已装接口、所属组合机械 —— 那些都属于运行时状态。
 *
 * 关键约束（详见 docs/m20/P2-A-DESIGN.md §3.3）：
 * - `ratedLoadTorque` / `buffers` / 几何 / `recipeIds` **全部从现有真源派生**，不手写第二份数值。
 *   现有 `solvePower` 已经把同一网络内所有机器的 loadTorque 相加，
 *   所以「组合设备动力需求 = 各核心之和」不需要新系统。
 * - 唯一新写的数据是 `portSlots`（机器表面预留安装位），因为现有系统没有这个概念。
 *
 * 文件拆分：安装位几何与工艺绑定都在本文件；接口盒在 port-module.ts；索引与校验在
 * catalog.ts / integrity.ts。三者都在 20 KB 提交上限以内。
 */

/** 机器表面的一个预留安装位（将来装接口盒）。 */
export interface PortSlotDef {
  /** 稳定 ID，例：`slot.crusher.in.pz`。 */
  readonly id: PortSlotId;
  /** 物料方向：input = 物料进机器；output = 物料出机器。 */
  readonly role: PortSlotRole;
  /** 所在表面；复用机械端口同一套 Face 约定。 */
  readonly face: Face;
  /** 本地面上的格偏移（与机械端口 localCell 同一约定）。 */
  readonly localCell: { readonly gx: number; readonly gz: number };
  /** 安装高度（米，相对该层底面）；默认与机械端口同高。 */
  readonly localY: number;
  /** 该安装位同一时刻可承载的物品件数（派生自零件缓冲容量）。 */
  readonly capacity: number;
}

/** 加工核心的静态定义。 */
export interface ProcessingCoreDef {
  /** 稳定 ID，例：`core.crusher`。 */
  readonly id: CoreId;
  /** 显示名（与 MechanicalPartDef.label 同源）。 */
  readonly label: string;
  /**
   * 身份桥：当前实现里「加工核心本体」就是一个可放置的机械零件。
   * 将来若核心可以被装进更大的结构，这个字段仍然指向它在机械层的本体。
   */
  readonly corePartId: PartId;
  /** 加工工艺。 */
  readonly process: ProcessKind;
  /** 加工速度倍率：1 = 按 `Recipe.seconds` 的原始时长（rate = 1.0，即 60 RPM）。 */
  readonly speedMultiplier: number;
  /** 额定动力需求（N·m）；与 `MechanicalPartDef.loadTorque` 同一数值。 */
  readonly ratedLoadTorque: number;
  /** 输入/输出缓冲容量（件）；与 `MechanicalPartDef.buffers` 同一数值。 */
  readonly buffers: BufferSpec;
  /** 占地（格）；与 `MechanicalPartDef.w/d` 同一数值。 */
  readonly footprint: { readonly w: number; readonly d: number };
  /** 高度（米）；与 `MechanicalPartDef.height` 同一数值。 */
  readonly height: number;
  /** 本核心可执行的配方 ID（与 `recipesFor(corePartId)` 一一对应）。 */
  readonly recipeIds: readonly RecipeId[];
  /** 表面预留安装位（本阶段每核心 1 输入 + 1 输出）。 */
  readonly portSlots: readonly PortSlotDef[];
}

/** 构造安装位 ID：`slot.<coreKey>.<in|out>.<face>`。 */
export function makePortSlotId(coreKey: string, role: PortSlotRole, face: Face): PortSlotId {
  return `slot.${coreKey}.${role === 'input' ? 'in' : 'out'}.${face}` as PortSlotId;
}

/** 工艺绑定：把机械零件映射到加工工艺。新增加工机器时必须在此登记。 */
interface ProcessSpec {
  readonly process: ProcessKind;
  readonly speedMultiplier: number;
}

/**
 * 第一个需要人工选择的数据点：零件 → 工艺。
 * 现有三台加工机器与工艺一一对应，速度倍率一律 1（与现有行为完全一致）。
 * 完整性校验会检查 `PRODUCTION_MACHINE_IDS` 里的每个零件都在这里有登记。
 */
const PROCESS_SPEC_BY_PART = new Map<string, ProcessSpec>([
  ['crusher', { process: 'crushing', speedMultiplier: 1 }],
  ['smelter', { process: 'smelting', speedMultiplier: 1 }],
  ['forge', { process: 'forging', speedMultiplier: 1 }],
]);

/** 安装位布局：面 + 方向。 */
interface PortSlotSpec {
  readonly role: PortSlotRole;
  readonly face: Face;
}

/**
 * 第二个需要人工选择的数据点：安装位布局。
 *
 * 两条硬约束（integrity.ts 会断言）：
 * - 输出位必须在 `px` 面：运行时 `pushMachineOutputs()` 固定把产物推到本地 +X；
 * - 安装位不得与机械动力端口同面：三台机器的动力输入都在 `nx`，接口盒不能盖住传动轴。
 *
 * 因此物料输入位当前选在 `pz`（本地 +Z）。**这是 P2-B 可调整的数据，不是玩法规则**；
 * P2-B 若要改变安装面或增加安装位，只改这张表即可，数据模型不变。
 */
const PORT_SLOT_LAYOUT_BY_PART = new Map<string, readonly PortSlotSpec[]>([
  [
    'crusher',
    [
      { role: 'input', face: 'pz' },
      { role: 'output', face: 'px' },
    ],
  ],
  [
    'smelter',
    [
      { role: 'input', face: 'pz' },
      { role: 'output', face: 'px' },
    ],
  ],
  [
    'forge',
    [
      { role: 'input', face: 'pz' },
      { role: 'output', face: 'px' },
    ],
  ],
]);

function slotDefOf(partId: PartId, spec: PortSlotSpec): PortSlotDef {
  const def = MECHANICAL_PART_DEFS[partId];
  const capacity = spec.role === 'input' ? inputCapacity(def) : outputCapacity(def);
  return Object.freeze({
    id: makePortSlotId(partId, spec.role, spec.face),
    role: spec.role,
    face: spec.face,
    localCell: Object.freeze({ gx: 0, gz: 0 }),
    localY: PORT_HEIGHT,
    capacity,
  });
}

function buildCore(partId: PartId): ProcessingCoreDef | undefined {
  const def = MECHANICAL_PART_DEFS[partId];
  const processSpec = PROCESS_SPEC_BY_PART.get(partId);
  const layout = PORT_SLOT_LAYOUT_BY_PART.get(partId);
  // 缺登记时不抛错：由 integrity.ts 报成可读问题，测试统一断言「零问题」。
  if (!def || !processSpec || !layout) return undefined;
  return Object.freeze({
    id: makeCoreId(partId),
    label: def.label,
    corePartId: partId,
    process: processSpec.process,
    speedMultiplier: processSpec.speedMultiplier,
    ratedLoadTorque: def.loadTorque ?? 0,
    buffers: Object.freeze({
      input: inputCapacity(def),
      output: outputCapacity(def),
    }),
    footprint: Object.freeze({ w: def.w, d: def.d }),
    height: def.height,
    recipeIds: Object.freeze(recipesFor(partId).map((recipe) => recipe.id)),
    portSlots: Object.freeze(layout.map((spec) => slotDefOf(partId, spec))),
  });
}

/**
 * 全部加工核心定义（只读、冻结）。
 * 顺序与 `PRODUCTION_MACHINE_IDS` 一致，便于稳定遍历与快照对比。
 */
export const PROCESSING_CORES: readonly ProcessingCoreDef[] = Object.freeze(
  PRODUCTION_MACHINE_IDS
    .map((partId) => buildCore(partId))
    .filter((core): core is ProcessingCoreDef => core !== undefined),
);
