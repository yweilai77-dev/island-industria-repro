/**
 * M2.0-P2-E1 科技解锁索引与门控查询（纯函数，零引擎依赖）。
 *
 * 索引由节点数据的 unlocks 派生，**不手写第二份解锁清单**。
 * 门控语义：
 * - 配方：只有已解锁的配方参与「能否加工 / R 能否切到」；
 * - 机器/结构/接口盒：未解锁时不可放置、不可安装；
 * - 能力：未解锁时热键无效（J/H 建链、K/L 安装、P 结构模式等）。
 * legacy 兼容模式（仅旧验收脚本）把一切视为已解锁。
 */
import { TECH_NODES } from './nodes.ts';
import type {
  TechCapabilityId,
  TechNodeDef,
  TechState,
} from './types.ts';

export interface TechGateIndex {
  readonly recipeToNode: ReadonlyMap<string, string>;
  readonly partToNode: ReadonlyMap<string, string>;
  readonly portToNode: ReadonlyMap<string, string>;
  readonly structureToNode: ReadonlyMap<string, string>;
  readonly capabilityToNode: ReadonlyMap<string, string>;
  readonly projectToNode: ReadonlyMap<string, string>;
}

/** 从节点定义构建解锁索引（同一目标只允许被一个节点解锁，校验器保证）。 */
export function buildGateIndex(nodes: readonly TechNodeDef[] = TECH_NODES): TechGateIndex {
  const recipeToNode = new Map<string, string>();
  const partToNode = new Map<string, string>();
  const portToNode = new Map<string, string>();
  const structureToNode = new Map<string, string>();
  const capabilityToNode = new Map<string, string>();
  const projectToNode = new Map<string, string>();
  for (const node of nodes) {
    for (const unlock of node.unlocks) {
      const map = unlock.kind === 'recipe' ? recipeToNode
        : unlock.kind === 'machine' ? partToNode
          : unlock.kind === 'port' ? portToNode
            : unlock.kind === 'structure' ? structureToNode
              : unlock.kind === 'capability' ? capabilityToNode : projectToNode;
      map.set(unlock.id, node.id);
    }
  }
  return { recipeToNode, partToNode, portToNode, structureToNode, capabilityToNode, projectToNode };
}

/** 内置索引（节点数据固定，构建一次）。 */
export const TECH_GATE_INDEX: TechGateIndex = buildGateIndex();

/**
 * 从开局就允许放置的机械零件（起步包里真实发放、或开发调试件）。
 * 机器的「获取」由配方门控负责；放置资格只对科技新增的结构模块等生效，
 * 避免玩家拿到合法持有的起步设备却放不下去。
 */
export const STARTER_PART_IDS: ReadonlySet<string> = new Set([
  'shaft', 'gear_12', 'gear_24', 'chute', 'vertical_drive',
  'flywheel_source', 'crusher', 'smelter', 'forge', 'machine', 'power_source',
]);

/** 通用查询：目标是否已由某个已完成节点解锁。 */
function unlockedIn(
  map: ReadonlyMap<string, string>,
  completed: ReadonlySet<string>,
  id: string,
): boolean {
  const nodeId = map.get(id);
  return nodeId !== undefined && completed.has(nodeId);
}

/**
 * 开局即解锁的基础配方（阶段 0 教学链：破碎 / 熔炼 / 锻传动轴）。
 * 科技树只解锁「新增能力」，不能把教学订单依赖的基础配方锁掉。
 */
export const BASE_RECIPE_IDS: ReadonlySet<string> = new Set([
  'crush-iron-ore',
  'smelt-crushed-ore',
  'forge-shaft',
]);

export function isRecipeUnlocked(
  state: TechState,
  completed: ReadonlySet<string>,
  recipeId: string,
  index: TechGateIndex = TECH_GATE_INDEX,
): boolean {
  if (state.mode === 'legacy') return true;
  if (BASE_RECIPE_IDS.has(recipeId)) return true;
  return unlockedIn(index.recipeToNode, completed, recipeId);
}

export function isPartUnlocked(
  state: TechState,
  completed: ReadonlySet<string>,
  partId: string,
  index: TechGateIndex = TECH_GATE_INDEX,
): boolean {
  if (state.mode === 'legacy') return true;
  if (STARTER_PART_IDS.has(partId)) return true;
  return unlockedIn(index.partToNode, completed, partId);
}

export function isPortUnlocked(
  state: TechState,
  completed: ReadonlySet<string>,
  portModuleId: string,
  index: TechGateIndex = TECH_GATE_INDEX,
): boolean {
  if (state.mode === 'legacy') return true;
  return unlockedIn(index.portToNode, completed, portModuleId);
}

export function isStructureUnlocked(
  state: TechState,
  completed: ReadonlySet<string>,
  structureId: string,
  index: TechGateIndex = TECH_GATE_INDEX,
): boolean {
  if (state.mode === 'legacy') return true;
  return unlockedIn(index.structureToNode, completed, structureId);
}

export function hasCapability(
  state: TechState,
  completed: ReadonlySet<string>,
  capability: TechCapabilityId,
  index: TechGateIndex = TECH_GATE_INDEX,
): boolean {
  if (state.mode === 'legacy') return true;
  return unlockedIn(index.capabilityToNode, completed, capability);
}

/** 项目（终局）是否解锁。 */
export function isProjectUnlocked(
  state: TechState,
  completed: ReadonlySet<string>,
  projectId: string,
  index: TechGateIndex = TECH_GATE_INDEX,
): boolean {
  if (state.mode === 'legacy') return true;
  return unlockedIn(index.projectToNode, completed, projectId);
}
