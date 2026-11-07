import type { Connection } from './ports.ts';
import type { MechanicalPart } from './parts.ts';
import {
  buildPowerTopology,
  solvePower,
  type NetworkReason,
  type NetworkStatus,
  type PowerComponent,
  type PowerSolution,
  type PowerTopology,
} from './power.ts';
import { machinePose, type MachinePose } from './machine.ts';

/** 只读读投影；纯 JSON，不含 EntityHandle 或 Registry 引用。 */
export interface MechanicalSnapshot {
  readonly revision: number;
  readonly sources: readonly {
    readonly partId: number;
    readonly enabled: boolean;
    readonly ratedRpm: number;
  }[];
  readonly networks: readonly {
    readonly id: number;
    readonly status: NetworkStatus;
    readonly reason: NetworkReason | null;
    readonly sourceIds: readonly number[];
    readonly machineIds: readonly number[];
    readonly partIds: readonly number[];
    /** 被局部/整体过载停转的零件。 */
    readonly stalledPartIds: readonly number[];
    /** 1 = 额定转速；0 = 停转。 */
    readonly speedFactor: number;
    /** 折算到动力源轴上的总需求扭矩（N·m）。 */
    readonly demandTorque: number;
    /** 动力源承载能力（N·m）。 */
    readonly capacityTorque: number;
  }[];
  readonly parts: readonly {
    readonly partId: number;
    readonly kind: string;
    readonly componentId: number | null;
    /** 真实放置信息，供外部验收脚本核对落格。 */
    readonly placement: {
      readonly gx: number;
      readonly gz: number;
      readonly level: number;
      readonly rotation: number;
    };
    readonly omega: number;
    readonly rpm: number;
    readonly angle: number;
    readonly powered: boolean;
    readonly torque: number;
    readonly stalled: boolean;
  }[];
  readonly machines: readonly {
    readonly partId: number;
    readonly powered: boolean;
    readonly stalled: boolean;
    readonly omega: number;
    readonly rpm: number;
    readonly angle: number;
    readonly ramY: number;
    readonly rodAngle: number;
    readonly loadTorque: number;
  }[];
}

/**
 * 右键启停目标：优先悬停的动力源；悬停的不是动力源时，退回选中的动力源。
 * 返回 undefined 表示当前不应启停任何东西。
 */
export function sourceToggleTarget(
  parts: readonly MechanicalPart[],
  hoveredPartId: number | undefined,
  selectedPartId: number | undefined,
): number | undefined {
  const hovered = hoveredPartId === undefined ? undefined : parts.find((part) => part.id === hoveredPartId);
  if (hovered?.def.kind === 'power-source') return hovered.id;
  const selected = selectedPartId === undefined ? undefined : parts.find((part) => part.id === selectedPartId);
  return selected?.def.kind === 'power-source' ? selected.id : undefined;
}

function rpmOf(part: MechanicalPart): number {
  return part.def.ratedRpm ?? 60;
}

const TAU = Math.PI * 2;

/** 角速度（rad/s）→ 每分钟转数。 */
function toRpm(omega: number): number {
  return (omega * 60) / TAU;
}

function loadOf(part: MechanicalPart): number {
  return part.def.loadTorque ?? 0;
}

/**
 * M1.7-B 运行时状态：
 * - source enabled 是唯一逻辑持久状态；
 * - topology 只在 revision 变化时重建；
 * - source 开关只使 solution 变脏；
 * - angle / machine pose 是从 ω 推导的视觉运行状态；
 * - snapshot 是纯 JSON 读投影。
 */
export class MechanicalRuntimeState {
  private revision = -1;
  private parts: readonly MechanicalPart[] = [];
  private partMap = new Map<number, MechanicalPart>();
  private connections: readonly Connection[] = [];
  private topologyCache: PowerTopology | null = null;
  private solutionCache: PowerSolution | null = null;
  private sourceEnabled = new Map<number, boolean>();
  private angles = new Map<number, number>();
  private machinePoses = new Map<number, MachinePose>();
  private solutionDirty = true;
  private topologyBuilds = 0;

  sync(revision: number, parts: readonly MechanicalPart[], connections: readonly Connection[]): void {
    const topologyChanged = revision !== this.revision;
    this.revision = revision;
    this.parts = [...parts];
    this.connections = [...connections];
    this.partMap = new Map(parts.map((part) => [part.id, part]));
    if (!topologyChanged) return;

    this.topologyCache = buildPowerTopology(this.parts, this.connections, revision);
    this.topologyBuilds += 1;

    const sourceIds = new Set(
      this.parts.filter((part) => part.def.kind === 'power-source').map((part) => part.id),
    );
    for (const partId of [...this.sourceEnabled.keys()]) {
      if (!sourceIds.has(partId)) this.sourceEnabled.delete(partId);
    }
    for (const partId of [...this.angles.keys()]) {
      if (!this.partMap.has(partId)) this.angles.delete(partId);
    }
    for (const partId of [...this.machinePoses.keys()]) {
      if (!this.partMap.has(partId)) this.machinePoses.delete(partId);
    }
    this.solutionDirty = true;
  }

  get topology(): PowerTopology | null {
    return this.topologyCache;
  }

  get topologyBuildCount(): number {
    return this.topologyBuilds;
  }

  get currentRevision(): number {
    return this.revision;
  }

  isSourceEnabled(partId: number): boolean {
    return this.sourceEnabled.get(partId) === true;
  }

  setSourceEnabled(partId: number, enabled: boolean): boolean {
    const part = this.partMap.get(partId);
    if (!part || part.def.kind !== 'power-source') return false;
    if (this.isSourceEnabled(partId) === enabled) return false;
    this.sourceEnabled.set(partId, enabled);
    this.solutionDirty = true;
    return true;
  }

  toggleSource(partId: number): boolean {
    return this.setSourceEnabled(partId, !this.isSourceEnabled(partId));
  }

  angleOf(partId: number): number {
    return this.angles.get(partId) ?? 0;
  }

  poseOf(partId: number): MachinePose {
    return this.machinePoses.get(partId) ?? machinePose(this.angleOf(partId));
  }

  /** 取得（必要时解算）当前动力解；没有拓扑时返回 null。 */
  private ensureSolution(): PowerSolution | null {
    if (!this.topologyCache) return null;
    if (this.solutionDirty || !this.solutionCache) {
      const enabled = new Set<number>();
      for (const [partId, value] of this.sourceEnabled) if (value) enabled.add(partId);
      this.solutionCache = solvePower(this.topologyCache, this.parts, enabled);
      this.solutionDirty = false;
    }
    return this.solutionCache;
  }

  /** 零件所在动力网络（已解算状态）；未参与网络时 undefined。 */
  componentOf(partId: number): PowerComponent | undefined {
    const topology = this.topologyCache;
    const solution = this.ensureSolution();
    if (!topology || !solution) return undefined;
    const index = topology.componentByPart.get(partId);
    if (index === undefined) return undefined;
    return solution.components[index];
  }

  omegaOf(partId: number): number {
    return this.ensureSolution()?.omegaByPart.get(partId) ?? 0;
  }

  torqueOf(partId: number): number {
    return this.ensureSolution()?.torqueByPart.get(partId) ?? 0;
  }

  isStalled(partId: number): boolean {
    return this.ensureSolution()?.stalledParts.has(partId) ?? false;
  }

  speedFactorOf(partId: number): number {
    const component = this.componentOf(partId);
    if (!component) return 0;
    return this.ensureSolution()?.speedFactorByComponent.get(component.id) ?? 0;
  }

  step(deltaSeconds: number): void {
    const solution = this.ensureSolution();
    if (!solution) return;
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, 0.1)) : 0;

    for (const part of this.parts) {
      const omega = solution.omegaByPart.get(part.id) ?? 0;
      const angle = this.angleOf(part.id) + omega * dt;
      this.angles.set(part.id, angle);
      if (part.def.kind === 'machine') this.machinePoses.set(part.id, machinePose(angle));
    }
  }

  snapshot(): MechanicalSnapshot {
    const topology = this.topologyCache;
    const solution = this.ensureSolution();
    if (!topology || !solution) {
      return {
        revision: this.revision < 0 ? 0 : this.revision,
        sources: [],
        networks: [],
        parts: [],
        machines: [],
      };
    }

    const sources = this.parts
      .filter((part) => part.def.kind === 'power-source')
      .map((part) => ({ partId: part.id, enabled: this.isSourceEnabled(part.id), ratedRpm: rpmOf(part) }))
      .sort((a, b) => a.partId - b.partId);

    const networks = solution.components.map((component) => ({
      id: component.id,
      status: component.status,
      reason: component.reason,
      sourceIds: [...component.sourceIds],
      machineIds: [...component.machineIds],
      partIds: [...component.partIds],
      stalledPartIds: component.partIds.filter((partId) => solution.stalledParts.has(partId)),
      speedFactor: solution.speedFactorByComponent.get(component.id) ?? 0,
      demandTorque: solution.demandByComponent.get(component.id) ?? 0,
      capacityTorque: solution.capacityByComponent.get(component.id) ?? 0,
    }));

    const parts = [...this.parts]
      .sort((a, b) => a.id - b.id)
      .map((part) => {
        const omega = solution.omegaByPart.get(part.id) ?? 0;
        return {
          partId: part.id,
          kind: part.def.kind,
          componentId: topology.componentByPart.get(part.id) ?? null,
          placement: {
            gx: part.placement.gx,
            gz: part.placement.gz,
            level: part.placement.level,
            rotation: part.placement.rotation,
          },
          omega,
          rpm: toRpm(omega),
          angle: this.angleOf(part.id),
          powered: solution.omegaByPart.has(part.id),
          torque: solution.torqueByPart.get(part.id) ?? 0,
          stalled: solution.stalledParts.has(part.id),
        };
      });

    const machines = this.parts
      .filter((part) => part.def.kind === 'machine')
      .sort((a, b) => a.id - b.id)
      .map((part) => {
        const pose = this.poseOf(part.id);
        const omega = solution.omegaByPart.get(part.id) ?? 0;
        return {
          partId: part.id,
          powered: solution.poweredMachines.has(part.id),
          stalled: solution.stalledParts.has(part.id),
          omega,
          rpm: toRpm(omega),
          angle: this.angleOf(part.id),
          ramY: pose.ramY,
          rodAngle: pose.rodAngle,
          loadTorque: loadOf(part),
        };
      });

    return { revision: topology.revision, sources, networks, parts, machines };
  }

  clear(): void {
    this.revision = -1;
    this.parts = [];
    this.partMap.clear();
    this.connections = [];
    this.topologyCache = null;
    this.solutionCache = null;
    this.sourceEnabled.clear();
    this.angles.clear();
    this.machinePoses.clear();
    this.solutionDirty = true;
    this.topologyBuilds = 0;
  }
}