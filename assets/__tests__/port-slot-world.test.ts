import { describe, expect, it } from 'vitest';
import { createPlacement, type Rotation } from '../grid/grid.ts';
import { coreForPart } from '../industrial/catalog.ts';
import {
  MOUNT_OFFSET,
  feedsSlotFrom,
  incomingDirectionOf,
  slotWorldOf,
} from '../industrial/port-slot-world.ts';
import { MECHANICAL_PART_DEFS, type MechanicalPart, type PartId } from '../mechanical/parts.ts';
import { chuteDirectionOf } from '../production/transport.ts';

/**
 * P2-B 安装位的世界空间：稳定 ID、面、朝向、旋转后的位置。
 *
 * 关键点：安装位坐标不是另写一套几何，而是复用 `portWorld` 派生；
 * 这些用例把「哪个方向能喂进来」和「旋转后锚点在哪」钉死。
 */

function machine(defId: PartId, gx: number, gz: number, rotation: Rotation = 0): MechanicalPart {
  const def = MECHANICAL_PART_DEFS[defId];
  return { id: 1, def, placement: createPlacement(gx, gz, def.w, def.d, rotation, 0) };
}

describe('安装位世界坐标', () => {
  it('输入位在 -Z 面：锚点落在机器 -Z 表面中心，盒子向面外偏移', () => {
    const crusher = machine('crusher', 2, 3, 0);
    const core = coreForPart('crusher');
    const input = core?.portSlots.find((slot) => slot.role === 'input');
    expect(input?.id).toBe('slot.crusher.in.nz');
    const world = slotWorldOf(crusher, input!);
    expect(world.anchor).toEqual([2.5, 0.5, 3.0]);
    expect(world.outward).toEqual([0, 0, -1]);
    expect(world.center).toEqual([2.5, 0.5, 3.0 - MOUNT_OFFSET]);
    expect(world.yaw).toBe(0);
  });

  it('输出位在 +X 面：与运行时推料方向一致', () => {
    const smelter = machine('smelter', 2, 3, 0);
    const output = coreForPart('smelter')?.portSlots.find((slot) => slot.role === 'output');
    expect(output?.id).toBe('slot.smelter.out.px');
    const world = slotWorldOf(smelter, output!);
    expect(world.anchor).toEqual([3.0, 0.5, 3.5]);
    expect(world.outward).toEqual([1, 0, 0]);
  });

  it('旋转 90° 后安装位锚点、法线与朝向一起更新', () => {
    const forge = machine('forge', 2, 3, 90);
    const input = coreForPart('forge')?.portSlots.find((slot) => slot.role === 'input');
    const world = slotWorldOf(forge, input!);
    expect(world.anchor).toEqual([2.0, 0.5, 3.5]);
    expect(world.outward).toEqual([-1, 0, 0]);
    expect(world.center).toEqual([2.0 - MOUNT_OFFSET, 0.5, 3.5]);
    expect(world.yaw).toBe(90);
  });

  it('四个旋转方向都给出唯一且自洽的锚点', () => {
    const input = coreForPart('crusher')?.portSlots.find((slot) => slot.role === 'input')!;
    const anchors = ([0, 90, 180, 270] as const).map((rotation) =>
      slotWorldOf(machine('crusher', 5, 5, rotation), input).anchor.join(','));
    expect(new Set(anchors).size).toBe(4);
  });
});

describe('物料进入方向（溜槽必须正对安装位的面）', () => {
  it('输入位 -Z 面在 rotation=0 时要求物料沿 +Z 进入', () => {
    const input = coreForPart('crusher')?.portSlots.find((slot) => slot.role === 'input')!;
    expect(incomingDirectionOf(input, 0)).toEqual({ dx: 0, dz: 1 });
    expect(feedsSlotFrom(input, 0, { dx: 0, dz: 1 })).toBe(true);
    expect(feedsSlotFrom(input, 0, { dx: 0, dz: -1 })).toBe(false);
    expect(feedsSlotFrom(input, 0, { dx: 1, dz: 0 })).toBe(false);
  });

  it('四个旋转方向下，恰好有一个溜槽朝向能喂进来', () => {
    const input = coreForPart('crusher')?.portSlots.find((slot) => slot.role === 'input')!;
    const expected: Record<number, { dx: number; dz: number }> = {
      0: { dx: 0, dz: 1 },
      90: { dx: 1, dz: 0 },
      180: { dx: 0, dz: -1 },
      270: { dx: -1, dz: 0 },
    };
    for (const rotation of [0, 90, 180, 270] as const) {
      expect(incomingDirectionOf(input, rotation)).toEqual(expected[rotation]);
      let matches = 0;
      for (const chuteRotation of [0, 90, 180, 270] as const) {
        if (feedsSlotFrom(input, rotation, chuteDirectionOf(chuteRotation))) matches += 1;
      }
      expect(matches).toBe(1);
    }
  });

  it('竖直面不会被误判为可接溜槽的方向', () => {
    const input = coreForPart('crusher')?.portSlots.find((slot) => slot.role === 'input')!;
    const vertical = { ...input, face: 'py' as const };
    expect(incomingDirectionOf(vertical, 0)).toEqual({ dx: 0, dz: 0 });
    expect(feedsSlotFrom(vertical, 0, { dx: 0, dz: 0 })).toBe(false);
  });
});
