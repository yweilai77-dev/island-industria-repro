import { describe, expect, it } from 'vitest';
import { createPlacement, type Rotation } from '../grid/grid.ts';
import { levelBaseY } from '../spatial/space.ts';
import { structureModuleForPart } from '../industrial/assembly-module.ts';
import {
  AssemblyRuntime,
  buildStructureGraph,
  connectedComponents,
  structurePlacementIssue,
  validateAssembly,
} from '../industrial/assembly-runtime.ts';
import { MECHANICAL_PART_DEFS, type MechanicalPart, type PartId } from '../mechanical/parts.ts';

/**
 * P2-D 组合机械运行时测试（纯逻辑）：
 * 真实零件 → 结构图 → 组合机械（成员/结构关系/相对位置/边界/ID 稳定）；
 * 以及「普通相邻不等于组合」「核心与核心直连不构成结构关系」等硬约束。
 * 装置全部用真实 `MECHANICAL_PART_DEFS`，不复制定义。
 */

const FRAME = structureModuleForPart('structure_frame');
if (!FRAME) throw new Error('structure frame module missing');

function part(id: number, defId: PartId, gx: number, gz: number, rotation: Rotation = 0, level = 0): MechanicalPart {
  const def = MECHANICAL_PART_DEFS[defId];
  return { id, def, placement: createPlacement(gx, gz, def.w, def.d, rotation, level) };
}

function reconcile(runtime: AssemblyRuntime, parts: readonly MechanicalPart[]): void {
  runtime.reconcile(parts);
}

describe('结构图与组合判定', () => {
  it('核心直接相邻但没有结构模块：不形成组合机械（普通相邻 ≠ 组合）', () => {
    const parts = [part(1, 'crusher', 0, 0, 0), part(2, 'smelter', 1, 0, 90)];
    const graph = buildStructureGraph(parts);
    expect(graph.edges).toHaveLength(0);
    const runtime = new AssemblyRuntime();
    reconcile(runtime, parts);
    expect(runtime.snapshot()).toHaveLength(0);
  });

  it('一个结构框架正交相邻连接两台核心：形成一个 2 成员组合，成员 ID 不变', () => {
    // 核心 (0,0) 与 (1,1) 对角；框架 (0,1) 同时正交相邻于两者。
    const parts = [part(1, 'crusher', 0, 0, 0), part(2, 'smelter', 1, 1, 0), part(3, 'structure_frame', 0, 1, 0)];
    const runtime = new AssemblyRuntime();
    reconcile(runtime, parts);
    const [assembly] = runtime.snapshot();
    expect(assembly).toBeDefined();
    expect(assembly?.memberIds).toEqual([1, 2]);
    expect(assembly?.moduleIds).toEqual([3]);
    expect(assembly?.links.map((edge) => edge.kind)).toEqual(['core-module', 'core-module']);
    expect(runtime.assemblyOf(1)?.id).toBe(assembly?.id);
    expect(runtime.assemblyOf(3)?.id).toBe(assembly?.id);
    expect(runtime.contains(2)).toBe(true);
    expect(runtime.assemblyIdOf(2)).toBe(assembly?.id);
    expect(assembly?.id).toMatch(/^assembly:\d+$/);
  });

  it('只有一个核心 + 结构框架：不形成组合（组合至少需要两台核心）', () => {
    const parts = [part(1, 'crusher', 0, 0, 0), part(2, 'structure_frame', 0, 1, 0)];
    const runtime = new AssemblyRuntime();
    reconcile(runtime, parts);
    expect(runtime.snapshot()).toHaveLength(0);
    expect(runtime.contains(1)).toBe(false);
  });

  it('结构框架可以串联：转角/直线都通过框架图连通', () => {
    const parts = [
      part(1, 'crusher', 0, 0, 0),
      part(2, 'smelter', 1, 2, 0),
      part(3, 'structure_frame', 0, 1, 0),
      part(4, 'structure_frame', 1, 1, 0),
    ];
    // 框架 (0,1) 连 (0,0) 与 (1,1)；(1,1) 连 (1,2)。
    const graph = buildStructureGraph(parts);
    expect(connectedComponents(graph)).toHaveLength(1);
    const runtime = new AssemblyRuntime();
    reconcile(runtime, parts);
    const [assembly] = runtime.snapshot();
    expect(assembly?.memberIds).toEqual([1, 2]);
    expect(assembly?.moduleIds).toEqual([3, 4]);
    expect(assembly?.links.some((edge) => edge.kind === 'module-module')).toBe(true);
  });

  it('重复的结构相邻关系只记录一条结构边（不重复成员/不重复连接）', () => {
    const parts = [
      part(1, 'crusher', 0, 0, 0),
      part(2, 'smelter', 1, 1, 0),
      // 两个框架都同时贴住两台核心：结构图必须去重，每对零件只有一条边。
      part(3, 'structure_frame', 0, 1, 0),
      part(4, 'structure_frame', 1, 0, 0),
    ];
    const graph = buildStructureGraph(parts);
    const pairs = graph.edges.map((edge) => `${edge.aPartId}-${edge.bPartId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    const runtime = new AssemblyRuntime();
    reconcile(runtime, parts);
    const assembly = runtime.snapshot()[0];
    expect(assembly?.memberIds).toEqual([1, 2]);
    expect(assembly?.moduleIds).toEqual([3, 4]);
    expect(new Set(assembly?.memberIds).size).toBe(2);
  });

  it('拆解单个成员核心：其余成员仍成组，成员 ID 不变、少一个成员', () => {
    const parts = [
      part(1, 'crusher', -4, 8, 0),
      part(2, 'smelter', -4, 9, 0),
      part(3, 'forge', -4, 10, 0),
      part(4, 'structure_frame', -3, 8, 0),
      part(5, 'structure_frame', -3, 9, 0),
      part(6, 'structure_frame', -3, 10, 0),
    ];
    const runtime = new AssemblyRuntime();
    reconcile(runtime, parts);
    const before = runtime.snapshot()[0]!;
    expect(before.memberIds).toEqual([1, 2, 3]);
    // 拆掉中间的熔炼炉核心：东侧框架链仍然连通，两侧核心继续成组。
    reconcile(runtime, parts.filter((entry) => entry.id !== 2));
    const after = runtime.snapshot()[0];
    expect(after?.id).toBe(before.id);
    expect(after?.memberIds).toEqual([1, 3]);
    expect(runtime.contains(2)).toBe(false);
  });

  it('三台核心 + 两个框架：单一组合包含三成员，各自加工核心身份不同', () => {
    const parts = [
      part(1, 'crusher', 0, 0, 0),
      part(2, 'smelter', 1, 1, 0),
      part(3, 'forge', 2, 2, 0),
      part(4, 'structure_frame', 0, 1, 0),
      part(5, 'structure_frame', 1, 2, 0),
    ];
    const runtime = new AssemblyRuntime();
    reconcile(runtime, parts);
    expect(runtime.snapshot()).toHaveLength(1);
    const assembly = runtime.snapshot()[0];
    expect(assembly?.memberIds).toEqual([1, 2, 3]);
    expect(new Set(assembly?.members.map((member) => member.coreId))).toEqual(new Set(['core.crusher', 'core.smelter', 'core.forge']));
    expect(assembly?.powerDemandTorque).toBeGreaterThan(0);
  });
});

describe('相对位置、方向与整体边界', () => {
  it('记录成员相对参考成员的位置/方向，边界由真实成员与结构模块计算', () => {
    const parts = [
      part(1, 'crusher', 0, 0, 0),
      part(2, 'smelter', 1, 1, 90),
      part(3, 'structure_frame', 0, 1, 0),
    ];
    const runtime = new AssemblyRuntime();
    reconcile(runtime, parts);
    const assembly = runtime.snapshot()[0]!;
    expect(assembly.referenceMemberId).toBe(1);
    const member1 = assembly.members.find((member) => member.partId === 1);
    const member2 = assembly.members.find((member) => member.partId === 2);
    expect(member1?.relative).toEqual({ gx: 0, gz: 0, rotation: 0 });
    expect(member2?.relative).toEqual({ gx: 1, gz: 1, rotation: 90 });
    const module = assembly.modules.find((entry) => entry.partId === 3);
    expect(module?.relative).toEqual({ gx: 0, gz: 1, rotation: 0 });
    const baseY = levelBaseY(0);
    expect(assembly.bounds).toEqual({
      min: [0, baseY, 0],
      max: [2, baseY + 1, 2],
    });
  });

  it('成员旋转（1×1 占地不变）不改变组合边界与成员关系，只改变相对方向', () => {
    const parts = [
      part(1, 'crusher', 0, 0, 0),
      part(2, 'smelter', 1, 1, 0),
      part(3, 'structure_frame', 0, 1, 0),
    ];
    const runtime = new AssemblyRuntime();
    reconcile(runtime, parts);
    const before = runtime.snapshot()[0]!;
    const rotated = parts.map((entry) => (entry.id === 2 ? part(2, 'smelter', 1, 1, 90) : entry));
    reconcile(runtime, rotated);
    const after = runtime.snapshot()[0]!;
    expect(after.id).toBe(before.id);
    expect(after.memberIds).toEqual(before.memberIds);
    expect(after.bounds).toEqual(before.bounds);
    expect(after.members.find((member) => member.partId === 2)?.relative.rotation).toBe(90);
    expect(validateAssembly(after, rotated).filter((issue) => issue !== 'disconnected')).toEqual([]);
  });
});

describe('Assembly ID 稳定性、合并与解体', () => {
  it('加入新核心/框架后沿用原 Assembly ID，成员扩展', () => {
    const base = [
      part(1, 'crusher', 0, 0, 0),
      part(2, 'smelter', 1, 1, 0),
      part(3, 'structure_frame', 0, 1, 0),
    ];
    const runtime = new AssemblyRuntime();
    reconcile(runtime, base);
    const firstId = runtime.snapshot()[0]?.id;
    expect(firstId).toBeDefined();
    const grown = [
      ...base,
      part(4, 'forge', 2, 2, 0),
      part(5, 'structure_frame', 1, 2, 0),
    ];
    reconcile(runtime, grown);
    expect(runtime.snapshot()).toHaveLength(1);
    expect(runtime.snapshot()[0]?.id).toBe(firstId);
    expect(runtime.snapshot()[0]?.memberIds).toEqual([1, 2, 4]);
  });

  it('两个组合通过新框架合并：保留较早的 ID，不出现重复成员', () => {
    const left = [part(1, 'crusher', 0, 0, 0), part(2, 'smelter', 1, 1, 0), part(3, 'structure_frame', 0, 1, 0)];
    const right = [part(4, 'crusher', 4, 4, 0), part(5, 'smelter', 5, 5, 0), part(6, 'structure_frame', 4, 5, 0)];
    const runtime = new AssemblyRuntime();
    reconcile(runtime, [...left, ...right]);
    const ids = runtime.snapshot().map((assembly) => assembly.id);
    expect(ids).toHaveLength(2);
    const merged = [
      ...left, ...right,
      // 桥接两个组合：(1,1) 与 (4,4) 之间用两个框架串起来。
      part(7, 'structure_frame', 2, 1, 0),
      part(8, 'structure_frame', 3, 1, 0),
      part(9, 'structure_frame', 3, 2, 0),
      part(10, 'structure_frame', 3, 3, 0),
      part(11, 'structure_frame', 3, 4, 0),
    ];
    // 让右组核心 (4,4) 与框架 (3,4) 正交相邻。
    reconcile(runtime, merged);
    expect(runtime.snapshot()).toHaveLength(1);
    const [assembly] = runtime.snapshot();
    expect(assembly?.id).toBe(ids[0]);
    expect(new Set(assembly?.memberIds).size).toBe(assembly?.memberIds.length);
    expect(assembly?.memberIds).toEqual([1, 2, 4, 5]);
  });

  it('两个组合之间的桥接框架被拆除：解体为两个独立组合，成员各归其位', () => {
    const parts = [
      part(1, 'crusher', 0, 0, 0), part(2, 'smelter', 1, 1, 0), part(3, 'structure_frame', 0, 1, 0),
      part(4, 'crusher', 4, 4, 0), part(5, 'smelter', 5, 5, 0), part(6, 'structure_frame', 4, 5, 0),
      part(7, 'structure_frame', 2, 1, 0), part(8, 'structure_frame', 3, 1, 0),
      part(9, 'structure_frame', 3, 2, 0), part(10, 'structure_frame', 3, 3, 0),
      part(11, 'structure_frame', 3, 4, 0),
    ];
    const runtime = new AssemblyRuntime();
    reconcile(runtime, parts);
    expect(runtime.snapshot()).toHaveLength(1);
    const mergedId = runtime.snapshot()[0]?.id;
    const split = parts.filter((entry) => entry.id < 7);
    reconcile(runtime, split);
    expect(runtime.snapshot()).toHaveLength(2);
    const ids = runtime.snapshot().map((assembly) => assembly.id);
    expect(ids.filter((id) => id === mergedId).length).toBeGreaterThanOrEqual(1);
    for (const assembly of runtime.snapshot()) {
      expect(assembly.memberIds).toHaveLength(2);
    }
    // 一个成员只能属于一个组合。
    const allMembers = runtime.snapshot().flatMap((assembly) => [...assembly.memberIds]);
    expect(new Set(allMembers).size).toBe(allMembers.length);
  });

  it('组合完全拆除后不再存在，成员恢复独立；再次组合分配新 ID', () => {
    const parts = [
      part(1, 'crusher', 0, 0, 0),
      part(2, 'smelter', 1, 1, 0),
      part(3, 'structure_frame', 0, 1, 0),
    ];
    const runtime = new AssemblyRuntime();
    reconcile(runtime, parts);
    const firstId = runtime.snapshot()[0]?.id;
    reconcile(runtime, parts.filter((entry) => entry.id !== 3));
    expect(runtime.snapshot()).toHaveLength(0);
    expect(runtime.contains(1)).toBe(false);
    reconcile(runtime, parts);
    expect(runtime.snapshot()).toHaveLength(1);
    expect(runtime.snapshot()[0]?.id).not.toBe(firstId);
  });
});

describe('合法性校验与结构放置规则', () => {
  it('validateAssembly：重复成员、非核心成员、跨组合成员、结构不连通都能报出来', () => {
    const parts = [
      part(1, 'crusher', 0, 0, 0),
      part(2, 'smelter', 1, 1, 0),
      part(3, 'structure_frame', 0, 1, 0),
      part(4, 'structure_frame', 5, 5, 0),
    ];
    const runtime = new AssemblyRuntime();
    reconcile(runtime, parts);
    const valid = runtime.snapshot()[0]!;
    expect(validateAssembly(valid, parts)).toEqual([]);

    const duplicate = { ...valid, memberIds: [1, 1], members: valid.members };
    expect(validateAssembly(duplicate, parts)).toContain('duplicate-member');

    const notCore = { ...valid, memberIds: [1, 3], members: valid.members };
    expect(validateAssembly(notCore, parts)).toContain('member-not-core');

    const invalidLink = { ...valid, links: [...valid.links, { aPartId: 1, bPartId: 99, kind: 'core-module' as const }] };
    expect(validateAssembly(invalidLink, parts)).toContain('invalid-structure-link');

    const other = { ...valid, id: 'assembly:999' as typeof valid.id, memberIds: [2] };
    expect(validateAssembly(valid, parts, [other])).toContain('member-in-other-assembly');
  });

  it('结构框架放置：必须与同层核心/结构框架正交相邻；对角相邻可以，远处不行', () => {
    const cores = [part(1, 'crusher', 0, 0, 0), part(2, 'smelter', 1, 1, 0)];
    const adjacentToBoth = createPlacement(0, 1, 1, 1, 0, 0);
    expect(structurePlacementIssue(adjacentToBoth, FRAME, cores)).toBeNull();
    const farAway = createPlacement(5, 5, 1, 1, 0, 0);
    expect(structurePlacementIssue(farAway, FRAME, cores)).toBe('not-adjacent');
    const differentLevel = createPlacement(0, 1, 1, 1, 0, 1);
    expect(structurePlacementIssue(differentLevel, FRAME, cores)).toBe('not-adjacent');
  });

  it('结构框架可以接在另一个结构框架旁（允许先搭结构、再接核心）', () => {
    const frame = part(3, 'structure_frame', 0, 1, 0);
    const candidate = createPlacement(0, 2, 1, 1, 0, 0);
    expect(structurePlacementIssue(candidate, FRAME, [frame])).toBeNull();
  });
});
