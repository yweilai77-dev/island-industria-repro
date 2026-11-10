import { describe, expect, it } from 'vitest';
import { getItemDefinition } from '../items/items.ts';
import {
  TECH_NODES,
  TECH_NODE_COUNT,
  TECH_ROUTE_LABELS,
  TECH_STAGE_LABELS,
  capabilitiesOf,
  prerequisitesSatisfied,
  techChildrenOf,
  techClosureOf,
  techNodeById,
  techNodeIds,
  totalCostCount,
} from '../tech/nodes.ts';
import { createCatalogResolvers } from '../tech/resolvers.ts';
import { TECH_ID_PATTERN, type TechNodeDef } from '../tech/types.ts';
import {
  assertValidTechTree,
  validateTechTree,
  type TechValidationIssue,
} from '../tech/validate.ts';

/**
 * P2-E1 科技树**数据层**测试（任务书 §六）：
 * 12 个 E0 节点齐全、ID/阶段/路线分布、前置图无环、成本与解锁目标真实存在、
 * 以及校验器对六类坏数据逐一报出对应 code。
 */

/** E0 设计 §4.1 的 12 个稳定节点 ID（顺序 = TECH_NODES 展示顺序）。 */
const E0_NODE_IDS = [
  'tech:gear-manufacture',
  'tech:chute-logistics',
  'tech:cross-level-drive',
  'tech:input-interface',
  'tech:output-interface',
  'tech:split-merge',
  'tech:core-replication',
  'tech:flywheel-production',
  'tech:structure-assembly',
  'tech:batch-processing',
  'tech:line-integration',
  'tech:combined-works',
] as const;

interface MutableNode {
  id: string;
  name: string;
  description: string;
  stage: number;
  route: string;
  purpose: string;
  requires: string[];
  cost: { itemId: string; count: number }[];
  unlocks: { kind: string; id: string }[];
}

/** 深拷贝到可变结构，供坏数据用例改一处、其余保持真实数据。 */
function cloneNodes(): MutableNode[] {
  return TECH_NODES.map((node) => ({
    id: node.id,
    name: node.name,
    description: node.description,
    stage: node.stage,
    route: node.route,
    purpose: node.purpose,
    requires: [...node.requires],
    cost: node.cost.map((entry) => ({ ...entry })),
    unlocks: node.unlocks.map((unlock) => ({ ...unlock })),
  }));
}

function codesOf(issues: readonly TechValidationIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function validateAfter(
  mutate: (nodes: MutableNode[]) => void,
  expectedCount = TECH_NODE_COUNT,
): readonly TechValidationIssue[] {
  const nodes = cloneNodes();
  mutate(nodes);
  return validateTechTree(nodes as unknown as TechNodeDef[], createCatalogResolvers(), expectedCount);
}

describe('E0 数据完整性：12 个节点齐全', () => {
  it('恰好 12 个节点，ID 集合与 E0 设计逐字一致且唯一', () => {
    expect(TECH_NODE_COUNT).toBe(12);
    expect(TECH_NODES).toHaveLength(12);
    expect(techNodeIds()).toEqual([...E0_NODE_IDS]);
    expect(new Set(techNodeIds()).size).toBe(12);
    expect([...techNodeIds()]).toEqual(E0_NODE_IDS.slice());
  });

  it('每个 ID 匹配 tech:<kebab-slug> 且可按 ID 取回节点', () => {
    for (const node of TECH_NODES) {
      expect(TECH_ID_PATTERN.test(node.id), node.id).toBe(true);
      expect(techNodeById(node.id)).toBe(node);
    }
    expect(techNodeById('tech:not-a-node')).toBeUndefined();
    expect(techNodeById('gear-manufacture')).toBeUndefined();
    // 格式边界：缺前缀、大写、下划线、连续/尾随连字符都不合法。
    expect(TECH_ID_PATTERN.test('tech:Gear')).toBe(false);
    expect(TECH_ID_PATTERN.test('tech:gear_manufacture')).toBe(false);
    expect(TECH_ID_PATTERN.test('tech:gear--manufacture')).toBe(false);
    expect(TECH_ID_PATTERN.test('tech:gear-manufacture-')).toBe(false);
  });

  it('阶段分布 4/5/3、路线分布 3/6/3，展示顺序按阶段递增', () => {
    const stageCounts = new Map<number, number>();
    const routeCounts = new Map<string, number>();
    for (const node of TECH_NODES) {
      stageCounts.set(node.stage, (stageCounts.get(node.stage) ?? 0) + 1);
      routeCounts.set(node.route, (routeCounts.get(node.route) ?? 0) + 1);
    }
    expect([...stageCounts.keys()].sort()).toEqual([1, 2, 3]);
    expect(stageCounts.get(1)).toBe(4);
    expect(stageCounts.get(2)).toBe(5);
    expect(stageCounts.get(3)).toBe(3);
    expect(routeCounts.get('power')).toBe(3);
    expect(routeCounts.get('industry')).toBe(6);
    expect(routeCounts.get('cross')).toBe(3);
    const stages = TECH_NODES.map((node) => node.stage);
    expect(stages).toEqual([...stages].sort((a, b) => a - b));
  });

  it('阶段/路线标签表覆盖全部取值并冻结', () => {
    expect(Object.keys(TECH_STAGE_LABELS).sort()).toEqual(['1', '2', '3']);
    expect(TECH_STAGE_LABELS[1]).toBe('基础工业');
    expect(TECH_ROUTE_LABELS.power).toBe('机械动力');
    expect(TECH_ROUTE_LABELS.industry).toBe('工业制造');
    expect(TECH_ROUTE_LABELS.cross).toBe('交叉技术');
    expect(Object.isFrozen(TECH_STAGE_LABELS)).toBe(true);
    expect(Object.isFrozen(TECH_ROUTE_LABELS)).toBe(true);
  });
});

describe('E0 数据完整性：前置图与交付/解锁引用', () => {
  it('validateTechTree 对真实数据零问题（无环、无未知前置、无未知目标）', () => {
    const issues = validateTechTree(TECH_NODES, createCatalogResolvers(), TECH_NODE_COUNT);
    expect(issues).toEqual([]);
    expect(codesOf(issues)).not.toContain('dependency-cycle');
    expect(() => assertValidTechTree(TECH_NODES, createCatalogResolvers(), TECH_NODE_COUNT)).not.toThrow();
  });

  it('前置图无环：每个前置可解析、无自依赖，闭包包含全部祖先', () => {
    const known = new Set<string>(E0_NODE_IDS);
    for (const node of TECH_NODES) {
      expect(node.requires, node.id).not.toContain(node.id);
      for (const requirement of node.requires) {
        expect(known.has(requirement), `${node.id} -> ${requirement}`).toBe(true);
      }
      const closure = new Set<string>(techClosureOf(node.id));
      expect(closure.has(node.id)).toBe(true);
      const stack = [...node.requires];
      while (stack.length > 0) {
        const current = stack.pop() as string;
        expect(closure.has(current), `${node.id} closure missing ${current}`).toBe(true);
        stack.push(...(techNodeById(current)?.requires ?? []));
      }
      for (const child of techChildrenOf(node.id)) {
        expect(child).toBe(techNodeById(child.id));
      }
    }
    // 反向子节点关系与前置一致：T1.1 的两个直接后继。
    expect(techChildrenOf('tech:gear-manufacture').map((node) => node.id).sort()).toEqual([
      'tech:chute-logistics',
      'tech:cross-level-drive',
    ]);
    expect(techChildrenOf('tech:combined-works')).toEqual([]);
  });

  it('每个节点前置满足判定按「全部完成」语义工作', () => {
    const chute = techNodeById('tech:chute-logistics');
    expect(chute).toBeDefined();
    if (chute === undefined) return;
    expect(prerequisitesSatisfied(chute, new Set())).toBe(false);
    expect(prerequisitesSatisfied(chute, new Set(['tech:cross-level-drive']))).toBe(false);
    expect(prerequisitesSatisfied(chute, new Set(['tech:gear-manufacture']))).toBe(true);
    const assembly = techNodeById('tech:structure-assembly');
    expect(assembly).toBeDefined();
    if (assembly === undefined) return;
    expect(prerequisitesSatisfied(assembly, new Set(['tech:split-merge']))).toBe(false);
    expect(
      prerequisitesSatisfied(assembly, new Set(['tech:split-merge', 'tech:flywheel-production'])),
    ).toBe(true);
  });

  it('每个节点交付材料非空、物品存在、数量为正整数且不重复', () => {
    for (const node of TECH_NODES) {
      expect(node.cost.length, node.id).toBeGreaterThan(0);
      const itemIds = new Set<string>();
      for (const entry of node.cost) {
        expect(getItemDefinition(entry.itemId as never), `${node.id}/${entry.itemId}`).toBeDefined();
        expect(Number.isInteger(entry.count), `${node.id}/${entry.itemId}`).toBe(true);
        expect(entry.count).toBeGreaterThan(0);
        itemIds.add(entry.itemId);
      }
      expect(itemIds.size).toBe(node.cost.length);
      expect(totalCostCount(node)).toBeGreaterThan(0);
    }
    expect(totalCostCount(techNodeById('tech:combined-works') as TechNodeDef)).toBe(16);
    expect(totalCostCount(techNodeById('tech:gear-manufacture') as TechNodeDef)).toBe(5);
  });

  it('每个节点至少解锁一项，解锁目标在真实目录中存在', () => {
    const resolvers = createCatalogResolvers();
    const unlockKinds = new Set<string>();
    for (const node of TECH_NODES) {
      expect(node.unlocks.length, node.id).toBeGreaterThan(0);
      for (const unlock of node.unlocks) {
        unlockKinds.add(unlock.kind);
        switch (unlock.kind) {
          case 'recipe':
            expect(resolvers.recipeExists(unlock.id), `${node.id} recipe ${unlock.id}`).toBe(true);
            break;
          case 'machine':
            expect(resolvers.partExists(unlock.id), `${node.id} machine ${unlock.id}`).toBe(true);
            break;
          case 'port':
            expect(resolvers.portExists(unlock.id), `${node.id} port ${unlock.id}`).toBe(true);
            break;
          case 'structure':
            expect(resolvers.structureExists(unlock.id), `${node.id} structure ${unlock.id}`).toBe(true);
            break;
          case 'capability':
            expect(typeof unlock.id).toBe('string');
            break;
          case 'project':
            expect(unlock.id).toBe('combined-works');
            break;
        }
      }
    }
    expect([...unlockKinds].sort()).toEqual([
      'capability',
      'machine',
      'port',
      'project',
      'recipe',
      'structure',
    ]);
    // 结构框架同时是「可放置零件」与「结构模块」，两个门控目标都必须显式登记。
    const assemblyUnlocks = techNodeById('tech:structure-assembly')?.unlocks ?? [];
    expect(assemblyUnlocks).toContainEqual({ kind: 'machine', id: 'structure_frame' });
    expect(assemblyUnlocks).toContainEqual({ kind: 'structure', id: 'structure.frame' });
  });

  it('解锁的能力集合完整且无重复（E1 六项）', () => {
    expect(capabilitiesOf()).toEqual([
      'port-input-install',
      'port-output-install',
      'material-link',
      'split-merge',
      'assembly',
      'line-diagnostics',
    ]);
    expect(new Set(capabilitiesOf()).size).toBe(6);
    // 只统计传入子集的解锁。
    expect(capabilitiesOf([techNodeById('tech:line-integration') as TechNodeDef])).toEqual([
      'line-diagnostics',
    ]);
  });
});

describe('E0 依赖规则：阶段不跳跃', () => {
  it('阶段 N 的前置只能是阶段 N-1 或 N；阶段 1 只能阶段 1', () => {
    for (const node of TECH_NODES) {
      for (const requirement of node.requires) {
        const target = techNodeById(requirement);
        expect(target, `${node.id} -> ${requirement}`).toBeDefined();
        if (target === undefined) continue;
        const allowed = node.stage === 1 ? [1] : [node.stage - 1, node.stage];
        expect(allowed, `${node.id}(stage ${node.stage}) -> ${target.id}(stage ${target.stage})`).toContain(
          target.stage,
        );
      }
    }
    // 两条跨路线/跨阶段的前置被真实数据验证。
    expect(techNodeById('tech:line-integration')?.requires).toEqual([
      'tech:structure-assembly',
      'tech:batch-processing',
    ]);
    expect(techNodeById('tech:combined-works')?.requires).toEqual(['tech:line-integration']);
  });
});

describe('校验器对坏数据逐一报出对应 code', () => {
  it('重复 ID', () => {
    const issues = validateAfter((nodes) => {
      nodes[1] = { ...nodes[0], stage: 1, route: 'industry', requires: [], unlocks: [] };
    });
    expect(codesOf(issues)).toContain('duplicate-id');
    expect(issues.find((issue) => issue.code === 'duplicate-id')?.nodeId).toBe('tech:gear-manufacture');
  });

  it('自依赖', () => {
    expect(codesOf(validateAfter((nodes) => { nodes[0].requires = ['tech:gear-manufacture']; })))
      .toContain('self-dependency');
  });

  it('循环依赖', () => {
    const issues = validateAfter((nodes) => {
      nodes[0].requires = ['tech:cross-level-drive'];
    });
    expect(codesOf(issues)).toContain('dependency-cycle');
    expect(issues.find((issue) => issue.code === 'dependency-cycle')?.detail).toContain('cycle:');
  });

  it('未知前置', () => {
    const issues = validateAfter((nodes) => {
      nodes[1].requires = ['tech:does-not-exist'];
    });
    expect(codesOf(issues)).toContain('unknown-precondition');
    expect(issues.find((issue) => issue.code === 'unknown-precondition')?.detail).toContain('tech:does-not-exist');
  });

  it('无效成本（非正整数）', () => {
    const issues = validateAfter((nodes) => {
      nodes[0].cost[0].count = 0;
    });
    expect(codesOf(issues)).toContain('invalid-cost');
    expect(issues.find((issue) => issue.code === 'invalid-cost')?.nodeId).toBe('tech:gear-manufacture');
  });

  it('未知物品', () => {
    const issues = validateAfter((nodes) => {
      nodes[0].cost[0].itemId = 'unobtainium';
    });
    expect(codesOf(issues)).toContain('unknown-item');
    expect(issues.find((issue) => issue.code === 'unknown-item')?.detail).toContain('unobtainium');
  });

  it('重复成本物品', () => {
    expect(codesOf(validateAfter((nodes) => {
      nodes[0].cost.push({ itemId: nodes[0].cost[0].itemId, count: 1 });
    }))).toContain('duplicate-cost-item');
  });

  it('重复解锁目标', () => {
    const issues = validateAfter((nodes) => {
      nodes[1].unlocks.push({ kind: 'recipe', id: 'forge-gear-12' });
    });
    expect(codesOf(issues)).toContain('duplicate-unlock');
    expect(issues.find((issue) => issue.code === 'duplicate-unlock')?.detail).toContain('tech:gear-manufacture');
  });

  it('未知解锁目标', () => {
    expect(codesOf(validateAfter((nodes) => {
      nodes[0].unlocks.push({ kind: 'recipe', id: 'forge-does-not-exist' });
    }))).toContain('unknown-unlock');
  });

  it('阶段跳跃（阶段 3 直接依赖阶段 1）', () => {
    const issues = validateAfter((nodes) => {
      nodes[9].requires = ['tech:gear-manufacture'];
    });
    expect(codesOf(issues)).toContain('stage-jump');
    expect(issues.find((issue) => issue.code === 'stage-jump')?.nodeId).toBe('tech:batch-processing');
  });

  it('非法 ID 格式', () => {
    const issues = validateAfter((nodes) => {
      nodes[0].id = 'gear-manufacture';
    });
    expect(codesOf(issues)).toContain('invalid-id');
    expect(issues.find((issue) => issue.code === 'invalid-id')?.detail).toContain('gear-manufacture');
  });

  it('缺失阶段', () => {
    const nodes = cloneNodes().filter((node) => node.stage !== 3);
    const issues = validateTechTree(nodes as unknown as TechNodeDef[], createCatalogResolvers(), 9);
    expect(codesOf(issues)).toContain('missing-stage');
    expect(issues.find((issue) => issue.code === 'missing-stage')?.detail).toContain('stage 3');
  });

  it('节点数量不符', () => {
    const issues = validateAfter((nodes) => {
      nodes.push({ ...nodes[0], id: 'tech:extra-node', requires: [], unlocks: [] });
    });
    expect(codesOf(issues)).toEqual(['node-count']);
    expect(issues[0]?.detail).toContain('expected 12 nodes, received 13');
  });

  it('assertValidTechTree 对坏数据抛 RangeError（消息含 code 与节点）', () => {
    const nodes = cloneNodes();
    nodes[0].requires = ['tech:gear-manufacture'];
    expect(() => assertValidTechTree(nodes as unknown as TechNodeDef[], createCatalogResolvers()))
      .toThrowError(/tech tree validation failed/);
    try {
      assertValidTechTree(nodes as unknown as TechNodeDef[], createCatalogResolvers());
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError);
      expect((error as RangeError).message).toContain('[self-dependency] tech:gear-manufacture');
    }
  });
});
