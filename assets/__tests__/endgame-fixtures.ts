import {
  conditionsOf,
  type EndgameAssemblyView,
  type EndgameLinkView,
  type EndgameMachineView,
  type EndgameWorldView,
} from '../endgame/endgame.ts';
import type { TechSnapshot } from '../tech/types.ts';
import { restoreTechState, techSnapshotOf } from '../tech/state.ts';
import { TECH_NODES } from '../tech/nodes.ts';

/**
 * P2-E3 运行证明测试夹具（不是测试文件，不以 .test.ts 结尾）：
 * 用纯数据构造「真实世界读数」的最小形状，供条件逐条求值与窗口累积测试复用。
 */

export const t3NodeId = 'tech:combined-works';
export const allTechNodes: readonly string[] = TECH_NODES.map((node) => node.id);

export function machine(partId: number, producedTotal = 0, powered = false): EndgameMachineView {
  return { partId, producedTotal, powered };
}

export function link(fromPartId: number, toPartId: number, active = true): EndgameLinkView {
  return { fromPartId, toPartId, active };
}

export function assembly(id: string, memberIds: readonly number[]): EndgameAssemblyView {
  return { id, memberIds };
}

export function world(overrides: Partial<EndgameWorldView> = {}): EndgameWorldView {
  return {
    assemblies: [],
    machines: [],
    outputPortPartIds: [],
    links: [],
    ...overrides,
  };
}

/** 三条结构条件都满足的组合：3 台核心、2 台装输出盒、2 条 active 内部连接、2 台 powered。 */
export function readyWorld(): EndgameWorldView {
  return world({
    assemblies: [assembly('assembly:1', [1, 2, 3])],
    machines: [machine(1, 0, true), machine(2, 0, true), machine(3, 0, false)],
    outputPortPartIds: [1, 2],
    links: [link(1, 2), link(1, 3)],
  });
}

/** 除终局节点外前置全部完成的科技状态（终局节点 available）。 */
export function techStateWithDelivered(
  delivered: Record<string, Record<string, number>> = {},
): ReturnType<typeof restoreTechState> {
  return restoreTechState({
    version: 1,
    mode: 'player',
    delivered,
    unlocked: allTechNodes.filter((id) => id !== t3NodeId),
    trackedId: null,
  });
}

/** 条件 id → 本条条件（测试断言用）。 */
export function conditionsMap(view: EndgameWorldView, produced = 0) {
  return new Map(conditionsOf(view, produced).map((entry) => [entry.id, entry]));
}

/** 材料已全部交齐、节点尚未完成的 TechState（完成必须走 completeProjectNode）。 */
export function fullyDeliveredTechState() {
  return restoreTechState({
    version: 1,
    mode: 'player',
    delivered: {
      [t3NodeId]: {
        shaft: 6,
        interface_box: 3,
        output_interface_box: 1,
        splitter_box: 1,
        merger_box: 1,
        structure_frame: 3,
        vertical_drive: 1,
      },
    },
    unlocked: allTechNodes.filter((id) => id !== t3NodeId),
    trackedId: null,
  });
}

/** 材料已全部交齐（但项目节点尚未完成）的科技快照。 */
export function fullyDeliveredTech(): TechSnapshot {
  const state = techStateWithDelivered({
    [t3NodeId]: {
      shaft: 6,
      interface_box: 3,
      output_interface_box: 1,
      splitter_box: 1,
      merger_box: 1,
      structure_frame: 3,
      vertical_drive: 1,
    },
  });
  return techSnapshotOf(state.state);
}
