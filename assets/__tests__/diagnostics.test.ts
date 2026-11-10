import { describe, expect, it } from 'vitest';
import {
  buildDiagnostics,
  diagnosticsSnapshot,
  type DiagnosticsAssemblyInput,
  type DiagnosticsSource,
} from '../diagnostics/diagnostics.ts';
import type { GoalMachineObservation, GoalObservation, GoalPartObservation } from '../goal/observation.ts';
import type { MaterialLinkSnapshot } from '../industrial/link-runtime.ts';
import type { InstalledPortSnapshot } from '../industrial/port-runtime.ts';

/**
 * M2.0-P2-E2 工作包 B3：生产线诊断的纯逻辑单测。
 *
 * 所有输入都是「真实运行时快照形状」的纯数据（不改引擎），逐条覆盖任务书 B3 的六个问题：
 * 缺输入 / 接口盒已满 / 连接阻塞 / 缺动力 / 瓶颈优先级 / 正常环节，以及门控与「不产生虚假状态」。
 */

const CRUSHER = 1;
const SMELTER = 2;
const FORGE = 3;

function part(partId: number, partKind: PartObservationKind, powered = true, stalled = false): GoalPartObservation {
  return { partId, partKind, powered, stalled };
}

type PartObservationKind = GoalPartObservation['partKind'];

function machine(
  partId: number,
  overrides: Partial<GoalMachineObservation> = {},
): GoalMachineObservation {
  return {
    partId,
    recipeId: 'crush-iron-ore',
    progress: 0,
    block: 'ok',
    inputItem: null,
    inputCount: 0,
    outputItem: null,
    outputCount: 0,
    running: false,
    producedTotal: 0,
    ...overrides,
  };
}

function network(machineIds: readonly number[], overrides: Partial<GoalObservation['networks'][number]> = {}): GoalObservation['networks'][number] {
  return {
    id: 1,
    status: 'powered',
    reason: null,
    sourceIds: [99],
    machineIds,
    partIds: [...machineIds, 99],
    stalledPartIds: [],
    speedFactor: 1,
    ...overrides,
  };
}

function observation(input: {
  parts?: readonly GoalPartObservation[];
  machines?: readonly GoalMachineObservation[];
  networks?: GoalObservation['networks'];
}): GoalObservation {
  return {
    ironOre: 0,
    parts: input.parts ?? [],
    machines: input.machines ?? [],
    sources: [],
    networks: input.networks ?? [],
    produced: [],
  };
}

function port(
  partId: number,
  slotId: string,
  itemId: InstalledPortSnapshot['itemId'],
  count: number,
  capacity = 4,
): InstalledPortSnapshot {
  return {
    partId,
    slotId: slotId as InstalledPortSnapshot['slotId'],
    moduleId: 'port.through' as InstalledPortSnapshot['moduleId'],
    itemId,
    count,
    capacity,
  };
}

function link(
  fromPart: number,
  fromSlot: string,
  toPart: number,
  toSlot: string,
  overrides: Partial<MaterialLinkSnapshot> = {},
): MaterialLinkSnapshot {
  const id = `link:${fromPart}:${fromSlot}->${toPart}:${toSlot}` as MaterialLinkSnapshot['id'];
  return {
    id,
    from: { entityId: fromPart, slotId: fromSlot as MaterialLinkSnapshot['from']['slotId'] },
    to: { entityId: toPart, slotId: toSlot as MaterialLinkSnapshot['to']['slotId'] },
    capacity: 1,
    active: true,
    status: 'ok',
    moved: 0,
    ...overrides,
  };
}

function source(input: {
  observation: GoalObservation;
  ports?: readonly InstalledPortSnapshot[];
  links?: readonly MaterialLinkSnapshot[];
  assemblies?: readonly DiagnosticsAssemblyInput[];
}): DiagnosticsSource {
  return {
    observation: input.observation,
    ports: input.ports ?? [],
    links: input.links ?? [],
    assemblies: input.assemblies ?? [],
  };
}

const OUT_SLOT = 'slot.crusher.out.px';
const IN_SLOT_CRUSHER = 'slot.crusher.in.nz';
const IN_SLOT_SMELTER = 'slot.smelter.in.nz';
const OUT_SLOT_SMELTER = 'slot.smelter.out.px';

describe('B3-1 哪台机器缺输入', () => {
  it('block=no-input 的机器报 error，瓶颈落在最上游的 supply', () => {
    const snapshot = buildDiagnostics(source({
      observation: observation({
        parts: [part(CRUSHER, 'crusher', true)],
        machines: [machine(CRUSHER, { block: 'no-input', inputItem: null, inputCount: 0 })],
      }),
    }));
    const crusher = snapshot.machines[0]!;
    expect(crusher.label).toBe('破碎机 #1');
    expect(crusher.coreId).toBe('core.crusher');
    expect(crusher.block).toBe('no-input');
    expect(crusher.severity).toBe('error');
    const conditions = crusher.conditions ?? [];
    expect(conditions).toHaveLength(5);
    expect(conditions.find((condition) => condition.id === 'input')?.ok).toBe(false);
    expect(conditions.find((condition) => condition.id === 'input')?.detail).toContain('铁矿石');
    expect(snapshot.hasError).toBe(true);
    expect(snapshot.bottleneck).toMatchObject({ kind: 'supply', partId: CRUSHER });
  });
});

describe('B3-2 哪个接口盒已满', () => {
  it('输出接口盒满 → outputPortFull=true，消息指出盒子占用，瓶颈是 output', () => {
    const snapshot = buildDiagnostics(source({
      observation: observation({
        parts: [part(FORGE, 'forge', true)],
        machines: [machine(FORGE, {
          recipeId: 'forge-shaft',
          block: 'output-full',
          outputItem: 'shaft',
          outputCount: 4,
        })],
      }),
      ports: [port(FORGE, 'slot.forge.out.px', 'shaft', 4, 4)],
    }));
    const forge = snapshot.machines[0]!;
    expect(forge.outputPortFull).toBe(true);
    expect(forge.inputPortFull).toBe(false);
    expect(forge.severity).toBe('error');
    expect(forge.message).toContain('输出接口盒已满');
    expect(forge.message).toContain('传动轴');
    expect(snapshot.bottleneck).toMatchObject({ kind: 'output', partId: FORGE });
  });

  it('输入接口盒满 → inputPortFull=true，且输出盒未满时为 false', () => {
    const snapshot = buildDiagnostics(source({
      observation: observation({
        parts: [part(CRUSHER, 'crusher', true)],
        machines: [machine(CRUSHER, { block: 'no-input' })],
      }),
      ports: [port(CRUSHER, IN_SLOT_CRUSHER, 'iron_ore', 2, 2)],
    }));
    const crusher = snapshot.machines[0]!;
    expect(crusher.inputPortFull).toBe(true);
    expect(crusher.outputPortFull).toBe(false);
    expect((crusher.conditions ?? []).find((condition) => condition.id === 'input-port')?.ok).toBe(false);
  });
});

describe('B3-3 哪条 MaterialLink 在阻塞', () => {
  it('下游接口盒满 → 该连接 blocked，下游机器 blockedLinkId 指向它', () => {
    const blockedLink = link(CRUSHER, OUT_SLOT, SMELTER, IN_SLOT_SMELTER);
    const snapshot = buildDiagnostics(source({
      observation: observation({
        parts: [part(CRUSHER, 'crusher', true), part(SMELTER, 'smelter', true)],
        machines: [
          machine(CRUSHER, { recipeId: 'smelt-crushed-ore', block: 'ok' }),
          machine(SMELTER, { recipeId: 'smelt-crushed-ore', block: 'no-input' }),
        ],
      }),
      ports: [
        port(CRUSHER, OUT_SLOT, 'crushed_ore', 1, 4),
        port(SMELTER, IN_SLOT_SMELTER, 'crushed_ore', 4, 4),
      ],
      links: [blockedLink],
    }));
    const linkOf = snapshot.links[0]!;
    expect(linkOf.blocked).toBe(true);
    expect(linkOf.severity).toBe('error');
    expect(linkOf.fromCoreId).toBe('core.crusher');
    expect(linkOf.toCoreId).toBe('core.smelter');
    expect(linkOf.message).toContain('下游接口盒已满');
    expect(snapshot.machines.find((m) => m.partId === SMELTER)?.blockedLinkId).toBe(blockedLink.id);
    expect(snapshot.machines.find((m) => m.partId === CRUSHER)?.blockedLinkId).toBeNull();
  });

  it('源里没货只是等待上游（不是阻塞），severity=ok', () => {
    const snapshot = buildDiagnostics(source({
      observation: observation({
        parts: [part(CRUSHER, 'crusher', true), part(SMELTER, 'smelter', true)],
        machines: [machine(CRUSHER), machine(SMELTER, { recipeId: 'smelt-crushed-ore' })],
      }),
      ports: [port(CRUSHER, OUT_SLOT, null, 0, 4), port(SMELTER, IN_SLOT_SMELTER, null, 0, 4)],
      links: [link(CRUSHER, OUT_SLOT, SMELTER, IN_SLOT_SMELTER)],
    }));
    const linkOf = snapshot.links[0]!;
    expect(linkOf.blocked).toBe(false);
    expect(linkOf.severity).toBe('ok');
    expect(linkOf.message).toContain('等待上游供料');
  });

  it('连接失效（缺接口盒/几何不成立）→ severity=warn 且不谎称阻塞', () => {
    const snapshot = buildDiagnostics(source({
      observation: observation({
        parts: [part(CRUSHER, 'crusher', true), part(SMELTER, 'smelter', true)],
        machines: [machine(CRUSHER), machine(SMELTER)],
      }),
      links: [link(CRUSHER, OUT_SLOT, SMELTER, IN_SLOT_SMELTER, { active: false, status: 'inactive-missing-port' })],
    }));
    const linkOf = snapshot.links[0]!;
    expect(linkOf.blocked).toBe(false);
    expect(linkOf.severity).toBe('warn');
    expect(linkOf.state).toBe('inactive-missing-port');
  });
});

describe('B3-4 哪台机器缺动力', () => {
  it('block=no-power 且真实 powered=false，消息带动力网络真实原因', () => {
    const snapshot = buildDiagnostics(source({
      observation: observation({
        parts: [part(CRUSHER, 'crusher', false)],
        machines: [machine(CRUSHER, { block: 'no-power' })],
        networks: [network([CRUSHER], { status: 'stalled', reason: 'source-overload' })],
      }),
      ports: [port(CRUSHER, IN_SLOT_CRUSHER, 'iron_ore', 4, 4)],
    }));
    const crusher = snapshot.machines[0]!;
    expect(crusher.powered).toBe(false);
    expect(crusher.block).toBe('no-power');
    expect((crusher.conditions ?? []).find((condition) => condition.id === 'power')?.ok).toBe(false);
    expect(crusher.message).toContain('缺动力');
    expect(crusher.message).toContain('动力源过载');
    expect(snapshot.bottleneck).toMatchObject({ kind: 'power', partId: CRUSHER });
  });
});

describe('B3-5 瓶颈优先级（最上游的 error）', () => {
  it('上游缺料优先于下游缺动力（depth 决定，而不是数组顺序）', () => {
    const snapshot = buildDiagnostics(source({
      observation: observation({
        parts: [part(CRUSHER, 'crusher', true), part(SMELTER, 'smelter', false)],
        machines: [
          // 故意把下游机器放在前面：结果必须由拓扑深度决定。
          machine(SMELTER, { recipeId: 'smelt-crushed-ore', block: 'no-power' }),
          machine(CRUSHER, { block: 'no-input' }),
        ],
      }),
      ports: [port(CRUSHER, OUT_SLOT, null, 0, 4)],
      links: [link(CRUSHER, OUT_SLOT, SMELTER, IN_SLOT_SMELTER)],
    }));
    expect(snapshot.bottleneck).toMatchObject({ kind: 'supply', partId: CRUSHER });
  });

  it('同一深度按「缺料 → 缺动力 → 堵塞 → 输出满」优先级选', () => {
    const snapshot = buildDiagnostics(source({
      observation: observation({
        parts: [part(CRUSHER, 'crusher', true), part(SMELTER, 'smelter', true), part(FORGE, 'forge', true)],
        machines: [
          machine(CRUSHER, { block: 'output-full', outputItem: 'crushed_ore', outputCount: 4 }),
          machine(SMELTER, { recipeId: 'smelt-crushed-ore', block: 'no-power' }),
          machine(FORGE, { recipeId: 'forge-shaft', block: 'no-input' }),
        ],
      }),
      // 没有活动连接 → 三台 depth 都是 0，同深度只看优先级：缺料 rank 最高。
    }));
    expect(snapshot.bottleneck).toMatchObject({ kind: 'supply', partId: FORGE });
  });

  it('没有 error 时 bottleneck 为 null（只有 warn 的连接失效不算瓶颈）', () => {
    const snapshot = buildDiagnostics(source({
      observation: observation({
        parts: [part(CRUSHER, 'crusher', true)],
        machines: [machine(CRUSHER, { running: true, progress: 0.4 })],
      }),
      links: [link(CRUSHER, OUT_SLOT, SMELTER, IN_SLOT_SMELTER, { active: false, status: 'inactive-missing-part' })],
    }));
    expect(snapshot.hasError).toBe(false);
    expect(snapshot.bottleneck).toBeNull();
  });
});

describe('B3-6 哪些环节正常 + summary', () => {
  it('全绿：running/idle/powered/blocked 计数来自真实字段', () => {
    const snapshot = buildDiagnostics(source({
      observation: observation({
        parts: [part(CRUSHER, 'crusher', true), part(SMELTER, 'smelter', true), part(FORGE, 'forge', false)],
        machines: [
          machine(CRUSHER, { running: true, progress: 0.5, block: 'ok' }),
          machine(SMELTER, { recipeId: 'smelt-crushed-ore', running: true, progress: 0.2, block: 'ok' }),
          machine(FORGE, { recipeId: 'forge-shaft', block: 'no-power' }),
        ],
      }),
      assemblies: [{ id: 'assembly:1', memberIds: [CRUSHER] }],
    }));
    expect(snapshot.summary).toEqual({ total: 3, running: 2, idle: 0, blocked: 1, powered: 2 });
    expect(snapshot.hasError).toBe(true);
    expect(snapshot.machines.map((entry) => entry.severity)).toEqual(['ok', 'ok', 'error']);
    expect(snapshot.machines[0]!.message).toBe('正在加工「破碎铁矿」 50%（组合 assembly:1）');
    const firstConditions = snapshot.machines[0]!.conditions ?? [];
    expect(firstConditions.every((condition) => condition.ok)).toBe(true);
    expect(firstConditions.map((condition) => condition.id)).toEqual([
      'power', 'input', 'output-space', 'input-port', 'link',
    ]);
  });

  it('空世界不产生假数据：0 台机器、无瓶颈、无 error', () => {
    const snapshot = buildDiagnostics(source({ observation: observation({}) }));
    expect(snapshot.machines).toEqual([]);
    expect(snapshot.links).toEqual([]);
    expect(snapshot.bottleneck).toBeNull();
    expect(snapshot.hasError).toBe(false);
    expect(snapshot.summary).toEqual({ total: 0, running: 0, idle: 0, blocked: 0, powered: 0 });
  });
});

describe('B3-7 门控：未解锁返回 null（不是空数组）', () => {
  it('diagnosticsSnapshot 在 unlocked=false 时返回 null，解锁后返回真实快照', () => {
    const scene = source({
      observation: observation({
        parts: [part(CRUSHER, 'crusher', true)],
        machines: [machine(CRUSHER, { running: true, progress: 0.3 })],
      }),
    });
    expect(diagnosticsSnapshot(scene, false)).toBeNull();
    const unlocked = diagnosticsSnapshot(scene, true);
    expect(unlocked).not.toBeNull();
    expect(unlocked?.machines).toHaveLength(1);
    expect(unlocked?.unlocked).toBe(true);
  });
});

describe('B3-8 不产生虚假状态（一切数值镜像真实快照）', () => {
  it('输出为空、running=false 时绝不报 running=true；progress 原样透传', () => {
    const snapshot = buildDiagnostics(source({
      observation: observation({
        parts: [part(CRUSHER, 'crusher', false)],
        machines: [machine(CRUSHER, {
          block: 'no-power',
          running: false,
          progress: 0.62,
          outputItem: null,
          outputCount: 0,
        })],
      }),
    }));
    const crusher = snapshot.machines[0]!;
    expect(crusher.running).toBe(false);
    expect(crusher.outputItem).toBeNull();
    expect(crusher.outputCount).toBe(0);
    expect(crusher.progress).toBeCloseTo(0.62, 12);
    expect(crusher.message).not.toContain('正在加工');
  });

  it('block=ok 但本帧没推进 → 仍是 ok（不虚报 error），计入 idle', () => {
    const snapshot = buildDiagnostics(source({
      observation: observation({
        parts: [part(CRUSHER, 'crusher', true)],
        machines: [machine(CRUSHER, { block: 'ok', running: false })],
      }),
    }));
    const crusher = snapshot.machines[0]!;
    expect(crusher.running).toBe(false);
    expect(crusher.severity).toBe('ok');
    expect(crusher.message).toContain('就绪');
    expect(snapshot.bottleneck).toBeNull();
    expect(snapshot.summary).toEqual({ total: 1, running: 0, idle: 1, blocked: 0, powered: 1 });
  });
});
