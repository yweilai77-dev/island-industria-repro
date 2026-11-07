import type { Placement } from '../grid/grid.ts';
import { ITEM_IDS, type ItemId } from '../items/items.ts';

/**
 * M1.7-A 机械零件静态定义。
 * 纯数据、零引擎依赖；端口只存本地信息，世界端口由 ports.ts 从 Placement 派生。
 */

export type PartKind = 'shaft' | 'gear' | 'power-source' | 'machine';
export type PartId = 'shaft' | 'gear_12' | 'gear_24' | 'power_source' | 'machine';
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

export interface MechanicalPartDef {
  readonly id: PartId;
  readonly kind: PartKind;
  readonly itemId: ItemId;
  readonly label: string;
  readonly w: number;
  readonly d: number;
  readonly height: number;
  readonly teeth?: number;
  readonly maxTorque: number;
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

export const MECHANICAL_PART_DEFS: Readonly<Record<PartId, MechanicalPartDef>> = Object.freeze({
  shaft: {
    id: 'shaft',
    kind: 'shaft',
    itemId: ITEM_IDS.SHAFT,
    label: '传动轴',
    w: 1,
    d: 1,
    height: MECH_PART_HEIGHT,
    maxTorque: 50,
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
    maxTorque: 50,
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
    maxTorque: 50,
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
    maxTorque: 60,
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
    maxTorque: 50,
    ports: [
      { id: 'in', role: 'input', axis: 'x', face: 'nx', localCell: { gx: 0, gz: 0 }, localY: PORT_HEIGHT },
    ],
  },
});

export const MECHANICAL_PART_IDS: readonly PartId[] = Object.freeze([
  'shaft',
  'gear_12',
  'gear_24',
  'power_source',
  'machine',
]);

export const MECHANICAL_ITEM_IDS: readonly ItemId[] = Object.freeze(
  MECHANICAL_PART_IDS.map((id) => MECHANICAL_PART_DEFS[id].itemId),
);

/** 开局原型套件（数量有限，拆除返还）。 */
export const PROTOTYPE_KIT: Readonly<Record<PartId, number>> = Object.freeze({
  shaft: 24,
  gear_12: 6,
  gear_24: 4,
  power_source: 2,
  machine: 5,
});

export function partDefForItem(itemId: ItemId | null | undefined): MechanicalPartDef | undefined {
  if (itemId === null || itemId === undefined) return undefined;
  return MECHANICAL_PART_IDS
    .map((id) => MECHANICAL_PART_DEFS[id])
    .find((definition) => definition.itemId === itemId);
}

export function partDefForId(id: PartId): MechanicalPartDef {
  return MECHANICAL_PART_DEFS[id];
}
