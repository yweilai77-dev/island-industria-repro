import { levelBaseY } from '../spatial/space.ts';
import { placementCenter } from '../grid/grid.ts';
import type { Placement } from '../grid/grid.ts';
import type { MechanicalPart, Face, PartPortDef } from './parts.ts';

/** 世界空间有向端口。axis 是零件旋转轴的有向单位向量；normal 是端口朝外法线。 */
export interface WorldPort {
  readonly partId: number;
  readonly portId: string;
  readonly role: PartPortDef['role'];
  readonly axis: readonly [number, number, number];
  readonly normal: readonly [number, number, number];
  readonly anchor: readonly [number, number, number];
  readonly teeth?: number;
}

export type ConnectionKind = 'axial' | 'gearMesh';

export interface Connection {
  readonly id: string;
  readonly aPartId: number;
  readonly bPartId: number;
  readonly aPortId: string;
  readonly bPortId: string;
  readonly kind: ConnectionKind;
  /** ω_b / ω_a，按各自零件的有向轴定义。 */
  readonly ratio: number;
}

const EPS = 1e-4;

export function rotateY(x: number, z: number, radians: number): [number, number] {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [x * cos + z * sin, -x * sin + z * cos];
}

function faceVector(face: Face): [number, number, number] {
  switch (face) {
    case 'px': return [1, 0, 0];
    case 'nx': return [-1, 0, 0];
    case 'py': return [0, 1, 0];
    case 'ny': return [0, -1, 0];
    case 'pz': return [0, 0, 1];
    case 'nz': return [0, 0, -1];
  }
}

function localAxisVector(axis: PartPortDef['axis']): [number, number, number] {
  switch (axis) {
    case 'x': return [1, 0, 0];
    case 'y': return [0, 1, 0];
    case 'z': return [0, 0, 1];
  }
}

function rotateVec(x: number, y: number, z: number, radians: number): [number, number, number] {
  const [rx, rz] = rotateY(x, z, radians);
  return [rx, y, rz];
}

function anchorKey(anchor: readonly [number, number, number]): string {
  const q = (value: number): string => String(Math.round(value / EPS));
  return `${q(anchor[0])}|${q(anchor[1])}|${q(anchor[2])}`;
}

export function portWorld(part: MechanicalPart, port: PartPortDef): WorldPort {
  const radians = (part.placement.rotation * Math.PI) / 180;
  const baseY = levelBaseY(part.placement.level);
  const f = faceVector(port.face);
  // 旋转围绕零件中心（与 build 的模型放置一致），不是围绕格锚点。
  const center = placementCenter(part.placement);
  const localCenterX = port.localCell.gx + 0.5 - part.def.w / 2;
  const localCenterZ = port.localCell.gz + 0.5 - part.def.d / 2;
  const [offsetX, offsetZ] = rotateY(
    localCenterX + f[0] * 0.5,
    localCenterZ + f[2] * 0.5,
    radians,
  );
  const [axisX, axisY, axisZ] = rotateVec(...localAxisVector(port.axis), radians);
  const [normalX, normalY, normalZ] = rotateVec(f[0], f[1], f[2], radians);
  return {
    partId: part.id,
    portId: port.id,
    role: port.role,
    axis: [axisX, axisY, axisZ],
    normal: [normalX, normalY, normalZ],
    anchor: [
      center[0] + offsetX,
      baseY + port.localY,
      center[2] + offsetZ,
    ],
    teeth: part.def.teeth,
  };
}

function dot(a: readonly number[], b: readonly number[]): number {
  return (a[0] as number) * (b[0] as number)
    + (a[1] as number) * (b[1] as number)
    + (a[2] as number) * (b[2] as number);
}

function close(a: readonly number[], b: readonly number[]): boolean {
  return Math.abs((a[0] as number) - (b[0] as number)) <= EPS
    && Math.abs((a[1] as number) - (b[1] as number)) <= EPS
    && Math.abs((a[2] as number) - (b[2] as number)) <= EPS;
}

function rolePairAllowed(a: PartPortDef['role'], b: PartPortDef['role']): boolean {
  if (a === 'axial' && b === 'axial') return true;
  if (a === 'output' && b === 'axial') return true;
  if (a === 'axial' && b === 'output') return true;
  if (a === 'input' && b === 'axial') return true;
  if (a === 'axial' && b === 'input') return true;
  return false;
}

/** 轴向连接：同轴、锚点重合、法线相反；ratio 考虑有向轴。 */
export function matchAxial(a: WorldPort, b: WorldPort): number | undefined {
  if (!rolePairAllowed(a.role, b.role)) return undefined;
  if (Math.abs(dot(a.axis, b.axis)) < 1 - EPS) return undefined;
  if (dot(a.normal, b.normal) > -1 + EPS) return undefined;
  if (!close(a.anchor, b.anchor)) return undefined;
  return dot(a.axis, b.axis);
}

/** 齿轮外啮合：两 mesh、轴平行、锚点重合、法线相反；ratio 含齿数比与有向轴。 */
export function matchGearMesh(a: WorldPort, b: WorldPort): number | undefined {
  if (a.role !== 'mesh' || b.role !== 'mesh') return undefined;
  if (Math.abs(dot(a.axis, b.axis)) < 1 - EPS) return undefined;
  if (dot(a.normal, b.normal) > -1 + EPS) return undefined;
  if (!close(a.anchor, b.anchor)) return undefined;
  if (!a.teeth || !b.teeth) return undefined;
  const sameDirection = dot(a.axis, b.axis);
  return -(a.teeth / b.teeth) * sameDirection;
}

/** 从 part 端口集合构建连接；每个端口最多一条，结果按 part/port 稳定排序。 */
export function buildConnections(parts: readonly MechanicalPart[]): readonly Connection[] {
  const ports: WorldPort[] = [];
  for (const part of parts) {
    for (const port of part.def.ports) ports.push(portWorld(part, port));
  }
  const buckets = new Map<string, WorldPort[]>();
  for (const port of ports) {
    const key = anchorKey(port.anchor);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(port); else buckets.set(key, [port]);
  }
  const candidates: { a: WorldPort; b: WorldPort; kind: ConnectionKind; ratio: number }[] = [];
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i] as WorldPort;
        const b = bucket[j] as WorldPort;
        if (a.partId === b.partId) continue;
        const axial = matchAxial(a, b);
        if (axial !== undefined) {
          candidates.push({ a, b, kind: 'axial', ratio: axial });
          continue;
        }
        const mesh = matchGearMesh(a, b);
        if (mesh !== undefined) candidates.push({ a, b, kind: 'gearMesh', ratio: mesh });
      }
    }
  }
  candidates.sort((left, right) =>
    left.a.partId - right.a.partId
    || left.a.portId.localeCompare(right.a.portId)
    || left.b.partId - right.b.partId
    || left.b.portId.localeCompare(right.b.portId));
  const used = new Set<string>();
  const connections: Connection[] = [];
  for (const candidate of candidates) {
    const aKey = `${candidate.a.partId}:${candidate.a.portId}`;
    const bKey = `${candidate.b.partId}:${candidate.b.portId}`;
    if (used.has(aKey) || used.has(bKey)) continue;
    used.add(aKey);
    used.add(bKey);
    const low = candidate.a.partId < candidate.b.partId ? candidate.a : candidate.b;
    const high = low === candidate.a ? candidate.b : candidate.a;
    connections.push({
      id: `${low.partId}:${low.portId}-${high.partId}:${high.portId}`,
      aPartId: candidate.a.partId,
      bPartId: candidate.b.partId,
      aPortId: candidate.a.portId,
      bPortId: candidate.b.portId,
      kind: candidate.kind,
      ratio: candidate.ratio,
    });
  }
  return connections;
}