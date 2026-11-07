import { describe, expect, it } from 'vitest';
import { createPlacement, type Rotation } from '../grid/grid.ts';
import { MECHANICAL_PART_DEFS, type MechanicalPart, type PartId } from '../mechanical/parts.ts';
import { buildConnections, type Connection } from '../mechanical/ports.ts';
import { buildPowerTopology, solvePower } from '../mechanical/power.ts';

function part(
  id: number,
  defId: PartId,
  gx: number,
  gz: number,
  rotation: Rotation = 0,
  level = 0,
): MechanicalPart {
  return {
    id,
    def: MECHANICAL_PART_DEFS[defId],
    placement: createPlacement(gx, gz, 1, 1, rotation, level),
  };
}

/** 按无序零件对找连接。 */
function connectionBetween(
  connections: readonly Connection[],
  aPartId: number,
  bPartId: number,
): Connection | undefined {
  return connections.find(
    (connection) => (connection.aPartId === aPartId && connection.bPartId === bPartId)
      || (connection.aPartId === bPartId && connection.bPartId === aPartId),
  );
}

/** 取一条连接在指定零件一侧的端口 id。 */
function portOf(connection: Connection, partId: number): string {
  return connection.aPartId === partId ? connection.aPortId : connection.bPortId;
}

/** 与指定零件相连的所有零件 id。 */
function linkedPartIds(connections: readonly Connection[], partId: number): number[] {
  return connections
    .filter((connection) => connection.aPartId === partId || connection.bPartId === partId)
    .map((connection) => (connection.aPartId === partId ? connection.bPartId : connection.aPartId))
    .sort((a, b) => a - b);
}

describe('M1.8-A cross-level vertical drive', () => {
  it('connects a level-0 shaft to the drive bottom and a level-1 shaft to the drive top', () => {
    const parts = [
      part(1, 'power_source', -2, 0, 0, 0),
      part(2, 'shaft', -1, 0, 0, 0),
      part(3, 'vertical_drive', 0, 0, 0, 0),
      part(4, 'shaft', 1, 0, 0, 1),
      part(5, 'crusher', 2, 0, 0, 1),
    ];
    const connections = buildConnections(parts);

    // 水平段: 动力源 → level 0 轴。
    expect(connectionBetween(connections, 1, 2)?.kind).toBe('axial');

    // 跨层下段: level 0 轴 ↔ 立式传动带底部端口。
    const lower = connectionBetween(connections, 2, 3);
    expect(lower).toBeDefined();
    expect(lower!.kind).toBe('axial');
    expect(portOf(lower!, 3)).toBe('bottom');

    // 跨层上段: 立式传动带顶部端口 ↔ level 1 轴。
    const upper = connectionBetween(connections, 3, 4);
    expect(upper).toBeDefined();
    expect(upper!.kind).toBe('axial');
    expect(portOf(upper!, 3)).toBe('top');

    // level 1 水平段: 轴 → 破碎机。
    expect(connectionBetween(connections, 4, 5)?.kind).toBe('axial');

    const topology = buildPowerTopology(parts, connections, 1);
    expect(topology.components).toHaveLength(1);
    expect(topology.components[0]?.partIds).toEqual([1, 2, 3, 4, 5]);
    expect(topology.components[0]?.machineIds).toEqual([5]);
    expect(topology.components[0]?.sourceIds).toEqual([1]);
  });

  it('powers the level-1 machine only while the source is on', () => {
    const parts = [
      part(1, 'power_source', -2, 0, 0, 0),
      part(2, 'shaft', -1, 0, 0, 0),
      part(3, 'vertical_drive', 0, 0, 0, 0),
      part(4, 'shaft', 1, 0, 0, 1),
      part(5, 'crusher', 2, 0, 0, 1),
    ];
    const connections = buildConnections(parts);
    const topology = buildPowerTopology(parts, connections, 1);

    const on = solvePower(topology, parts, new Set([1]));
    expect(on.components[0]?.status).toBe('powered');
    expect(on.poweredMachines.has(5)).toBe(true);
    expect(on.omegaByPart.get(5) ?? 0).not.toBe(0);
    // 整条链（含跨层那根立式传动带）都在转。
    expect(on.omegaByPart.get(3) ?? 0).not.toBe(0);
    expect(on.omegaByPart.get(4) ?? 0).not.toBe(0);
    // 源容量 100、破碎机负载 18 → 速度因子 0.82。
    expect(on.speedFactorByComponent.get(0)).toBeCloseTo(0.82, 12);

    const off = solvePower(topology, parts, new Set());
    expect(off.poweredMachines.has(5)).toBe(false);
    expect(off.omegaByPart.size).toBe(0);
  });

  it('chains stacked vertical drives level over level', () => {
    // 顶部端口在 (gx+1, 3L+3.5)，下一层底部端口在 (gx', 3(L+1)+0.5)：
    // 两者重合要求 gx' = gx+1，因此一条竖直传动链每升一层就向 +X 偏一格。
    const parts = [
      part(10, 'vertical_drive', 0, 0, 0, 0),
      part(11, 'vertical_drive', 1, 0, 0, 1),
      part(12, 'vertical_drive', 2, 0, 0, 2),
    ];
    const connections = buildConnections(parts);
    expect(connections).toHaveLength(2);
    expect(connections.every((connection) => connection.kind === 'axial')).toBe(true);

    const first = connectionBetween(connections, 10, 11);
    expect(first).toBeDefined();
    expect(portOf(first!, 10)).toBe('top');
    expect(portOf(first!, 11)).toBe('bottom');

    const second = connectionBetween(connections, 11, 12);
    expect(second).toBeDefined();
    expect(portOf(second!, 11)).toBe('top');
    expect(portOf(second!, 12)).toBe('bottom');

    const topology = buildPowerTopology(parts, connections, 1);
    expect(topology.components).toHaveLength(1);
    expect(topology.components[0]?.partIds).toEqual([10, 11, 12]);
    // 没有动力源 → 结构上连通但 idle。
    expect(topology.components[0]?.status).toBe('idle');
  });

  it('does not link two vertical drives placed in the SAME cell on adjacent levels', () => {
    // 源码几何：level L 顶部端口在 (gx+1, 3L+3.5)，level L+1 同格底部端口在 (gx, 3L+3.5)。
    // 锚点差一格 → 同格叠放不会成链（与任务书「同格叠放自动成链」的说法不符，已列入报告）。
    const sameCell = [
      part(20, 'vertical_drive', 0, 0, 0, 0),
      part(21, 'vertical_drive', 0, 0, 0, 1),
    ];
    expect(buildConnections(sameCell)).toHaveLength(0);
  });

  it('stops the level-1 machine after the vertical drive is removed', () => {
    const parts = [
      part(1, 'power_source', -2, 0, 0, 0),
      part(2, 'shaft', -1, 0, 0, 0),
      part(3, 'vertical_drive', 0, 0, 0, 0),
      part(4, 'shaft', 1, 0, 0, 1),
      part(5, 'crusher', 2, 0, 0, 1),
    ];
    // 拆除前：正常供电。
    const before = buildPowerTopology(parts, buildConnections(parts), 1);
    expect(solvePower(before, parts, new Set([1])).poweredMachines.has(5)).toBe(true);

    // 拆除跨层传动带后按剩余零件重建：整条链断成两个组件。
    const withoutDrive = parts.filter((piece) => piece.id !== 3);
    const connectionsAfter = buildConnections(withoutDrive);
    expect(connectionBetween(connectionsAfter, 2, 4)).toBeUndefined();
    expect(connectionsAfter).toHaveLength(2);

    const after = buildPowerTopology(withoutDrive, connectionsAfter, 2);
    expect(after.components).toHaveLength(2);
    const solution = solvePower(after, withoutDrive, new Set([1]));
    expect(solution.poweredMachines.has(5)).toBe(false);
    expect(solution.omegaByPart.has(5)).toBe(false);
  });

  it('only accepts shafts at (gx-1, level 0) and (gx+1, level 1)', () => {
    const parts = [
      part(1, 'vertical_drive', 0, 0, 0, 0),
      // 正确：同层 (-1, 0) 接底部。
      part(2, 'shaft', -1, 0, 0, 0),
      // 正确：上一层 (+1, 0) 接顶部。
      part(3, 'shaft', 1, 0, 0, 1),
      // 错误：同层 (+1, 0) 高度不匹配。
      part(4, 'shaft', 1, 0, 0, 0),
      // 错误：上一层 (-1, 0) 高度不匹配。
      part(5, 'shaft', -1, 0, 0, 1),
      // 错误：同格 level 0 / level 1。
      part(6, 'shaft', 0, 0, 0, 0),
      part(7, 'shaft', 0, 0, 0, 1),
      // 错误：远处同层。
      part(8, 'shaft', 5, 5, 0, 1),
    ];
    const connections = buildConnections(parts);
    expect(linkedPartIds(connections, 1)).toEqual([2, 3]);

    const lower = connectionBetween(connections, 1, 2);
    expect(lower).toBeDefined();
    expect(portOf(lower!, 1)).toBe('bottom');
    const upper = connectionBetween(connections, 1, 3);
    expect(upper).toBeDefined();
    expect(portOf(upper!, 1)).toBe('top');
  });
});
