import type { Connection } from './ports.ts';
import type { MechanicalPart } from './parts.ts';

/**
 * M1.7-C 动力网络纯逻辑。
 *
 * 边界（已确认）：
 * - 动力沿 axial 与 gearMesh 连接传播；机器是终端，不穿过机器继续传播；
 * - 单动力源；组件内多源仍是 unsupported/multiple-sources；
 * - 只支持树状动力网络：任何闭环（无论传动比是否自洽）都标记
 *   unsupported/cyclic-network；闭环检测发生在负载解算之前，绝不挑一条 BFS 路径继续供能；
 * - 极简扭矩模型：无惯量、无摩擦、无动态负载；
 * - 速度下垂：ω = 额定 × (1 − 源侧需求 / 源容量)，源侧需求 ≥ 容量则整网过载停止；
 * - 局部支路：轴/齿轮上通过的扭矩超过其 maxTorque，只停这条支路的下游。
 */

export type NetworkStatus = 'idle' | 'powered' | 'unsupported' | 'stalled';
export type NetworkReason =
  | 'no-source'
  | 'multiple-sources'
  | 'cyclic-network'
  | 'source-overload'
  | 'branch-overload';

export interface DriveNeighbor {
  readonly neighbor: number;
  /** ω_neighbor / ω_current。 */
  readonly ratio: number;
  /** 连接 ID；用于区分"回到父节点的树边"和真正的非树边（闭环）。 */
  readonly id: string;
}

/** 旧名，保留给已有导入。 */
export type AxialNeighbor = DriveNeighbor;

export interface PowerComponent {
  readonly id: number;
  readonly partIds: readonly number[];
  readonly sourceIds: readonly number[];
  readonly machineIds: readonly number[];
  readonly gearPartIds: readonly number[];
  /** 结构状态；solvePower 根据源开关/负载细化为 idle/powered/stalled。 */
  readonly status: NetworkStatus;
  readonly reason: NetworkReason | null;
}

export interface PowerTopology {
  readonly revision: number;
  readonly components: readonly PowerComponent[];
  readonly componentByPart: ReadonlyMap<number, number>;
  /** axial 与 gearMesh 边的邻接表，ratio 按"当前 → 邻居"方向。 */
  readonly driveAdjacency: ReadonlyMap<number, readonly DriveNeighbor[]>;
}

export interface PowerSolution {
  readonly revision: number;
  readonly components: readonly PowerComponent[];
  /** 每零件相对自身有向轴的 ω；不存在的零件表示不转（无动力或已停转）。 */
  readonly omegaByPart: ReadonlyMap<number, number>;
  /** 每零件所在轴上的扭矩（N·m）。停转支路保留触发停转时的扭矩，便于显示超载。 */
  readonly torqueByPart: ReadonlyMap<number, number>;
  readonly speedFactorByComponent: ReadonlyMap<number, number>;
  /** 折算到动力源轴上的总需求扭矩。 */
  readonly demandByComponent: ReadonlyMap<number, number>;
  readonly capacityByComponent: ReadonlyMap<number, number>;
  readonly stalledParts: ReadonlySet<number>;
  readonly poweredMachines: ReadonlySet<number>;
}

const TAU = Math.PI * 2;

function ratedRpm(part: MechanicalPart): number {
  return part.def.ratedRpm ?? 60;
}

function loadOf(part: MechanicalPart | undefined): number {
  const load = part?.def.loadTorque;
  if (load === undefined || !Number.isFinite(load) || load <= 0) return 0;
  return load;
}

function capacityOf(part: MechanicalPart | undefined): number {
  const capacity = part?.def.maxTorque;
  if (capacity === undefined || !Number.isFinite(capacity)) return 0;
  return capacity;
}

/** 只有轴和齿轮承担"传动"，机器的 maxTorque 不再作为支路承载判据。 */
function isTransmission(part: MechanicalPart | undefined): boolean {
  return part !== undefined && (part.def.kind === 'shaft' || part.def.kind === 'gear');
}

/**
 * 结构层闭环检测：组件内沿 adjacency 做 BFS，遇到非树边即存在环。
 * 只看结构（含机器边），与动力源开关无关。
 */
function componentHasCycle(
  partIds: readonly number[],
  adjacency: ReadonlyMap<number, readonly DriveNeighbor[]>,
): boolean {
  const visited = new Set<number>();
  const parentEdge = new Map<number, string>();
  for (const start of partIds) {
    if (visited.has(start)) continue;
    visited.add(start);
    const queue = [start];
    let head = 0;
    while (head < queue.length) {
      const current = queue[head] as number;
      head += 1;
      for (const edge of adjacency.get(current) ?? []) {
        if (parentEdge.get(current) === edge.id) continue;
        if (visited.has(edge.neighbor)) return true;
        visited.add(edge.neighbor);
        parentEdge.set(edge.neighbor, edge.id);
        queue.push(edge.neighbor);
      }
    }
  }
  return false;
}

/**
 * 从 parts + connections 构建一次拓扑。只在 mechanical.revision 变化时调用。
 * 组件按 axial | gearMesh 边连通；闭环组件在结构层直接标记 unsupported/cyclic-network，
 * 多源组件保持 unsupported/multiple-sources。
 */
export function buildPowerTopology(
  parts: readonly MechanicalPart[],
  connections: readonly Connection[],
  revision: number,
): PowerTopology {
  const partMap = new Map<number, MechanicalPart>();
  for (const part of parts) partMap.set(part.id, part);

  const adjacency = new Map<number, DriveNeighbor[]>();
  for (const part of parts) adjacency.set(part.id, []);

  for (const connection of connections) {
    if (!partMap.has(connection.aPartId) || !partMap.has(connection.bPartId)) continue;
    const ratio = connection.ratio;
    if (!Number.isFinite(ratio) || ratio === 0) continue;
    adjacency.get(connection.aPartId)!.push({ neighbor: connection.bPartId, ratio, id: connection.id });
    adjacency.get(connection.bPartId)!.push({ neighbor: connection.aPartId, ratio: 1 / ratio, id: connection.id });
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
    if (componentHasCycle(partIds, adjacency)) {
      status = 'unsupported';
      reason = 'cyclic-network';
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

  return { revision, components, componentByPart, driveAdjacency: adjacency };
}

function withStatus(
  component: PowerComponent,
  status: NetworkStatus,
  reason: NetworkReason | null,
): PowerComponent {
  return { ...component, status, reason };
}

interface DriveTree {
  /** BFS 顺序；父节点一定排在子节点前面。 */
  readonly order: readonly number[];
  readonly children: ReadonlyMap<number, readonly { child: number; ratio: number }[]>;
  readonly relativeOmega: ReadonlyMap<number, number>;
  /** 图里存在非树边（闭环）时为 true；闭环一律整组件拒绝，不做扭矩分配。 */
  readonly cyclic: boolean;
}

function buildDriveTree(
  topology: PowerTopology,
  partMap: ReadonlyMap<number, MechanicalPart>,
  sourceId: number,
): DriveTree {
  const order: number[] = [];
  const children = new Map<number, { child: number; ratio: number }[]>();
  const relativeOmega = new Map<number, number>([[sourceId, 1]]);
  /** 每个节点把自己接入树的边 ID（用于跳过"回到父节点"的树边）。 */
  const parentEdge = new Map<number, string>();
  const queue: number[] = [sourceId];
  let head = 0;
  let cyclic = false;

  while (head < queue.length) {
    const current = queue[head] as number;
    head += 1;
    order.push(current);
    const part = partMap.get(current);
    if (!part) continue;
    // 机器是动力终端：可以到达，但不继续向外传播。
    if (part.def.kind === 'machine') continue;
    const currentOmega = relativeOmega.get(current) ?? 0;
    for (const edge of topology.driveAdjacency.get(current) ?? []) {
      if (!partMap.has(edge.neighbor)) continue;
      // 回到父节点的同一条连接是树边，不是闭环。
      if (parentEdge.get(current) === edge.id) continue;
      if (relativeOmega.has(edge.neighbor)) {
        // 非树边 = 闭环。即使传动比自洽也不解算扭矩：并联路径的负载分配尚未建模。
        cyclic = true;
        continue;
      }
      parentEdge.set(edge.neighbor, edge.id);
      const implied = currentOmega * edge.ratio;
      relativeOmega.set(edge.neighbor, implied);
      const list = children.get(current);
      if (list) list.push({ child: edge.neighbor, ratio: edge.ratio });
      else children.set(current, [{ child: edge.neighbor, ratio: edge.ratio }]);
      queue.push(edge.neighbor);
    }
  }

  return { order, children, relativeOmega, cyclic };
}

/**
 * 求解当前 source enabled 下的转速、扭矩与过载状态。
 * 只在 topology 或 source enabled 变化时重新调用；不重建连接图。
 */
export function solvePower(
  topology: PowerTopology,
  parts: readonly MechanicalPart[],
  sourceEnabled: ReadonlySet<number>,
): PowerSolution {
  const partMap = new Map<number, MechanicalPart>();
  for (const part of parts) partMap.set(part.id, part);

  const omegaByPart = new Map<number, number>();
  const torqueByPart = new Map<number, number>();
  const stalledParts = new Set<number>();
  const poweredMachines = new Set<number>();
  const speedFactorByComponent = new Map<number, number>();
  const demandByComponent = new Map<number, number>();
  const capacityByComponent = new Map<number, number>();
  const components: PowerComponent[] = [];

  for (const component of topology.components) {
    if (component.status === 'unsupported') {
      components.push(component);
      continue;
    }
    if (component.sourceIds.length === 0) {
      components.push(withStatus(component, 'idle', 'no-source'));
      continue;
    }
    const sourceId = component.sourceIds[0] as number;
    const source = partMap.get(sourceId);
    if (!source) {
      components.push(withStatus(component, 'unsupported', 'no-source'));
      continue;
    }
    if (!sourceEnabled.has(sourceId)) {
      components.push(withStatus(component, 'idle', null));
      continue;
    }

    const tree = buildDriveTree(topology, partMap, sourceId);
    if (tree.cyclic) {
      // 闭环：在任何扭矩聚合之前拒绝，避免用一条 BFS 路径伪造并联负载分配。
      components.push(withStatus(component, 'unsupported', 'cyclic-network'));
      continue;
    }

    const order = tree.order;
    const capacity = capacityOf(source);
    const ratedOmega = (ratedRpm(source) * TAU) / 60;

    const stalled = new Set<number>();
    const stallTorque = new Map<number, number>();
    let overload: NetworkReason | null = null;
    /** 触发整网过载时的源侧需求；停转后不能再拿清零后的需求上报。 */
    let overloadDemand: number | null = null;

    // 子节点深度一定大于父节点，所以逆 BFS 序就是合法后序。
    const computeDemand = (): Map<number, number> => {
      const demand = new Map<number, number>();
      for (let index = order.length - 1; index >= 0; index -= 1) {
        const id = order[index] as number;
        if (stalled.has(id)) {
          demand.set(id, 0);
          continue;
        }
        let value = loadOf(partMap.get(id));
        for (const child of tree.children.get(id) ?? []) {
          if (stalled.has(child.child)) continue;
          value += (demand.get(child.child) ?? 0) * Math.abs(child.ratio);
        }
        demand.set(id, value);
      }
      return demand;
    };

    const stallSubtree = (root: number, current: ReadonlyMap<number, number>): void => {
      const stack = [root];
      while (stack.length > 0) {
        const id = stack.pop() as number;
        if (stalled.has(id)) continue;
        stalled.add(id);
        stallTorque.set(id, current.get(id) ?? 0);
        for (const child of tree.children.get(id) ?? []) stack.push(child.child);
      }
    };

    let demand = computeDemand();
    for (let guard = 0; guard <= order.length + 1; guard += 1) {
      demand = computeDemand();
      const sourceDemand = demand.get(sourceId) ?? 0;
      if (capacity > 0 ? sourceDemand >= capacity : sourceDemand > 0) {
        // 总负载压到动力源上限：整个网络停止。
        overload = 'source-overload';
        overloadDemand = sourceDemand;
        stallSubtree(sourceId, demand);
        demand = computeDemand();
        break;
      }
      // 找最深的超载传动件；只停它下游的支路。
      let offender: number | undefined;
      for (let index = order.length - 1; index >= 0; index -= 1) {
        const id = order[index] as number;
        if (id === sourceId || stalled.has(id)) continue;
        const part = partMap.get(id);
        if (!isTransmission(part)) continue;
        if ((demand.get(id) ?? 0) > capacityOf(part)) {
          offender = id;
          break;
        }
      }
      if (offender === undefined) break;
      overload = 'branch-overload';
      stallSubtree(offender, demand);
    }

    const sourceDemand = overload === 'source-overload'
      ? (overloadDemand ?? 0)
      : (demand.get(sourceId) ?? 0);
    const factor = overload === 'source-overload'
      ? 0
      : capacity > 0
        ? Math.min(1, Math.max(0, 1 - sourceDemand / capacity))
        : 0;
    speedFactorByComponent.set(component.id, factor);
    demandByComponent.set(component.id, sourceDemand);
    capacityByComponent.set(component.id, capacity);

    let runningMachines = 0;
    for (const id of order) {
      const part = partMap.get(id);
      if (!part) continue;
      if (stalled.has(id)) {
        stalledParts.add(id);
        torqueByPart.set(id, stallTorque.get(id) ?? 0);
        continue;
      }
      torqueByPart.set(id, demand.get(id) ?? 0);
      omegaByPart.set(id, ratedOmega * factor * (tree.relativeOmega.get(id) ?? 0));
      if (part.def.kind === 'machine') {
        poweredMachines.add(id);
        runningMachines += 1;
      }
    }

    let status: NetworkStatus = 'powered';
    let reason: NetworkReason | null = null;
    if (overload === 'source-overload') {
      status = 'stalled';
      reason = 'source-overload';
    } else if (overload === 'branch-overload' && component.machineIds.length > 0 && runningMachines === 0) {
      // 所有机器都在被停掉的支路上：整个网络对玩家表现为"停转"。
      status = 'stalled';
      reason = 'branch-overload';
    }
    components.push(withStatus(component, status, reason));
  }

  return {
    revision: topology.revision,
    components,
    omegaByPart,
    torqueByPart,
    speedFactorByComponent,
    demandByComponent,
    capacityByComponent,
    stalledParts,
    poweredMachines,
  };
}
