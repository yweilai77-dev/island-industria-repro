import { cellsOf, type Cell, type Placement, type Rotation } from '../grid/grid.ts';
import { isProductionMachine, type MechanicalPart } from '../mechanical/parts.ts';
import { levelBaseY } from '../spatial/space.ts';
import { INDUSTRIAL_CATALOG } from './catalog.ts';
import {
  STRUCTURE_MODULES,
  structureModuleForPart,
  type StructureModuleDef,
  type StructureNodeKind,
} from './assembly-module.ts';
import { makeAssemblyId, type AssemblyId, type CoreId, type StructureModuleId } from './ids.ts';
import type { Assembly } from './runtime-model.ts';

/**
 * M2.0-P2-D 组合机械（Assembly）的运行时（纯逻辑、零引擎依赖、可序列化）。
 *
 * 设计边界（任务书 §2.3）：
 * - 组合机械**只**管理：成员表、成员间结构关系、相对位置/朝向、整体边界、建立与解除；
 * - **不**创建成员核心的替代 ID，**不**接管加工/缓冲/接口/物流/动力 —— 那些仍归各自系统；
 * - 组合关系不是 UI 虚拟分组：成员关系**只**由世界中的真实结构模块与真实核心相邻关系推导。
 *
 * 组合的定义（P2-D 最小规则）：
 * - 节点 = 世界中的加工核心 + 结构模块；
 * - 结构边 = 「同层正交相邻」且至少一端是结构模块（核心与核心直接相邻不构成结构关系）；
 * - 连通的、包含 ≥2 台加工核心的组件 = 一个组合机械；
 * - 结构模块可以串联，因此 1 格模块也能连接直线、转角等拓扑。
 *
 * 身份与稳定性：每个 Assembly 分配 `assembly:<n>`；重新推导时，只要组件与既有 Assembly
 * 有任意成员/模块重叠，就沿用旧 ID（合并时保留较小 ID），组件消失则解除；ID 不复用。
 */

export type StructureEdgeKind = 'core-module' | 'module-module';

export interface StructureNode {
  readonly partId: number;
  readonly kind: StructureNodeKind;
  readonly placement: Placement;
  /** 加工核心 ID；结构模块为 null。 */
  readonly coreId: CoreId | null;
  /** 结构模块 ID；加工核心为 null。 */
  readonly moduleId: StructureModuleId | null;
}

export interface StructureEdge {
  readonly aPartId: number;
  readonly bPartId: number;
  readonly kind: StructureEdgeKind;
}

export interface StructureGraph {
  readonly nodes: readonly StructureNode[];
  readonly byPartId: ReadonlyMap<number, StructureNode>;
  readonly edges: readonly StructureEdge[];
  readonly neighborIds: ReadonlyMap<number, readonly number[]>;
}

export interface PlacementSnapshot {
  readonly gx: number;
  readonly gz: number;
  readonly level: number;
  readonly w: number;
  readonly d: number;
  readonly rotation: Rotation;
}

export interface AssemblyMemberSnapshot {
  readonly partId: number;
  readonly coreId: CoreId;
  readonly ratedLoadTorque: number;
  readonly placement: PlacementSnapshot;
  /** 相对组合参考成员的位置（格）与方向（度）；参考成员是成员中 partId 最小者。 */
  readonly relative: { readonly gx: number; readonly gz: number; readonly rotation: number };
}

export interface AssemblyModuleSnapshot {
  readonly partId: number;
  readonly moduleId: StructureModuleId;
  readonly placement: PlacementSnapshot;
  readonly relative: { readonly gx: number; readonly gz: number; readonly rotation: number };
}

export interface AssemblyBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface AssemblySnapshot extends Assembly {
  readonly id: AssemblyId;
  readonly level: number;
  /** 成员加工核心（= MechanicalPart.id，独立身份不变）。 */
  readonly memberIds: readonly number[];
  /** 结构模块（同样复用 MechanicalPart.id）。 */
  readonly moduleIds: readonly number[];
  readonly referenceMemberId: number;
  readonly links: readonly StructureEdge[];
  readonly members: readonly AssemblyMemberSnapshot[];
  readonly modules: readonly AssemblyModuleSnapshot[];
  readonly bounds: AssemblyBounds;
  /** 成员额定动力需求之和（查询用，不改变动力网络求解）。 */
  readonly powerDemandTorque: number;
}

export type AssemblyIssue =
  | 'unknown-member'
  | 'duplicate-member'
  | 'member-not-core'
  | 'member-in-other-assembly'
  | 'too-few-members'
  | 'mixed-level'
  | 'unknown-module'
  | 'module-not-structure'
  | 'disconnected'
  | 'invalid-structure-link';

const CELL_NEIGHBORS: readonly (readonly [number, number])[] = Object.freeze([
  Object.freeze([1, 0]) as readonly [number, number],
  Object.freeze([-1, 0]) as readonly [number, number],
  Object.freeze([0, 1]) as readonly [number, number],
  Object.freeze([0, -1]) as readonly [number, number],
]);

const STRUCTURE_MODULE_BY_ID: ReadonlyMap<StructureModuleId, StructureModuleDef> = new Map(
  STRUCTURE_MODULES.map((module) => [module.id, module]),
);

function nodeKindOf(part: MechanicalPart): StructureNodeKind | undefined {
  if (isProductionMachine(part.def)) return 'core';
  if (structureModuleForPart(part.def.id)) return 'module';
  return undefined;
}

function placementSnapshot(placement: Placement): PlacementSnapshot {
  return {
    gx: placement.gx,
    gz: placement.gz,
    level: placement.level,
    w: placement.w,
    d: placement.d,
    rotation: placement.rotation,
  };
}

/** 把真实机械零件投影成结构节点；轴/齿轮/动力源/溜槽/冲压机返回 undefined。 */
export function structureNodeOf(part: MechanicalPart): StructureNode | undefined {
  const kind = nodeKindOf(part);
  if (!kind) return undefined;
  const core = kind === 'core' ? INDUSTRIAL_CATALOG.coreByPartId.get(part.def.id) : undefined;
  const module = kind === 'module' ? structureModuleForPart(part.def.id) : undefined;
  return {
    partId: part.id,
    kind,
    placement: placementSnapshot(part.placement),
    coreId: core?.id ?? null,
    moduleId: module?.id ?? null,
  };
}

function cellKey(level: number, cell: Cell): string {
  return `${level},${cell.gx},${cell.gz}`;
}

/**
 * 从真实零件推导结构图。
 * 结构边只在「至少一端是结构模块」的正交相邻时成立；核心与核心直接相邻不构成结构关系。
 */
export function buildStructureGraph(parts: readonly MechanicalPart[]): StructureGraph {
  const nodes: StructureNode[] = [];
  const byPartId = new Map<number, StructureNode>();
  for (const part of parts) {
    const node = structureNodeOf(part);
    if (!node) continue;
    nodes.push(node);
    byPartId.set(node.partId, node);
  }
  const cellsByPart = new Map<number, readonly Cell[]>();
  const partsByCell = new Map<string, number[]>();
  for (const node of nodes) {
    const cells = cellsOf(node.placement);
    cellsByPart.set(node.partId, cells);
    for (const cell of cells) {
      const key = cellKey(node.placement.level, cell);
      const list = partsByCell.get(key);
      if (list) list.push(node.partId); else partsByCell.set(key, [node.partId]);
    }
  }
  const seen = new Set<string>();
  const edges: StructureEdge[] = [];
  for (const node of nodes) {
    for (const cell of cellsByPart.get(node.partId) ?? []) {
      for (const [dx, dz] of CELL_NEIGHBORS) {
        const neighbors = partsByCell.get(cellKey(node.placement.level, { gx: cell.gx + dx, gz: cell.gz + dz }));
        if (!neighbors) continue;
        for (const otherId of neighbors) {
          if (otherId === node.partId) continue;
          const other = byPartId.get(otherId);
          if (!other) continue;
          // 核心↔核心直接相邻不是结构连接：组合必须由结构模块建立。
          if (node.kind === 'core' && other.kind === 'core') continue;
          const a = Math.min(node.partId, otherId);
          const b = Math.max(node.partId, otherId);
          const key = `${a}:${b}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push({
            aPartId: a,
            bPartId: b,
            kind: node.kind === 'module' && other.kind === 'module' ? 'module-module' : 'core-module',
          });
        }
      }
    }
  }
  edges.sort((left, right) => left.aPartId - right.aPartId || left.bPartId - right.bPartId);
  const neighbors = new Map<number, number[]>();
  for (const node of nodes) neighbors.set(node.partId, []);
  for (const edge of edges) {
    (neighbors.get(edge.aPartId) as number[]).push(edge.bPartId);
    (neighbors.get(edge.bPartId) as number[]).push(edge.aPartId);
  }
  for (const list of neighbors.values()) list.sort((left, right) => left - right);
  return {
    nodes: Object.freeze(nodes),
    byPartId,
    edges: Object.freeze(edges),
    neighborIds: neighbors,
  };
}

/** 结构图的连通组件（按最小 partId 排序，便于确定性推导）。 */
export function connectedComponents(graph: StructureGraph): readonly (readonly StructureNode[])[] {
  const visited = new Set<number>();
  const components: StructureNode[][] = [];
  for (const node of graph.nodes) {
    if (visited.has(node.partId)) continue;
    const stack = [node.partId];
    visited.add(node.partId);
    const component: StructureNode[] = [];
    while (stack.length > 0) {
      const current = stack.pop() as number;
      const info = graph.byPartId.get(current);
      if (!info) continue;
      component.push(info);
      for (const neighbor of graph.neighborIds.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }
    component.sort((left, right) => left.partId - right.partId);
    components.push(component);
  }
  components.sort((left, right) => (left[0]?.partId ?? 0) - (right[0]?.partId ?? 0));
  return components;
}

function nodeHeight(node: StructureNode): number {
  if (node.kind === 'core') {
    return node.coreId ? (INDUSTRIAL_CATALOG.coreById.get(node.coreId)?.height ?? 1) : 1;
  }
  return node.moduleId ? (STRUCTURE_MODULE_BY_ID.get(node.moduleId)?.height ?? 1) : 1;
}

function boundsOf(nodes: readonly StructureNode[]): AssemblyBounds {
  let minGx = Number.POSITIVE_INFINITY;
  let minGz = Number.POSITIVE_INFINITY;
  let maxGx = Number.NEGATIVE_INFINITY;
  let maxGz = Number.NEGATIVE_INFINITY;
  let maxHeight = 0;
  const level = nodes[0]?.placement.level ?? 0;
  for (const node of nodes) {
    maxHeight = Math.max(maxHeight, nodeHeight(node));
    for (const cell of cellsOf(node.placement)) {
      minGx = Math.min(minGx, cell.gx);
      minGz = Math.min(minGz, cell.gz);
      maxGx = Math.max(maxGx, cell.gx);
      maxGz = Math.max(maxGz, cell.gz);
    }
  }
  const baseY = levelBaseY(level);
  return {
    min: [minGx, baseY, minGz],
    max: [maxGx + 1, baseY + maxHeight, maxGz + 1],
  };
}

function relativeOf(node: StructureNode, reference: StructureNode): AssemblyMemberSnapshot['relative'] {
  return {
    gx: node.placement.gx - reference.placement.gx,
    gz: node.placement.gz - reference.placement.gz,
    rotation: (((node.placement.rotation - reference.placement.rotation) % 360) + 360) % 360,
  };
}

/** 一个组件（含 ≥2 台核心）对应的组合机械快照（ID 由调用方分配）。 */
function candidateOf(component: readonly StructureNode[], graph: StructureGraph): AssemblySnapshot | undefined {
  const memberNodes = component.filter((node) => node.kind === 'core');
  if (memberNodes.length < 2) return undefined;
  const moduleNodes = component.filter((node) => node.kind === 'module');
  const ids = new Set(component.map((node) => node.partId));
  const links = graph.edges.filter((edge) => ids.has(edge.aPartId) && ids.has(edge.bPartId));
  const reference = memberNodes.reduce(
    (low, node) => (node.partId < low.partId ? node : low),
    memberNodes[0] as StructureNode,
  );
  const members: AssemblyMemberSnapshot[] = memberNodes.map((node) => ({
    partId: node.partId,
    coreId: node.coreId as CoreId,
    ratedLoadTorque: node.coreId ? (INDUSTRIAL_CATALOG.coreById.get(node.coreId)?.ratedLoadTorque ?? 0) : 0,
    placement: node.placement,
    relative: relativeOf(node, reference),
  }));
  const modules: AssemblyModuleSnapshot[] = moduleNodes.map((node) => ({
    partId: node.partId,
    moduleId: node.moduleId as StructureModuleId,
    placement: node.placement,
    relative: relativeOf(node, reference),
  }));
  return {
    id: makeAssemblyId(0),
    level: reference.placement.level,
    memberIds: Object.freeze(members.map((member) => member.partId)),
    moduleIds: Object.freeze(modules.map((module) => module.partId)),
    referenceMemberId: reference.partId,
    links: Object.freeze(links),
    members: Object.freeze(members),
    modules: Object.freeze(modules),
    bounds: boundsOf(component),
    powerDemandTorque: members.reduce((total, member) => total + member.ratedLoadTorque, 0),
  };
}

function serialOf(id: AssemblyId): number {
  const value = Number(id.slice('assembly:'.length));
  return Number.isInteger(value) ? value : 0;
}

function signatureOf(assembly: AssemblySnapshot): string {
  return [
    assembly.id,
    assembly.memberIds.join(','),
    assembly.moduleIds.join(','),
    assembly.links.map((edge) => `${edge.aPartId}-${edge.bPartId}`).join(','),
  ].join('|');
}

/**
 * 组合机械运行时：每帧从真实零件重新推导，并保留稳定的 Assembly ID。
 * 不持有任何成员核心的加工/动力/物流状态。
 */
export class AssemblyRuntime {
  private readonly byId = new Map<AssemblyId, AssemblySnapshot>();
  private serial = 0;
  private stateRevision = 0;

  get revision(): number {
    return this.stateRevision;
  }

  /** 从真实零件重新推导组合关系；无变化的组件不会改变 ID。 */
  reconcile(parts: readonly MechanicalPart[]): void {
    const graph = buildStructureGraph(parts);
    const candidates: AssemblySnapshot[] = [];
    for (const component of connectedComponents(graph)) {
      const candidate = candidateOf(component, graph);
      if (candidate) candidates.push(candidate);
    }
    candidates.sort((left, right) => (left.memberIds[0] as number) - (right.memberIds[0] as number)
      || (left.moduleIds[0] ?? 0) - (right.moduleIds[0] ?? 0));

    const old = [...this.byId.values()];
    const claimed = new Set<AssemblyId>();
    const next = new Map<AssemblyId, AssemblySnapshot>();
    for (const candidate of candidates) {
      const ids = new Set([...candidate.memberIds, ...candidate.moduleIds]);
      const overlaps = old.filter((assembly) => !claimed.has(assembly.id)
        && [...assembly.memberIds, ...assembly.moduleIds].some((partId) => ids.has(partId)));
      let id: AssemblyId;
      if (overlaps.length > 0) {
        // 合并两个既有组合时保留“最早创建”的 ID（serial 最小），其余解除。
        const ordered = [...overlaps].sort((left, right) => serialOf(left.id) - serialOf(right.id));
        id = (ordered[0] as AssemblySnapshot).id;
        for (const overlap of ordered) claimed.add(overlap.id);
      } else {
        this.serial += 1;
        id = makeAssemblyId(this.serial);
      }
      next.set(id, { ...candidate, id });
    }
    const before = [...this.byId.values()].map(signatureOf).sort().join(';');
    const after = [...next.values()].map(signatureOf).sort().join(';');
    this.byId.clear();
    for (const [id, assembly] of next) this.byId.set(id, assembly);
    if (before !== after) this.stateRevision += 1;
  }

  /** 全部组合机械（按 ID 稳定排序）。 */
  snapshot(): readonly AssemblySnapshot[] {
    return [...this.byId.values()].sort((left, right) => serialOf(left.id) - serialOf(right.id));
  }

  /** 某零件（核心或结构模块）所属的组合机械。 */
  assemblyOf(partId: number): AssemblySnapshot | undefined {
    return this.snapshot().find((assembly) => assembly.memberIds.includes(partId)
      || assembly.moduleIds.includes(partId));
  }

  /** 某零件（核心或结构模块）所属组合的 ID（判断「是否已属于某个组合」）。 */
  assemblyIdOf(partId: number): AssemblyId | undefined {
    return this.assemblyOf(partId)?.id;
  }

  /** 某零件是否属于任意组合机械。 */
  contains(partId: number): boolean {
    return this.assemblyOf(partId) !== undefined;
  }

  clear(): void {
    this.byId.clear();
    this.serial = 0;
    this.stateRevision = 0;
  }
}

/**
 * 校验一个组合机械快照是否合法（测试与数据自检用；运行时按图推导天然满足大部分约束）。
 * `others` 用于检查「一个核心不能同时加入两个独立组合」。
 */
export function validateAssembly(
  assembly: AssemblySnapshot,
  parts: readonly MechanicalPart[],
  others: readonly AssemblySnapshot[] = [],
): readonly AssemblyIssue[] {
  const issues: AssemblyIssue[] = [];
  const push = (issue: AssemblyIssue): void => { issues.push(issue); };
  const partsById = new Map(parts.map((part) => [part.id, part]));
  if (assembly.memberIds.length < 2) push('too-few-members');
  if (new Set(assembly.memberIds).size !== assembly.memberIds.length) push('duplicate-member');
  const inOthers = new Set(others.flatMap((other) => (other.id === assembly.id ? [] : [...other.memberIds])));
  for (const memberId of assembly.memberIds) {
    if (inOthers.has(memberId)) push('member-in-other-assembly');
    const part = partsById.get(memberId);
    if (!part) { push('unknown-member'); continue; }
    if (!isProductionMachine(part.def)) push('member-not-core');
    if (part.placement.level !== assembly.level) push('mixed-level');
  }
  for (const moduleId of assembly.moduleIds) {
    const part = partsById.get(moduleId);
    if (!part) { push('unknown-module'); continue; }
    if (!structureModuleForPart(part.def.id)) push('module-not-structure');
    if (part.placement.level !== assembly.level) push('mixed-level');
  }
  const nodeIds = new Set([...assembly.memberIds, ...assembly.moduleIds]);
  for (const edge of assembly.links) {
    if (!nodeIds.has(edge.aPartId) || !nodeIds.has(edge.bPartId)) push('invalid-structure-link');
  }
  const adjacency = new Map<number, number[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const edge of assembly.links) {
    (adjacency.get(edge.aPartId) as number[] | undefined)?.push(edge.bPartId);
    (adjacency.get(edge.bPartId) as number[] | undefined)?.push(edge.aPartId);
  }
  const start = assembly.memberIds[0];
  if (start !== undefined) {
    const visited = new Set<number>([start]);
    const stack = [start];
    while (stack.length > 0) {
      const current = stack.pop() as number;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }
    if (visited.size !== nodeIds.size) push('disconnected');
  }
  return Object.freeze(issues);
}

/** 结构模块放置前的结构检查：必须与同层的核心或结构模块正交相邻。 */
export function structurePlacementIssue(
  placement: Placement,
  module: StructureModuleDef,
  parts: readonly MechanicalPart[],
): 'not-adjacent' | null {
  const candidateCells = cellsOf({ ...placement, w: module.footprint.w, d: module.footprint.d });
  for (const part of parts) {
    if (!nodeKindOf(part)) continue;
    if (part.placement.level !== placement.level) continue;
    for (const cell of cellsOf(part.placement)) {
      for (const [dx, dz] of CELL_NEIGHBORS) {
        const gx = cell.gx + dx;
        const gz = cell.gz + dz;
        if (candidateCells.some((candidate) => candidate.gx === gx && candidate.gz === gz)) return null;
      }
    }
  }
  return 'not-adjacent';
}
