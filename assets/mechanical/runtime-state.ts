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
    /** 逻辑开关（测试动力源 = 启停；飞轮 = 离合是否挂上）。 */
    readonly enabled: boolean;
    /** 当前是否真的在输出动力（飞轮还要有储能）。 */
    readonly engaged: boolean;
    readonly ratedRpm: number;
    readonly label: string;
    /** 正式动力源的储能；测试动力源为 null。 */
    readonly energy: number | null;
    readonly energyCapacity: number | null;
    readonly winding: boolean;
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

/** 正式动力源（手摇飞轮）的运行时状态。 */
interface EnergySourceRuntime {
  /** 离合是否挂上（右键启停）。 */
  clutch: boolean;
  energy: number;
  winding: boolean;
}

/**
 * M1.7-B 运行时状态：
 * - source enabled 是唯一逻辑持久状态；
 * - topology 只在 revision 变化时重建；
 * - source 开关只使 solution 变脏；
 * - angle / machine pose 是从 ω 推导的视觉运行状态；
 * - snapshot 是纯 JSON 读投影。
 *
 * M1.8-B：正式动力源（手摇飞轮）在此维护能量池；储能耗尽后自动断开输出，
 * 使 `solvePower` 看到「源不可用」，机器正确停转，而不是靠视觉假装停止。
 */
export class MechanicalRuntimeState {
  private revision = -1;
  private parts: readonly MechanicalPart[] = [];
  private partMap = new Map<number, MechanicalPart>();
  private connections: readonly Connection[] = [];
  private topologyCache: PowerTopology | null = null;
  private solutionCache: PowerSolution | null = null;
  private sourceEnabled = new Map<number, boolean>();
  private energySources = new Map<number, EnergySourceRuntime>();
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
    // 正式动力源：补建/清理能量状态（新装上的飞轮从 0 能量开始，必须先摇）。
    const energyParts = new Set<number>();
    for (const part of this.parts) {
      if (!part.def.energy) continue;
      energyParts.add(part.id);
      if (!this.energySources.has(part.id)) {
        this.energySources.set(part.id, { clutch: false, energy: 0, winding: false });
      }
    }
    for (const partId of [...this.energySources.keys()]) {
      if (!energyParts.has(partId)) this.energySources.delete(partId);
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
    const energy = this.energySources.get(partId);
    if (energy) energy.clutch = enabled;
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
      for (const [partId, value] of this.sourceEnabled) {
        if (value && this.isEffectivelyEngaged(partId)) enabled.add(partId);
      }
      this.solutionCache = solvePower(this.topologyCache, this.parts, enabled);
      this.solutionDirty = false;
    }
    return this.solutionCache;
  }

  /** 正式动力源是否真的能输出：离合挂上 **且** 还有储能；测试动力源只看开关。 */
  private isEffectivelyEngaged(partId: number): boolean {
    if (this.sourceEnabled.get(partId) !== true) return false;
    const energy = this.energySources.get(partId);
    if (!energy) return true;
    return energy.energy > 0;
  }

  isEngaged(partId: number): boolean {
    return this.isEffectivelyEngaged(partId);
  }

  /** 正式动力源的储能读数；测试动力源返回 undefined。 */
  energyOf(partId: number): { energy: number; capacity: number; winding: boolean; clutch: boolean } | undefined {
    const state = this.energySources.get(partId);
    const part = this.partMap.get(partId);
    if (!state || !part?.def.energy) return undefined;
    return {
      energy: state.energy,
      capacity: part.def.energy.capacity,
      winding: state.winding,
      clutch: state.clutch,
    };
  }

  /** 设置/清除摇动状态；只对正式动力源有效。 */
  setWinding(partId: number, winding: boolean): boolean {
    const state = this.energySources.get(partId);
    if (!state) return false;
    if (state.winding === winding) return false;
    state.winding = winding;
    return true;
  }

  isWinding(partId: number): boolean {
    return this.energySources.get(partId)?.winding ?? false;
  }

  /** 实际转速 / 额定 60 RPM（供加工速率使用）。 */
  rateOf(partId: number): number {
    const omega = this.omegaOf(partId);
    return Math.abs(omega) / TAU;
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
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, 0.1)) : 0;
    // 先用上一帧的解算结果结算储能，再按新的「是否还能输出」重解一次。
    const prior = this.ensureSolution();
    this.integrateEnergy(dt, prior);
    const solution = this.ensureSolution();
    if (!solution) return;

    for (const part of this.parts) {
      const omega = solution.omegaByPart.get(part.id) ?? 0;
      const angle = this.angleOf(part.id) + omega * dt;
      this.angles.set(part.id, angle);
      if (part.def.kind === 'machine') this.machinePoses.set(part.id, machinePose(angle));
    }
  }

  /**
   * 储能结算：
   * - 摇动摇柄时按 windRate 注入（上限 = capacity）；
   * - 离合挂上时按「空载耗 + 负载耗 × 需求/容量」抽能；
   * - 能量跨过 0 边界时把解算标脏，下一帧动力网络就会把机器判为停转。
   */
  private integrateEnergy(dt: number, prior: PowerSolution | null): void {
    if (dt <= 0) return;
    for (const [partId, state] of this.energySources) {
      const part = this.partMap.get(partId);
      const spec = part?.def.energy;
      if (!part || !spec) continue;
      const before = state.energy;
      if (state.winding) {
        state.energy = Math.min(spec.capacity, state.energy + spec.windRate * dt);
      } else if (state.clutch) {
        const componentIndex = this.topologyCache?.componentByPart.get(partId);
        const demand = componentIndex !== undefined && prior
          ? (prior.demandByComponent.get(componentIndex) ?? 0)
          : 0;
        const capacity = part.def.maxTorque > 0 ? part.def.maxTorque : 1;
        const loadRatio = Math.min(1, Math.max(0, demand / capacity));
        const drain = spec.baseDrain + spec.loadDrain * loadRatio;
        state.energy = Math.max(0, state.energy - drain * dt);
      }
      if (before === 0 && state.energy > 0) this.solutionDirty = true;
      if (before > 0 && state.energy === 0) this.solutionDirty = true;
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
      .map((part) => {
        const energy = this.energyOf(part.id);
        return {
          partId: part.id,
          enabled: this.isSourceEnabled(part.id),
          engaged: this.isEffectivelyEngaged(part.id),
          ratedRpm: rpmOf(part),
          label: part.def.label,
          energy: energy ? energy.energy : null,
          energyCapacity: energy ? energy.capacity : null,
          winding: energy ? energy.winding : false,
        };
      })
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
    this.energySources.clear();
    this.angles.clear();
    this.machinePoses.clear();
    this.solutionDirty = true;
    this.topologyBuilds = 0;
  }
}