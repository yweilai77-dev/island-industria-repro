import { describe, expect, it } from 'vitest';
import {
  CELL_SIZE,
  cellsOf,
  createPlacement,
  type Rotation,
} from '../grid/grid.ts';
import { aabbIntersects, levelBaseY } from '../spatial/space.ts';
import { SupportRegistry, TraversalRegistry } from '../spatial/support.ts';
import { stairWorldBounds } from '../spatial/structures.ts';
import {
  DECK_THICKNESS,
  OPENING_RIM_THICKNESS,
  PILLAR_HEIGHT,
  STAIR_RUN_CELLS,
  STAIR_STEP_COUNT,
  STAIR_STEP_RISE,
  STAIR_STEP_RUN,
  deckSupportVerdict,
  floorAabb,
  floorTopSupport,
  floorTraversal,
  openingRimBoxes,
  stairDirectionOf,
  stairOriginCell,
  stairStepBoxes,
  type FloorSupportQuery,
} from '../build/floors.ts';

/** cellsOf(placement) 覆盖的格范围 → 世界矩形（半开区间取外沿）。 */
function worldRectOfCells(placement: ReturnType<typeof createPlacement>): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const cells = cellsOf(placement);
  const xs = cells.map((cell) => cell.gx);
  const zs = cells.map((cell) => cell.gz);
  return {
    minX: Math.min(...xs) * CELL_SIZE,
    maxX: (Math.max(...xs) + 1) * CELL_SIZE,
    minZ: Math.min(...zs) * CELL_SIZE,
    maxZ: (Math.max(...zs) + 1) * CELL_SIZE,
  };
}

describe('M1.8-A floor geometry', () => {
  const level = 2;

  it('puts the pillar between 3L and 3L+2.7 and the deck between 3L+2.7 and 3L+3.0', () => {
    const placement = createPlacement(2, 3, 1, 1, 0, level);
    const pillar = floorAabb('pillar', placement);
    const deck = floorAabb('deck', placement);

    expect(pillar.min[1]).toBe(levelBaseY(level));
    expect(pillar.max[1]).toBe(levelBaseY(level) + PILLAR_HEIGHT);
    expect(pillar.min[1]).toBe(3 * level);
    expect(pillar.max[1]).toBeCloseTo(3 * level + 2.7, 12);

    expect(deck.min[1]).toBe(levelBaseY(level) + PILLAR_HEIGHT);
    expect(deck.max[1]).toBe(levelBaseY(level) + PILLAR_HEIGHT + DECK_THICKNESS);
    expect(deck.min[1]).toBeCloseTo(3 * level + 2.7, 12);
    expect(deck.max[1]).toBeCloseTo(3 * level + 3.0, 12);

    // 同格「支柱在下、楼板在上」只在边界贴合，不算相交。
    expect(pillar.max[1]).toBe(deck.min[1]);
    expect(aabbIntersects(pillar, deck)).toBe(false);
  });
});

describe('M1.8-A floor top supports', () => {
  const level = 1;
  const placement = createPlacement(4, 5, 1, 1, 0, level);

  it('exposes the deck top as a buildable + walkable surface on L+1', () => {
    const support = floorTopSupport('deck', 'support:deck:1', placement);
    expect(support).toBeDefined();
    expect(support?.level).toBe(level + 1);
    expect(support?.worldY).toBe(levelBaseY(level + 1));
    expect(support?.buildable).toBe(true);
    expect(support?.walkable).toBe(true);
    expect(support?.kind).toBe('deck');
    expect(support?.cells).toEqual(cellsOf(placement));

    // 标准层高，可被真实 SupportRegistry 接受。
    const registry = new SupportRegistry();
    expect(() => registry.register(support!)).not.toThrow();
    expect(registry.supportAt({ gx: 4, gz: 5 }, level + 1)?.id).toBe('support:deck:1');
  });

  it('exposes the opening top as buildable but NOT walkable', () => {
    const support = floorTopSupport('opening', 'support:opening:2', placement);
    expect(support).toBeDefined();
    expect(support?.level).toBe(level + 1);
    expect(support?.buildable).toBe(true);
    expect(support?.walkable).toBe(false);
    expect(support?.kind).toBe('opening');
  });

  it('has no top support for pillar and stair', () => {
    expect(floorTopSupport('pillar', 'x', placement)).toBeUndefined();
    expect(floorTopSupport('stair', 'y', placement)).toBeUndefined();
  });
});

describe('M1.8-A stair traversal', () => {
  it('conserves run/rise and registers with the real TraversalRegistry', () => {
    const level = 1;
    const placement = createPlacement(-2, 3, STAIR_RUN_CELLS, 1, 0, level);
    const traversal = floorTraversal('stair', 'traversal:stair:1', placement);
    expect(traversal).toBeDefined();

    expect(traversal!.levelLow).toBe(level);
    expect(traversal!.levelHigh).toBe(level + 1);
    expect(traversal!.stepCount * traversal!.stepRun).toBeCloseTo(
      traversal!.runLengthCells * CELL_SIZE,
      12,
    );
    expect(traversal!.stepCount * traversal!.stepRise).toBeCloseTo(
      traversal!.worldYHigh - traversal!.worldYLow,
      12,
    );
    expect(traversal!.worldYLow).toBe(levelBaseY(level));
    expect(traversal!.worldYHigh).toBe(levelBaseY(level + 1));

    const registry = new TraversalRegistry();
    expect(() => registry.register(traversal!)).not.toThrow();
    expect(registry.size).toBe(1);
    for (const cell of cellsOf(placement)) {
      expect(registry.atCell(cell).map((surface) => surface.id)).toContain(traversal!.id);
    }

    expect(floorTraversal('deck', 'nope', placement)).toBeUndefined();
  });

  it.each([
    [0, 'east', { gx: 2, gz: 3 }],
    [90, 'north', { gx: 2, gz: 6 }],
    [180, 'west', { gx: 5, gz: 3 }],
    [270, 'south', { gx: 2, gz: 3 }],
  ] as const)(
    'maps rotation %i to %s and keeps stair bounds on the placement footprint',
    (rotation, direction, originCell) => {
      const placement = createPlacement(2, 3, STAIR_RUN_CELLS, 1, rotation as Rotation, 2);
      expect(stairDirectionOf(placement)).toBe(direction);
      expect(stairOriginCell(placement)).toEqual(originCell);

      const traversal = floorTraversal('stair', `traversal:stair:rot-${rotation}`, placement);
      expect(traversal).toBeDefined();

      // stairWorldBounds 覆盖的矩形恰好等于 cellsOf(placement) 的包围盒。
      expect(stairWorldBounds(traversal!)).toEqual(worldRectOfCells(placement));
    },
  );

  it('builds 8 step boxes whose highest tread reaches 3L+3', () => {
    const level = 1;
    const boxes = stairStepBoxes(createPlacement(0, 0, STAIR_RUN_CELLS, 1, 0, level));
    expect(boxes).toHaveLength(STAIR_STEP_COUNT);

    const tops = boxes.map((box) => box.center[1] + box.size[1] / 2);
    expect(Math.max(...tops)).toBeCloseTo(levelBaseY(level) + levelBaseY(1), 12);
    expect(Math.max(...tops)).toBeCloseTo(levelBaseY(level) + 3, 12);

    // 每级水平长度与逐级升高一致。
    boxes.forEach((box, index) => {
      expect(box.size[0]).toBeCloseTo(STAIR_STEP_RUN, 12);
      expect(tops[index]).toBeCloseTo(levelBaseY(level) + (index + 1) * STAIR_STEP_RISE, 12);
    });
    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index]!.center[1]).toBeGreaterThan(boxes[index - 1]!.center[1]);
    }
  });
});

describe('M1.8-A deck support verdict', () => {
  const cell = { gx: 3, gz: 4 };
  const level = 1;

  it('passes when the same cell has a pillar', () => {
    const query: FloorSupportQuery = {
      hasPillar: (c, l) => c.gx === cell.gx && c.gz === cell.gz && l === level,
      hasBuildableSupport: () => {
        throw new Error('neighbour query must not run when the pillar exists');
      },
    };
    expect(deckSupportVerdict(cell, level, query)).toBe(true);
  });

  it('passes when only a single neighbouring cell at L+1 has buildable support', () => {
    const neighbours = [
      { gx: cell.gx + 1, gz: cell.gz },
      { gx: cell.gx - 1, gz: cell.gz },
      { gx: cell.gx, gz: cell.gz + 1 },
      { gx: cell.gx, gz: cell.gz - 1 },
    ];
    const targetWorldY = levelBaseY(level + 1);

    // 四个邻格逐个单独提供支撑，都能让楼板成立（悬挑规则）。
    for (const neighbour of neighbours) {
      const seen: { gx: number; gz: number; level: number; worldY: number }[] = [];
      const query: FloorSupportQuery = {
        hasPillar: () => false,
        hasBuildableSupport: (c, l, worldY) => {
          seen.push({ gx: c.gx, gz: c.gz, level: l, worldY });
          return c.gx === neighbour.gx
            && c.gz === neighbour.gz
            && l === level + 1
            && worldY === targetWorldY;
        },
      };

      expect(deckSupportVerdict(cell, level, query)).toBe(true);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((entry) => entry.level === level + 1 && entry.worldY === targetWorldY)).toBe(true);
      expect(seen).toContainEqual({ ...neighbour, level: level + 1, worldY: targetWorldY });
    }
  });

  it('fails when neither a pillar nor a neighbour support exists', () => {
    const query: FloorSupportQuery = {
      hasPillar: () => false,
      hasBuildableSupport: () => false,
    };
    expect(deckSupportVerdict(cell, level, query)).toBe(false);
  });
});

describe('M1.8-A opening rim', () => {
  it('draws 4 rim bars around an open hole', () => {
    const placement = createPlacement(1, 2, 1, 1, 0, 0);
    const boxes = openingRimBoxes(placement);
    expect(boxes).toHaveLength(4);

    const centerX = placement.gx + 0.5;
    const centerZ = placement.gz + 0.5;
    const rimY = levelBaseY(placement.level) + PILLAR_HEIGHT + DECK_THICKNESS / 2;

    for (const box of boxes) {
      const dx = box.center[0] - centerX;
      const dz = box.center[2] - centerZ;
      // 中心偏离格心：rim 贴着孔口外圈。
      expect(Math.abs(dx) + Math.abs(dz)).toBeGreaterThan(0);
      // 格心不在任何一根 rim 条内部 → 中间确实是洞。
      const coversCenter = Math.abs(dx) < box.size[0] / 2
        && Math.abs(dz) < box.size[2] / 2;
      expect(coversCenter).toBe(false);
      expect(box.center[1]).toBeCloseTo(rimY, 12);
    }

    // 两根沿 X、两根沿 Z，厚度都是 OPENING_RIM_THICKNESS。
    expect(boxes[0]!.size[2]).toBe(OPENING_RIM_THICKNESS);
    expect(boxes[1]!.size[2]).toBe(OPENING_RIM_THICKNESS);
    expect(boxes[2]!.size[0]).toBe(OPENING_RIM_THICKNESS);
    expect(boxes[3]!.size[0]).toBe(OPENING_RIM_THICKNESS);
  });
});
