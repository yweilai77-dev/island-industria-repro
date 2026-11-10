import type { Placement } from '../grid/grid.ts';
import { ITEM_IDS, type ItemId } from '../items/items.ts';

/**
 * M1.7-A 机械零件静态定义；M1.8 新增跨层传动、正式动力源、加工机器与溜槽。
 * 纯数据、零引擎依赖；端口只存本地信息，世界端口由 ports.ts 从 Placement 派生。
 */

export type PartKind = 'shaft' | 'gear' | 'power-source' | 'machine' | 'transport' | 'structure';
export type PartId =
  | 'shaft'
  | 'gear_12'
  | 'gear_24'
  | 'power_source'
  | 'machine'
  | 'vertical_drive'
  | 'flywheel_source'
  | 'crusher'
  | 'smelter'
  | 'forge'
  | 'chute'
  | 'structure_frame';
export type Axis = 'x' | 'y' | 'z';
export type PortRole = 'axial' | 'mesh' | 'input' | 'output';
export type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

export interface PartPortDef {
  readonly id: string;
  readonly role: PortRole;
  readonly axis: Axis;
  readonly face: Face;
  readonly localCell: { readonly gx: number; readonly gz: number };
  readonly localY: number;
}

/** 正式动力源（手摇飞轮）的能量模型参数。 */
export interface EnergySourceSpec {
  /** 飞轮满能量（单位：能量点）。 */
  readonly capacity: number;
  /** 摇动时每秒注入的能量。 */
  readonly windRate: number;
  /** 空载时每秒消耗的能量。 */
  readonly baseDrain: number;
  /** 满负载时额外每秒消耗的能量（按 demand/capacity 线性插值）。 */
  readonly loadDrain: number;
  /** 玩家可摇动的水平距离（米）。 */
  readonly range: number;
}

/** 加工机器的缓冲容量（件）。 */
export interface BufferSpec {
  readonly input: number;
  readonly output: number;
}

export interface MechanicalPartDef {
  readonly id: PartId;
  readonly kind: PartKind;
  readonly itemId: ItemId;
  readonly label: string;
  readonly w: number;
  readonly d: number;
  readonly height: number;
  readonly teeth?: number;
  /** 承载能力（N·m）。传动件上通过的扭矩超过它，该支路停止。 */
  readonly maxTorque: number;
  /** 机器运转时消耗的扭矩（N·m）；只有 machine 使用，缺省视为 0。 */
  readonly loadTorque?: number;
  /** 动力源额定转速（RPM）；无负载时的输出转速。 */
  readonly ratedRpm?: number;
  /** 正式动力源的能量模型；测试动力源没有该字段（无限能量）。 */
  readonly energy?: EnergySourceSpec;
  /** 加工机器的输入/输出缓冲容量。 */
  readonly buffers?: BufferSpec;
  readonly ports: readonly PartPortDef[];
}

export interface MechanicalPart {
  readonly id: number;
  readonly def: MechanicalPartDef;
  readonly placement: Placement;
}

/** 齿轮节圆/视觉尺寸：首版所有齿轮 1×1、同一节圆/外径。 */
export const GEAR_PITCH_RADIUS = 0.45;
export const GEAR_OUTER_RADIUS = 0.50;
export const GEAR_ROOT_RADIUS = 0.40;
export const GEAR_FACE_WIDTH = 0.20;
export const GEAR_BORE_RADIUS = 0.09;
export const SHAFT_RADIUS = 0.09;
export const SHAFT_LENGTH = 0.90;
export const MECH_PART_HEIGHT = 1;
export const PORT_HEIGHT = 0.5;
export const GEAR_TEETH_SMALL = 12;
export const GEAR_TEETH_LARGE = 24;
/** 标准层高：立式传动带的高度等于它，才能同时接上/下一层的 0.5m 端口面。 */
export const VERTICAL_DRIVE_HEIGHT = 3;
/** 立式传动带顶部端口的本地高度：下一层端口面 = 3 × n + 0.5。 */
export const VERTICAL_DRIVE_TOP_PORT_Y = 3.5;

/**
 * M1.7-C 扭矩标定（N·m）。三个角色分开，才能同时演示三条规则：
 * - 动力源 100：整网负载 ≥ 100 时整个网络过载停止；
 * - 传动轴 150：干线不先于动力源失效，让总负载先压到动力源；
 * - 齿轮 50：齿轮是薄弱环节，单条支路负载 > 50 只停这条支路；
 * - 冲压机负载 20：1 / 2 / 3 台分别把网络压到 80% / 60% / 40% 转速，5 台整网停止。
 *
 * M1.8：飞轮储能机容量提高到 140，才带得动「破碎机 18 + 熔炼炉 24 + 锻压机 22」三条产线；
 * 立式传动带按传动轴 150 标定。
 */
export const TORQUE_SOURCE = 100;
export const TORQUE_SHAFT = 150;
export const TORQUE_GEAR = 50;
export const TORQUE_MACHINE = 50;
export const MACHINE_LOAD = 20;
export const TORQUE_FLYWHEEL = 140;

/** 各机器的额定负载（N·m）。 */
export const CRUSHER_LOAD = 18;
export const SMELTER_LOAD = 24;
export const FORGE_LOAD = 22;

/** SpatialIndex / StructureRegistry 的机械 structure 公开 ID。 */
export const MECH_STRUCTURE_PREFIX = 'mech:';
export function structureIdForPart(partId: number): string {
  return `${MECH_STRUCTURE_PREFIX}${partId}`;
}
/** SpatialIndex 内部会在公开 ID 前再拼 'structure:'；仅用于反查。 */
export function spatialRecordIdForPart(partId: number): string {
  return `structure:${structureIdForPart(partId)}`;
}

const SHAFT_PORTS: readonly PartPortDef[] = [
  { id: 'a', role: 'axial', axis: 'x', face: 'nx', localCell: { gx: 0, gz: 0 }, localY: PORT_HEIGHT },
  { id: 'b', role: 'axial', axis: 'x', face: 'px', localCell: { gx: 0, gz: 0 }, localY: PORT_HEIGHT },
];

/**
 * 立式传动带端口几何（关键：与上下层的 0.5m 端口面精确重合）。
 * - 底部端口：face nx、localY 0.5 → 世界锚点 (gx, 3L+0.5, gz+0.5)，接同层 (gx-1, gz) 的轴；
 * - 顶部端口：face px、localY 3.5 → 世界锚点 (gx+1, 3L+3.5, gz+0.5)，接上一层 (gx+1, gz) 的轴；
 * - 叠层：level L 的顶部与 level L+1 的底部锚点都是 (gx+1, 3(L+1)+0.5)，法线相反、轴平行 → 自动成链。
 */
const VERTICAL_DRIVE_PORTS: readonly PartPortDef[] = [
  { id: 'bottom', role: 'axial', axis: 'x', face: 'nx', localCell: { gx: 0, gz: 0 }, localY: PORT_HEIGHT },
  {
    id: 'top',
    role: 'axial',
    axis: 'x',
    face: 'px',
    localCell: { gx: 0, gz: 0 },
    localY: VERTICAL_DRIVE_TOP_PORT_Y,
  },
];

function gearPorts(): readonly PartPortDef[] {
  return [
    { id: 'axial-a', role: 'axial', axis: 'x', face: 'nx', localCell: { gx: 0, gz: 0 }, localY: PORT_HEIGHT },
    { id: 'axial-b', role: 'axial', axis: 'x', face: 'px', localCell: { gx: 0, gz: 0 }, localY: PORT_HEIGHT },
    { id: 'mesh-a', role: 'mesh', axis: 'x', face: 'nz', localCell: { gx: 0, gz: 0 }, localY: PORT_HEIGHT },
    { id: 'mesh-b', role: 'mesh', axis: 'x', face: 'pz', localCell: { gx: 0, gz: 0 }, localY: PORT_HEIGHT },
    { id: 'mesh-c', role: 'mesh', axis: 'x', face: 'ny', localCell: { gx: 0, gz: 0 }, localY: PORT_HEIGHT },
    { id: 'mesh-d', role: 'mesh', axis: 'x', face: 'py', localCell: { gx: 0, gz: 0 }, localY: PORT_HEIGHT },
  ];
}

/** 加工机器的机械输入端口（本地 -X 面），与现有冲压机一致。 */
const MACHINE_INPUT_PORTS: readonly PartPortDef[] = [
  { id: 'in', role: 'input', axis: 'x', face: 'nx', localCell: { gx: 0, gz: 0 }, localY: PORT_HEIGHT },
];

export const MECHANICAL_PART_DEFS: Readonly<Record<PartId, MechanicalPartDef>> = Object.freeze({
  shaft: {
    id: 'shaft',
    kind: 'shaft',
    itemId: ITEM_IDS.SHAFT,
    label: '传动轴',
    w: 1,
    d: 1,
    height: MECH_PART_HEIGHT,
    maxTorque: TORQUE_SHAFT,
    ports: SHAFT_PORTS,
  },
  gear_12: {
    id: 'gear_12',
    kind: 'gear',
    itemId: ITEM_IDS.GEAR_12,
    label: '12 齿齿轮',
    w: 1,
    d: 1,
    height: MECH_PART_HEIGHT,
    teeth: GEAR_TEETH_SMALL,
    maxTorque: TORQUE_GEAR,
    ports: gearPorts(),
  },
  gear_24: {
    id: 'gear_24',
    kind: 'gear',
    itemId: ITEM_IDS.GEAR_24,
    label: '24 齿齿轮',
    w: 1,
    d: 1,
    height: MECH_PART_HEIGHT,
    teeth: GEAR_TEETH_LARGE,
    maxTorque: TORQUE_GEAR,
    ports: gearPorts(),
  },
  power_source: {
    id: 'power_source',
    kind: 'power-source',
    itemId: ITEM_IDS.POWER_SOURCE,
    label: '测试动力源',
    w: 1,
    d: 1,
    height: MECH_PART_HEIGHT,
    maxTorque: TORQUE_SOURCE,
    ratedRpm: 60,
    ports: [
      { id: 'out', role: 'output', axis: 'x', face: 'px', localCell: { gx: 0, gz: 0 }, localY: PORT_HEIGHT },
    ],
  },
  machine: {
    id: 'machine',
    kind: 'machine',
    itemId: ITEM_IDS.MACHINE,
    label: '冲压机',
    w: 1,
    d: 1,
    height: MECH_PART_HEIGHT,
    maxTorque: TORQUE_MACHINE,
    loadTorque: MACHINE_LOAD,
    ports: MACHINE_INPUT_PORTS,
  },
  vertical_drive: {
    id: 'vertical_drive',
    kind: 'shaft',
    itemId: ITEM_IDS.VERTICAL_DRIVE,
    label: '立式传动带',
    w: 1,
    d: 1,
    height: VERTICAL_DRIVE_HEIGHT,
    maxTorque: TORQUE_SHAFT,
    ports: VERTICAL_DRIVE_PORTS,
  },
  flywheel_source: {
    id: 'flywheel_source',
    kind: 'power-source',
    itemId: ITEM_IDS.FLYWHEEL_SOURCE,
    label: '手摇飞轮储能机',
    w: 1,
    d: 1,
    height: MECH_PART_HEIGHT,
    maxTorque: TORQUE_FLYWHEEL,
    ratedRpm: 60,
    energy: { capacity: 300, windRate: 45, baseDrain: 6, loadDrain: 14, range: 2.2 },
    ports: [
      { id: 'out', role: 'output', axis: 'x', face: 'px', localCell: { gx: 0, gz: 0 }, localY: PORT_HEIGHT },
    ],
  },
  crusher: {
    id: 'crusher',
    kind: 'machine',
    itemId: ITEM_IDS.CRUSHER,
    label: '破碎机',
    w: 1,
    d: 1,
    height: MECH_PART_HEIGHT,
    maxTorque: TORQUE_MACHINE,
    loadTorque: CRUSHER_LOAD,
    buffers: { input: 4, output: 4 },
    ports: MACHINE_INPUT_PORTS,
  },
  smelter: {
    id: 'smelter',
    kind: 'machine',
    itemId: ITEM_IDS.SMELTER,
    label: '熔炼炉',
    w: 1,
    d: 1,
    height: MECH_PART_HEIGHT,
    maxTorque: TORQUE_MACHINE,
    loadTorque: SMELTER_LOAD,
    buffers: { input: 4, output: 4 },
    ports: MACHINE_INPUT_PORTS,
  },
  forge: {
    id: 'forge',
    kind: 'machine',
    itemId: ITEM_IDS.FORGE,
    label: '锻压机',
    w: 1,
    d: 1,
    height: MECH_PART_HEIGHT,
    maxTorque: TORQUE_MACHINE,
    loadTorque: FORGE_LOAD,
    // P2-E3 修复：输入缓冲必须放得下「整笔原料」的最重配方。
    // 原 6 放不下 forge-smelter(7)/forge-processing-core(8)/forge-flywheel(12)，
    // 这会让 T2.3/T2.4/T3.2 的三条配方永远无法开工（整笔扣料被容量挡住）。
    // 契约测试见 assets/__tests__/recipe-capacity.test.ts。
    buffers: { input: 12, output: 4 },
    ports: MACHINE_INPUT_PORTS,
  },
  chute: {
    id: 'chute',
    kind: 'transport',
    itemId: ITEM_IDS.CHUTE,
    label: '重力溜槽',
    w: 1,
    d: 1,
    height: MECH_PART_HEIGHT,
    maxTorque: 0,
    ports: [],
  },
  /**
   * P2-D 结构模块：不传动力、不传物料、不参与加工与物流。
   * 它只提供世界空间占用与「结构相邻」关系，由 assembly 插件据此推导组合机械。
   */
  structure_frame: {
    id: 'structure_frame',
    kind: 'structure',
    itemId: ITEM_IDS.STRUCTURE_FRAME,
    label: '结构框架',
    w: 1,
    d: 1,
    height: MECH_PART_HEIGHT,
    maxTorque: 0,
    ports: [],
  },
});

/** 零件顺序决定初始套件绑定到快捷栏槽位的顺序；前 5 项必须保持不变（历史验收脚本依赖）。 */
export const MECHANICAL_PART_IDS: readonly PartId[] = Object.freeze([
  'shaft',
  'gear_12',
  'gear_24',
  'power_source',
  'machine',
  'chute',
  'vertical_drive',
  'crusher',
  'smelter',
  'forge',
  'flywheel_source',
  'structure_frame',
]);

export const MECHANICAL_ITEM_IDS: readonly ItemId[] = Object.freeze(
  MECHANICAL_PART_IDS.map((id) => MECHANICAL_PART_DEFS[id].itemId),
);

/**
 * 开局原型套件（数量有限，拆除返还）。
 * M1.8：新增零件只给到「刚好搭出一条完整生产链」的量，扩充要靠铁锭在锻压机上制造。
 * P2-C：破碎机 / 熔炼炉各给 3 台、测试动力源给 4 台、锻压机仍给 1 台。
 * 多核心物料网络（合流需要两台同种上游、分流需要两台同种下游）没有这些最小数量就搭不出来；
 * 多给的余量同时保证「全部摆出去时背包里仍有 1 个」，否则快捷栏绑定会因数量归零被自动解除，
 * 玩家接着再放同一零件时会因为选中槽变空而落入普通建造模式。
 * 更多的加工核心可以从锻压机的新配方（forge-crusher / forge-smelter / forge-processing-core）制造。
 */
export const PROTOTYPE_KIT: Readonly<Record<PartId, number>> = Object.freeze({
  shaft: 24,
  gear_12: 6,
  gear_24: 4,
  power_source: 4,
  machine: 5,
  chute: 3,
  vertical_drive: 2,
  crusher: 3,
  smelter: 3,
  forge: 1,
  flywheel_source: 1,
  // P2-D：结构框架不走快捷栏（无空槽），由 assembly 插件单独发放原型数量。
  structure_frame: 0,
});

/**
 * 初始套件绑定到快捷栏的槽位表。
 * 索引 0-4 必须保持 M1.7 的原有顺序（历史验收脚本硬编码 Digit1-5）；
 * 索引 5 必须保持**空槽**（历史脚本用 Digit6 切到空槽以退出机械模式）；
 * 新增零件从索引 6 起，对应键盘 Digit7 / Digit8 / Digit9 / Digit0 / Minus / Equal。
 */
export const PROTOTYPE_KIT_SLOTS: readonly { readonly slot: number; readonly id: PartId }[] = Object.freeze([
  { slot: 0, id: 'shaft' },
  { slot: 1, id: 'gear_12' },
  { slot: 2, id: 'gear_24' },
  { slot: 3, id: 'power_source' },
  { slot: 4, id: 'machine' },
  { slot: 6, id: 'chute' },
  { slot: 7, id: 'vertical_drive' },
  { slot: 8, id: 'flywheel_source' },
  { slot: 9, id: 'crusher' },
  { slot: 10, id: 'smelter' },
  { slot: 11, id: 'forge' },
]);

export function partDefForItem(itemId: ItemId | null | undefined): MechanicalPartDef | undefined {  if (itemId === null || itemId === undefined) return undefined;
  return MECHANICAL_PART_IDS
    .map((id) => MECHANICAL_PART_DEFS[id])
    .find((definition) => definition.itemId === itemId);
}

export function partDefForId(id: PartId): MechanicalPartDef {
  return MECHANICAL_PART_DEFS[id];
}

/** 加工机器（有配方、消耗/产出物品的机器）；冲压机只是运动学原型，不在其列。 */
export const PRODUCTION_MACHINE_IDS: readonly PartId[] = Object.freeze(['crusher', 'smelter', 'forge']);

export function isProductionMachine(def: MechanicalPartDef | undefined): boolean {
  return def !== undefined && (PRODUCTION_MACHINE_IDS as readonly string[]).includes(def.id);
}
