import { quat } from '@forgeax/engine/math';
import { Transform } from '@forgeax/engine/scene';
import type { EntityHandle } from '@forgeax/engine/ecs';
import { rotateY, worldAxis } from './ports.ts';
import type { MechanicalPart } from './parts.ts';
import { DEFAULT_MACHINE_GEOMETRY, type MachinePose } from './machine.ts';
import type { PartView } from './visuals.ts';

const DEG = Math.PI / 180;

/** 世界有向轴 → 零件 root 本地自转轴。root 只有 yaw；B 阶段所有零件本地轴为 X。 */
function localSpinAxis(part: MechanicalPart): [number, number, number] {
  const axis = worldAxis(part);
  const [x, z] = rotateY(axis[0], axis[2], -(part.placement.rotation * DEG));
  return [x, axis[1], z];
}

function readTransform(world: any, entity: EntityHandle): { pos: any; scale: any; quat: any } | undefined {
  const result = world.get(entity, Transform);
  if (!result.ok) return undefined;
  return result.value;
}

function setQuat(world: any, entity: EntityHandle, nextQuat: readonly [number, number, number, number]): void {
  const transform = readTransform(world, entity);
  if (!transform) return;
  world.set(entity, Transform, {
    pos: transform.pos,
    scale: transform.scale,
    quat: [nextQuat[0], nextQuat[1], nextQuat[2], nextQuat[3]],
  }).unwrap();
}

function setPose(
  world: any,
  entity: EntityHandle,
  pos: readonly [number, number, number],
  scale: readonly [number, number, number],
  nextQuat: readonly [number, number, number, number],
): void {
  const transform = readTransform(world, entity);
  if (!transform) return;
  world.set(entity, Transform, {
    pos: [pos[0], pos[1], pos[2]],
    scale: [scale[0], scale[1], scale[2]],
    quat: [nextQuat[0], nextQuat[1], nextQuat[2], nextQuat[3]],
  }).unwrap();
}

/** 轴/齿轮/源轮/机器输入轮的自转；使用 worldAxis 同一方向定义。 */
export function applySpin(world: any, view: PartView, part: MechanicalPart, angle: number): void {
  if (!view.spinner) return;
  const spin = quat.fromAxisAngle(quat.create(), localSpinAxis(part), angle);
  const base = view.spinBaseQuat ?? [0, 0, 0, 1];
  const composed = quat.multiply(quat.create(), spin, base);
  setQuat(world, view.spinner, [composed[0] ?? 0, composed[1] ?? 0, composed[2] ?? 0, composed[3] ?? 1]);
}

/** 冲压机曲柄销/连杆/冲头位姿；只写 Transform，不决定 powered。 */
export function applyMachinePose(world: any, view: PartView, pose: MachinePose): void {
  const machine = view.machine;
  if (!machine) return;
  const x = DEFAULT_MACHINE_GEOMETRY.crankX;
  const rod = quat.fromAxisAngle(quat.create(), [1, 0, 0], pose.rodAngle);
  setPose(world, machine.crankPin, [x, pose.pinY, pose.pinZ], [1, 1, 1], [0, 0, 0, 1]);
  setPose(
    world,
    machine.rod,
    pose.rodCenter,
    [1, pose.rodLength, 1],
    [rod[0] ?? 0, rod[1] ?? 0, rod[2] ?? 0, rod[3] ?? 1],
  );
  setPose(world, machine.ram, [x, pose.ramY, 0], [1, 1, 1], [0, 0, 0, 1]);
}
