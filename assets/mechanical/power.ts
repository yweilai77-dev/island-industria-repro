import type { Connection } from './ports.ts';
import type { MechanicalPart } from './parts.ts';

/**
 * M1.7-B 动力网络纯逻辑。
 *
 * 边界（已确认）：
 * - 只沿 axial 连接传播；
 * - 单源、恒定转速；
 * - 含齿轮的组件 unsupported/gear-requires-c；
 * - 多源组件 unsupported/multiple-sources；
 * - 机器是终端，BFS 不穿过机器继续传播；
 * - 不做负载/减速/过载/齿轮比计算。
 */

export type NetworkStatus = 'idle' | 'powered' | 'unsupported';
export type NetworkReason = 'no-source' | 'multiple-sources' | 'gear-requires-c';

export interface AxialNeighbor {
  readonly neighbor: number;
  /** ω_neighbor / ω_current。 */
  readonly ratio: number;
}

export interface PowerComponent {
  readonly id: number;
  readonly partIds: readonly number[];
  readonly sourceIds: readonly number[];
  readonly machineIds: readonly number[];
  readonly gearPartIds: readonly number[];
  /** 结构状态；solvePower 会根据 source enabled 把单源组件细化为 idle/powered。 */
  readonly status: NetworkStatus;
  readonly reason: NetworkReason | null;
}

export interface PowerTopology {
  readonly revision: number;
  readonly components: readonly PowerComponent[];
  readonly componentByPart: ReadonlyMap<number, number>;
  readonly axialAdjacency: ReadonlyMap<number, readonly AxialNeighbor[]>;
}

export interface PowerSolution {
  readonly revision: number;
  readonly components: readonly PowerComponent[];
  /** 每零件相对自身有向轴的 ω；不存在的零件表示无动力。 */
  readonly omegaByPart: ReadonlyMap<number, number>;
  readonly poweredMachines: ReadonlySet<number>;
}

const TAU = Math.PI * 2;

function sourceRpm(part: MechanicalPart): number {
  return part.def.ratedRpm ?? 60;
}

/**
 * 从 parts + connections 构建一次拓扑。只在 mechanical.revision 变化时调用。
 * 组件按 axial 边连通；gearMesh 边不参与传播。
 */
export function buildPowerTopology(
  parts: readonly MechanicalPart[],
  connections: readonly Connection[],
  revision: number,
): PowerTopology {
  const partMap = new Map<number, MechanicalPart>();
  for (const part of parts) partMap.set(part.id, part);

  const adjacency = new Map<number, AxialNeighbor[]>();
  for (const part of parts) adjacency.set(part.id, []);

  for (const connection of connections) {
    if (connection.kind !== 'axial') continue;
    if (!partMap.has(connection.aPartId) || !partMap.has(connection.bPartId)) continue;
    const ratio = connection.ratio;
    if (!Number.isFinite(ratio) || ratio === 0) continue;
    adjacency.get(connection.aPartId)!.push({ neighbor: connection.bPartId, ratio });
    adjacency.get(connection.bPartId)!.push({ neighbor: connection.aPartId, ratio: 1 / ratio });
  }

  const visited = new Set<number>();
  const rawComponents: number[][] = [];
  for (const part of [...parts].sort((a, b) => a.id - b.id)) {
    if (visited.has(part.id)) continue;
    const stack = [part.id];
    const members: number[] = [];
    visited.add(part.id);
    while (stack.length > 0) {
      const current = stack.pop() as number;
      members.push(current);
      for (const edge of adjacency.get(current) ?? []) {
        if (visited.has(edge.neighbor)) continue;
        visited.add(edge.neighbor);
        stack.push(edge.neighbor);
      }
    }
    members.sort((a, b) => a - b);
    rawComponents.push(members);
  }
  rawComponents.sort((a, b) => (a[0] ?? Infinity) - (b[0] ?? Infinity));

  const components: PowerComponent[] = [];
  const componentByPart = new Map<number, number>();
  rawComponents.forEach((partIds, index) => {
    const sourceIds: number[] = [];
    const machineIds: number[] = [];
    const gearPartIds: number[] = [];
    for (const partId of partIds) {
      componentByPart.set(partId, index);
      const part = partMap.get(partId);
      if (!part) continue;
      if (part.def.kind === 'power-source') sourceIds.push(partId);
      if (part.def.kind === 'machine') machineIds.push(partId);
      if (part.def.kind === 'gear') gearPartIds.push(partId);
    }
    let status: NetworkStatus;
    let reason: NetworkReason | null = null;
    if (gearPartIds.length > 0) {
      status = 'unsupported';
      reason = 'gear-requires-c';
    } else if (sourceIds.length === 0) {
      status = 'idle';
      reason = 'no-source';
    } else if (sourceIds.length > 1) {
      status = 'unsupported';
      reason = 'multiple-sources';
    } else {
      status = 'powered';
    }
    components.push({
      id: index,
      partIds,
      sourceIds,
      machineIds,
      gearPartIds,
      status,
      reason,
    });
  });

  return { revision, components, componentByPart, axialAdjacency: adjacency };
}

function withStatus(component: PowerComponent, status: NetworkStatus, reason: NetworkReason | null): PowerComponent {
  return { ...component, status, reason };
}

/**
 * 求解当前 source enabled 下的动力状态。
 * 只应在 topology 或 source enabled 变化时重新调用；不重建连接图。
 */
export function solvePower(
  topology: PowerTopology,
  parts: readonly MechanicalPart[],
  sourceEnabled: ReadonlySet<number>,
): PowerSolution {
  const partMap = new Map<number, MechanicalPart>();
  for (const part of parts) partMap.set(part.id, part);
  const omegaByPart = new Map<number, number>();
  const poweredMachines = new Set<number>();
  const components: PowerComponent[] = [];

  for (const component of topology.components) {
    let status = component.status;
    let reason = component.reason;

    if (status === 'unsupported') {
      components.push(component);
      continue;
    }
    if (component.sourceIds.length === 0) {
      components.push(withStatus(component, 'idle', 'no-source'));
      continue;
    }
    const sourceId = component.sourceIds[0] as number;
    if (!sourceEnabled.has(sourceId)) {
      components.push(withStatus(component, 'idle', null));
      continue;
    }

    status = 'powered';
    reason = null;
    components.push(withStatus(component, status, reason));

    const source = partMap.get(sourceId);
    if (!source) continue;
    const omegaSource = (sourceRpm(source) * TAU) / 60;
    omegaByPart.set(sourceId, omegaSource);

    const queue: number[] = [sourceId];
    const reached = new Set<number>([sourceId]);
    while (queue.length > 0) {
      const currentId = queue.shift() as number;
      const current = partMap.get(currentId);
      if (!current) continue;
      // 机器是动力终端：可以到达，但不继续向外传播。
      if (current.def.kind === 'machine') continue;
      const currentOmega = omegaByPart.get(currentId) ?? 0;
      for (const edge of topology.axialAdjacency.get(currentId) ?? []) {
        if (reached.has(edge.neighbor)) continue;
        const neighbor = partMap.get(edge.neighbor);
        if (!neighbor) continue;
        reached.add(edge.neighbor);
        const omega = currentOmega * edge.ratio;
        omegaByPart.set(edge.neighbor, omega);
        if (neighbor.def.kind === 'machine') poweredMachines.add(edge.neighbor);
        if (neighbor.def.kind !== 'machine') queue.push(edge.neighbor);
      }
    }
  }

  return { revision: topology.revision, components, omegaByPart, poweredMachines };
}