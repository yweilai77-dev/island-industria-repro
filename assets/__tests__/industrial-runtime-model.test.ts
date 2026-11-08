import { describe, expect, it } from 'vitest';
import { createPlacement } from '../grid/grid.ts';
import { coreForPart } from '../industrial/catalog.ts';
import type { PortModuleId } from '../industrial/ids.ts';
import {
  createAssembly,
  machineEntityOf,
  materialLinkBetween,
  portInstanceOf,
  validateMaterialLink,
  validatePortInstance,
  type PortEndpoint,
} from '../industrial/runtime-model.ts';
import { MECHANICAL_PART_DEFS, type MechanicalPart, type PartId } from '../mechanical/parts.ts';

/**
 * M2.0-P2-A 运行时类型：只读投影、身份复用、静态/运行时分离、校验函数。
 *
 * 这一层**没有**运行时系统（不安装接口、不传物料、不管理组合机械），
 * 所以这里测的是「类型投影与校验规则」，不是玩法行为。
 */

function part(id: number, defId: PartId): MechanicalPart {
  const def = MECHANICAL_PART_DEFS[defId];
  return {
    id,
    def,
    placement: createPlacement(id, 0, def.w, def.d, 0, 0),
  };
}

const CRUSHER = coreForPart('crusher');
const SMELTER = coreForPart('smelter');

describe('MachineEntity 投影', () => {
  it('加工机器投影出机器实体，身份复用 MechanicalPart.id', () => {
    for (const defId of ['crusher', 'smelter', 'forge'] as const) {
      const source = part(7, defId);
      const entity = machineEntityOf(source);
      expect(entity).toBeDefined();
      expect(entity?.entityId).toBe(7);
      expect(typeof entity?.entityId).toBe('number');
      expect(entity?.coreId).toBe(`core.${defId}`);
      expect(entity?.ports).toEqual([]);
      expect(entity?.assemblyId).toBeNull();
    }
  });

  it('非加工机器（轴/齿轮/动力源/溜槽/冲压机原型）返回 undefined', () => {
    for (const defId of ['shaft', 'gear_12', 'power_source', 'chute', 'machine'] as const) {
      expect(machineEntityOf(part(3, defId))).toBeUndefined();
    }
  });

  it('MachineEntity 不携带加工状态与动力状态字段', () => {
    const entity = machineEntityOf(part(1, 'crusher'));
    expect(entity).toBeDefined();
    const runtimeOnly = ['progress', 'inputItem', 'inputCount', 'outputItem', 'outputCount', 'running', 'block', 'rpm', 'omega', 'stalled', 'def'];
    for (const field of runtimeOnly) expect(field in (entity as object)).toBe(false);
  });

  it('placement 是复制值，不与 registry 内部对象共享引用', () => {
    const source = part(2, 'smelter');
    const before = { ...source.placement };
    const entity = machineEntityOf(source);
    expect(entity?.placement).not.toBe(source.placement);
    expect(entity?.placement).toEqual(before);
    (entity as { placement: { gx: number } }).placement.gx = 999;
    expect(source.placement.gx).toBe(before.gx);
  });

  it('每次投影都是新的运行时对象（可变），不是静态定义', () => {
    const source = part(4, 'forge');
    const first = machineEntityOf(source);
    const second = machineEntityOf(source);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(false);
  });
});

describe('接口实例与物料连接校验', () => {
  it('接口实例键是 <entityId>:<slotId>', () => {
    expect(portInstanceOf(7, { slotId: 'slot.crusher.in.nz', moduleId: 'port.through' }))
      .toBe('7:slot.crusher.in.nz');
  });

  it('直通盒可装在输入位与输出位；分流盒只能输出位；合流盒只能输入位', () => {
    expect(validatePortInstance(CRUSHER!, { slotId: 'slot.crusher.in.nz', moduleId: 'port.through' })).toBeNull();
    expect(validatePortInstance(CRUSHER!, { slotId: 'slot.crusher.out.px', moduleId: 'port.through' })).toBeNull();
    expect(validatePortInstance(CRUSHER!, { slotId: 'slot.crusher.out.px', moduleId: 'port.splitter' })).toBeNull();
    expect(validatePortInstance(CRUSHER!, { slotId: 'slot.crusher.in.nz', moduleId: 'port.splitter' })).not.toBeNull();
    expect(validatePortInstance(CRUSHER!, { slotId: 'slot.crusher.in.nz', moduleId: 'port.merger' })).toBeNull();
    expect(validatePortInstance(CRUSHER!, { slotId: 'slot.crusher.out.px', moduleId: 'port.merger' })).not.toBeNull();
  });

  it('未知安装位与未知接口盒被拒绝', () => {
    expect(validatePortInstance(CRUSHER!, { slotId: 'slot.smelter.in.nz', moduleId: 'port.through' })).not.toBeNull();
    expect(validatePortInstance(CRUSHER!, { slotId: 'slot.crusher.in.nz', moduleId: 'port.ghost' as PortModuleId })).not.toBeNull();
  });

  it('物料连接：output → input 合法，反向 / 自连 / 未知位被拒绝', () => {
    const crusherOut: PortEndpoint = { entityId: 1, slotId: 'slot.crusher.out.px' };
    const smelterIn: PortEndpoint = { entityId: 2, slotId: 'slot.smelter.in.nz' };
    const link = materialLinkBetween(crusherOut, smelterIn);
    expect(link.id).toBe('link:1:slot.crusher.out.px->2:slot.smelter.in.nz');
    expect(validateMaterialLink(link, CRUSHER!, SMELTER!)).toBeNull();

    const reversed = materialLinkBetween(smelterIn, crusherOut);
    expect(validateMaterialLink(reversed, SMELTER!, CRUSHER!)).not.toBeNull();

    const selfLink = materialLinkBetween(crusherOut, { entityId: 1, slotId: 'slot.crusher.in.nz' });
    expect(validateMaterialLink(selfLink, CRUSHER!, CRUSHER!)).not.toBeNull();

    const unknownSlot = materialLinkBetween(crusherOut, { entityId: 2, slotId: 'slot.crusher.in.nz' });
    expect(validateMaterialLink(unknownSlot, CRUSHER!, SMELTER!)).not.toBeNull();
  });
});

describe('Assembly 只维护成员关系', () => {
  it('成员唯一时构造成功，保留顺序副本', () => {
    const members = [3, 1, 2];
    const assembly = createAssembly('assembly:1', members);
    expect(assembly.id).toBe('assembly:1');
    expect(assembly.memberIds).toEqual(members);
    expect(assembly.memberIds).not.toBe(members);
  });

  it('空成员与重复成员被拒绝', () => {
    expect(() => createAssembly('assembly:2', [])).toThrow(RangeError);
    expect(() => createAssembly('assembly:3', [5, 5])).toThrow(RangeError);
  });
});
