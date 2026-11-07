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
  }[];
  readonly parts: readonly {
    readonly partId: number;
    readonly kind: string;
    readonly componentId: number | null;
    readonly omega: number;
    readonly angle: number;
    readonly powered: boolean;
  }[];
  readonly machines: readonly {
    readonly partId: number;
    readonly powered: boolean;
    readonly omega: number;
    readonly angle: number;
    readonly ramY: number;
    readonly rodAngle: number;
  }[];
}

function rpmOf(part: MechanicalPart): number {
  return part.def.ratedRpm ?? 60;
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

  step(deltaSeconds: number): void {
    if (!this.topologyCache) return;
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, 0.1)) : 0;
    if (this.solutionDirty || !this.solutionCache) {
      const enabled = new Set<number>();
      for (const [partId, value] of this.sourceEnabled) if (value) enabled.add(partId);
      this.solutionCache = solvePower(this.topologyCache, this.parts, enabled);
      this.solutionDirty = false;
    }

    for (const part of this.parts) {
      const omega = this.solutionCache.omegaByPart.get(part.id) ?? 0;
      const angle = this.angleOf(part.id) + omega * dt;
      this.angles.set(part.id, angle);
      if (part.def.kind === 'machine') this.machinePoses.set(part.id, machinePose(angle));
    }
  }

  snapshot(): MechanicalSnapshot {
    const topology = this.topologyCache;
    if (!topology) {
      return {
        revision: this.revision < 0 ? 0 : this.revision,
        sources: [],
        networks: [],
        parts: [],
        machines: [],
      };
    }
    let solution = this.solutionCache;
    if (!solution) {
      const enabled = new Set<number>();
      for (const [partId, value] of this.sourceEnabled) if (value) enabled.add(partId);
      solution = solvePower(topology, this.parts, enabled);
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
    }));

    const parts = [...this.parts]
      .sort((a, b) => a.id - b.id)
      .map((part) => ({
        partId: part.id,
        kind: part.def.kind,
        componentId: topology.componentByPart.get(part.id) ?? null,
        omega: solution!.omegaByPart.get(part.id) ?? 0,
        angle: this.angleOf(part.id),
        powered: solution!.omegaByPart.has(part.id),
      }));

    const machines = this.parts
      .filter((part) => part.def.kind === 'machine')
      .sort((a, b) => a.id - b.id)
      .map((part) => {
        const pose = this.poseOf(part.id);
        return {
          partId: part.id,
          powered: solution!.poweredMachines.has(part.id),
          omega: solution!.omegaByPart.get(part.id) ?? 0,
          angle: this.angleOf(part.id),
          ramY: pose.ramY,
          rodAngle: pose.rodAngle,
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
