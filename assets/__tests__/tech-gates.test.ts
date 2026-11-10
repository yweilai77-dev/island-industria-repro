import { describe, expect, it } from 'vitest';
import { completedSetOf, createTechState, restoreTechState } from '../tech/state.ts';
import {
  BASE_RECIPE_IDS,
  STARTER_PART_IDS,
  TECH_GATE_INDEX,
  buildGateIndex,
  hasCapability,
  isPartUnlocked,
  isPortUnlocked,
  isProjectUnlocked,
  isRecipeUnlocked,
  isStructureUnlocked,
  type TechGateIndex,
} from '../tech/gates.ts';
import { TECH_NODES } from '../tech/nodes.ts';
import type { TechCapabilityId, TechState } from '../tech/types.ts';

/**
 * P2-E1 科技门控测试（任务书 §六）：
 * 解锁索引与节点数据一致、五类目标（配方/机器/接口盒/结构/能力）+ 终局项目的
 * 「未解锁 false / 完成后 true / legacy 全放行 / 未知目标 false」。
 */

const GEAR = 'tech:gear-manufacture';
const CHUTE = 'tech:chute-logistics';
const INPUT = 'tech:input-interface';
const OUTPUT = 'tech:output-interface';
const SPLIT = 'tech:split-merge';
const FLYWHEEL = 'tech:flywheel-production';
const STRUCTURE = 'tech:structure-assembly';
const BATCH = 'tech:batch-processing';
const LINE = 'tech:line-integration';
const COMBINED = 'tech:combined-works';

/** 用合法前置闭包造状态；legacy 模式用于「全部放行」断言。 */
function stateWithUnlocked(ids: readonly string[], mode: 'player' | 'legacy' = 'player'): TechState {
  const outcome = restoreTechState({ version: 1, mode, delivered: {}, unlocked: [...ids], trackedId: null });
  expect(outcome.issues).toEqual([]);
  return outcome.state;
}

function completed(state: TechState): ReadonlySet<string> {
  return completedSetOf(state);
}

/** 全部节点 ID（合法闭包）。 */
const ALL_NODES = TECH_NODES.map((node) => node.id);
/** 除 structure-assembly 及其后继外的全部节点：T2.5 的门控边界。 */
const BEFORE_ASSEMBLY = ALL_NODES.filter((id) => id !== STRUCTURE && id !== LINE && id !== COMBINED);

const INDEX_MAPS: readonly (readonly [string, (index: TechGateIndex) => ReadonlyMap<string, string>])[] = [
  ['recipe', (index) => index.recipeToNode],
  ['machine', (index) => index.partToNode],
  ['port', (index) => index.portToNode],
  ['structure', (index) => index.structureToNode],
  ['capability', (index) => index.capabilityToNode],
  ['project', (index) => index.projectToNode],
];

describe('buildGateIndex 与节点数据一致', () => {
  it('每个 unlock 都能反查到唯一的解锁节点，且索引大小等于数据条目数', () => {
    const fresh = buildGateIndex();
    for (const [kind, mapOf] of INDEX_MAPS) {
      const expected = new Map<string, string>();
      for (const node of TECH_NODES) {
        for (const unlock of node.unlocks) {
          if (unlock.kind !== kind) continue;
          expect(expected.has(unlock.id), `duplicate ${kind}:${unlock.id}`).toBe(false);
          expected.set(unlock.id, node.id);
          expect(mapOf(fresh).get(unlock.id), `${kind}:${unlock.id}`).toBe(node.id);
          expect(mapOf(TECH_GATE_INDEX).get(unlock.id)).toBe(node.id);
        }
      }
      expect(new Map(mapOf(fresh))).toEqual(expected);
    }
    expect(fresh.recipeToNode.size).toBe(16);
    expect(fresh.partToNode.size).toBe(1);
    expect(fresh.portToNode.size).toBe(4);
    expect(fresh.structureToNode.size).toBe(1);
    expect(fresh.capabilityToNode.size).toBe(6);
    expect(fresh.projectToNode.size).toBe(1);
  });

  it('索引里没有节点数据之外的条目（反向闭包）', () => {
    for (const [kind, mapOf] of INDEX_MAPS) {
      for (const [targetId, nodeId] of mapOf(TECH_GATE_INDEX)) {
        const node = TECH_NODES.find((entry) => entry.id === nodeId);
        expect(node, `${kind}:${targetId} -> ${nodeId}`).toBeDefined();
        expect(node?.unlocks).toContainEqual({ kind, id: targetId });
      }
    }
  });

  it('只索引传入的节点子集（不跨节点污染）', () => {
    const gear = TECH_NODES.find((node) => node.id === GEAR);
    expect(gear).toBeDefined();
    if (gear === undefined) return;
    const index = buildGateIndex([gear]);
    expect(index.recipeToNode.size).toBe(2);
    expect(index.recipeToNode.get('forge-gear-12')).toBe(GEAR);
    expect(index.recipeToNode.get('forge-chute')).toBeUndefined();
    expect(index.partToNode.size).toBe(0);
    expect(index.portToNode.size).toBe(0);
    expect(index.structureToNode.size).toBe(0);
    expect(index.capabilityToNode.size).toBe(0);
    expect(index.projectToNode.size).toBe(0);
  });
});

describe('配方门控 isRecipeUnlocked', () => {
  it('未解锁时 false，完成对应节点后 true；阶段 0 基础配方开局即放行', () => {
    expect([...BASE_RECIPE_IDS].sort()).toEqual(['crush-iron-ore', 'forge-shaft', 'smelt-crushed-ore']);
    const empty = createTechState();
    expect(isRecipeUnlocked(empty, completed(empty), 'forge-gear-12')).toBe(false);
    expect(isRecipeUnlocked(empty, completed(empty), 'forge-gear-24')).toBe(false);
    expect(isRecipeUnlocked(empty, completed(empty), 'forge-chute')).toBe(false);
    expect(isRecipeUnlocked(empty, completed(empty), 'forge-output-box')).toBe(false);
    // 基础配方不属于任何科技节点，但教学链需要它们开局可用。
    for (const baseRecipe of BASE_RECIPE_IDS) {
      expect(isRecipeUnlocked(empty, completed(empty), baseRecipe), baseRecipe).toBe(true);
      expect(TECH_GATE_INDEX.recipeToNode.get(baseRecipe)).toBeUndefined();
    }
    expect(isRecipeUnlocked(empty, completed(empty), 'forge-does-not-exist')).toBe(false);

    const afterGear = stateWithUnlocked([GEAR]);
    expect(isRecipeUnlocked(afterGear, completed(afterGear), 'forge-gear-12')).toBe(true);
    expect(isRecipeUnlocked(afterGear, completed(afterGear), 'forge-gear-24')).toBe(true);
    expect(isRecipeUnlocked(afterGear, completed(afterGear), 'forge-chute')).toBe(false);

    const afterChute = stateWithUnlocked([GEAR, CHUTE]);
    expect(isRecipeUnlocked(afterChute, completed(afterChute), 'forge-chute')).toBe(true);
  });

  it('legacy 模式全部放行（包括不存在的配方）', () => {
    const legacy = createTechState('legacy');
    for (const id of ['forge-gear-12', 'forge-chute', 'forge-shaft', 'crush-iron-ore', 'forge-does-not-exist']) {
      expect(isRecipeUnlocked(legacy, completed(legacy), id), id).toBe(true);
    }
  });

  it('不存在的解锁目标返回 false', () => {
    const all = stateWithUnlocked(ALL_NODES);
    expect(isRecipeUnlocked(all, completed(all), 'forge-does-not-exist')).toBe(false);
  });
});

describe('零件/机器门控 isPartUnlocked', () => {
  it('STARTER_PART_IDS 精确覆盖起步包与调试件，未完成任何节点也放行', () => {
    expect([...STARTER_PART_IDS].sort()).toEqual([
      'chute',
      'crusher',
      'flywheel_source',
      'forge',
      'gear_12',
      'gear_24',
      'machine',
      'power_source',
      'shaft',
      'smelter',
      'vertical_drive',
    ]);
    const empty = createTechState();
    for (const partId of STARTER_PART_IDS) {
      expect(isPartUnlocked(empty, completed(empty), partId), partId).toBe(true);
    }
    expect(isPartUnlocked(empty, completed(empty), 'structure_frame')).toBe(false);
    expect(isPartUnlocked(empty, completed(empty), 'not_a_part')).toBe(false);
  });

  it('structure_frame 未完成 tech:structure-assembly 时 false，完成后 true', () => {
    const before = stateWithUnlocked(BEFORE_ASSEMBLY);
    expect(isPartUnlocked(before, completed(before), 'structure_frame')).toBe(false);

    const after = stateWithUnlocked([...BEFORE_ASSEMBLY, STRUCTURE]);
    expect(isPartUnlocked(after, completed(after), 'structure_frame')).toBe(true);
  });

  it('legacy 模式全部放行', () => {
    const legacy = createTechState('legacy');
    for (const partId of ['structure_frame', 'shaft', 'unknown_part']) {
      expect(isPartUnlocked(legacy, completed(legacy), partId), partId).toBe(true);
    }
  });
});

describe('接口盒门控 isPortUnlocked', () => {
  it('4 种接口盒分别由对应节点解锁', () => {
    const empty = createTechState();
    for (const portId of ['port.through', 'port.output', 'port.splitter', 'port.merger', 'port.unknown']) {
      expect(isPortUnlocked(empty, completed(empty), portId), portId).toBe(false);
    }

    const input = stateWithUnlocked([GEAR, CHUTE, INPUT]);
    expect(isPortUnlocked(input, completed(input), 'port.through')).toBe(true);
    expect(isPortUnlocked(input, completed(input), 'port.output')).toBe(false);

    const output = stateWithUnlocked([GEAR, CHUTE, INPUT, OUTPUT]);
    expect(isPortUnlocked(output, completed(output), 'port.output')).toBe(true);
    expect(isPortUnlocked(output, completed(output), 'port.splitter')).toBe(false);

    const split = stateWithUnlocked([GEAR, CHUTE, INPUT, OUTPUT, SPLIT]);
    expect(isPortUnlocked(split, completed(split), 'port.splitter')).toBe(true);
    expect(isPortUnlocked(split, completed(split), 'port.merger')).toBe(true);
    expect(isPortUnlocked(split, completed(split), 'port.unknown')).toBe(false);
  });

  it('legacy 模式全部放行', () => {
    const legacy = createTechState('legacy');
    expect(isPortUnlocked(legacy, completed(legacy), 'port.unknown')).toBe(true);
  });
});

describe('结构模块门控 isStructureUnlocked', () => {
  it('structure.frame 未完成 tech:structure-assembly 时 false，完成后 true', () => {
    const empty = createTechState();
    expect(isStructureUnlocked(empty, completed(empty), 'structure.frame')).toBe(false);
    expect(isStructureUnlocked(empty, completed(empty), 'structure.unknown')).toBe(false);

    const before = stateWithUnlocked(BEFORE_ASSEMBLY);
    expect(isStructureUnlocked(before, completed(before), 'structure.frame')).toBe(false);

    const after = stateWithUnlocked([...BEFORE_ASSEMBLY, STRUCTURE]);
    expect(isStructureUnlocked(after, completed(after), 'structure.frame')).toBe(true);
    expect(isStructureUnlocked(after, completed(after), 'structure.unknown')).toBe(false);
  });

  it('legacy 模式全部放行', () => {
    const legacy = createTechState('legacy');
    expect(isStructureUnlocked(legacy, completed(legacy), 'structure.frame')).toBe(true);
    expect(isStructureUnlocked(legacy, completed(legacy), 'structure.unknown')).toBe(true);
  });
});

describe('能力门控 hasCapability', () => {
  it('未解锁时全 false，完成对应节点后逐项 true', () => {
    const empty = createTechState();
    const all: TechCapabilityId[] = [
      'port-input-install',
      'port-output-install',
      'material-link',
      'split-merge',
      'assembly',
      'line-diagnostics',
    ];
    for (const capability of all) {
      expect(hasCapability(empty, completed(empty), capability), capability).toBe(false);
    }

    const input = stateWithUnlocked([GEAR, CHUTE, INPUT]);
    expect(hasCapability(input, completed(input), 'port-input-install')).toBe(true);
    expect(hasCapability(input, completed(input), 'port-output-install')).toBe(false);

    const output = stateWithUnlocked([GEAR, CHUTE, INPUT, OUTPUT]);
    expect(hasCapability(output, completed(output), 'port-output-install')).toBe(true);
    expect(hasCapability(output, completed(output), 'material-link')).toBe(true);
    expect(hasCapability(output, completed(output), 'split-merge')).toBe(false);

    const split = stateWithUnlocked([GEAR, CHUTE, INPUT, OUTPUT, SPLIT]);
    expect(hasCapability(split, completed(split), 'split-merge')).toBe(true);

    const beforeAssembly = stateWithUnlocked(BEFORE_ASSEMBLY);
    expect(hasCapability(beforeAssembly, completed(beforeAssembly), 'assembly')).toBe(false);
    expect(hasCapability(beforeAssembly, completed(beforeAssembly), 'line-diagnostics')).toBe(false);

    const assembly = stateWithUnlocked([...BEFORE_ASSEMBLY, STRUCTURE]);
    expect(hasCapability(assembly, completed(assembly), 'assembly')).toBe(true);
    expect(hasCapability(assembly, completed(assembly), 'line-diagnostics')).toBe(false);

    const line = stateWithUnlocked([...BEFORE_ASSEMBLY, STRUCTURE, LINE]);
    expect(hasCapability(line, completed(line), 'line-diagnostics')).toBe(true);
    expect(hasCapability(line, completed(line), 'unknown-capability' as TechCapabilityId)).toBe(false);
  });

  it('legacy 模式全部放行', () => {
    const legacy = createTechState('legacy');
    expect(hasCapability(legacy, completed(legacy), 'assembly')).toBe(true);
    expect(hasCapability(legacy, completed(legacy), 'unknown-capability' as TechCapabilityId)).toBe(true);
  });
});

describe('终局项目门控 isProjectUnlocked', () => {
  it('combined-works 只在完成 tech:combined-works 后解锁', () => {
    const empty = createTechState();
    expect(isProjectUnlocked(empty, completed(empty), 'combined-works')).toBe(false);
    expect(isProjectUnlocked(empty, completed(empty), 'unknown-project')).toBe(false);

    const withoutFinal = stateWithUnlocked(ALL_NODES.filter((id) => id !== COMBINED));
    expect(isProjectUnlocked(withoutFinal, completed(withoutFinal), 'combined-works')).toBe(false);

    const all = stateWithUnlocked(ALL_NODES);
    expect(isProjectUnlocked(all, completed(all), 'combined-works')).toBe(true);
    expect(isProjectUnlocked(all, completed(all), 'unknown-project')).toBe(false);
  });

  it('legacy 模式全部放行', () => {
    const legacy = createTechState('legacy');
    expect(isProjectUnlocked(legacy, completed(legacy), 'combined-works')).toBe(true);
    expect(isProjectUnlocked(legacy, completed(legacy), 'unknown-project')).toBe(true);
  });
});
