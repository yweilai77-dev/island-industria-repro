import { describe, expect, it } from 'vitest';
import { createPlacement, type Rotation } from '../grid/grid.ts';
import { coreForPart } from '../industrial/catalog.ts';
import { MaterialLinkRuntime, type LinkScene } from '../industrial/link-runtime.ts';
import { PortRuntime } from '../industrial/port-runtime.ts';
import type { PortSlotId } from '../industrial/ids.ts';
import { MECHANICAL_PART_DEFS, type MechanicalPart, type PartId } from '../mechanical/parts.ts';

/**
 * P2-C 物料连接运行时：建立规则、端口对接、数量上限、失效与恢复、读投影。
 * 全部为纯逻辑测试，不启动引擎。
 */

function part(id: number, defId: PartId, gx: number, gz: number, rotation: Rotation = 0): MechanicalPart {
  const def = MECHANICAL_PART_DEFS[defId];
  return { id, def, placement: createPlacement(gx, gz, def.w, def.d, rotation, 0) };
}

const CRUSHER = coreForPart('crusher')!;
const SMELTER = coreForPart('smelter')!;
const CRUSHER_OUT = 'slot.crusher.out.px' as PortSlotId;
const CRUSHER_IN = 'slot.crusher.in.nz' as PortSlotId;
const SMELTER_IN = 'slot.smelter.in.nz' as PortSlotId;

interface Rig {
  readonly parts: readonly MechanicalPart[];
  readonly ports: PortRuntime;
  readonly links: MaterialLinkRuntime;
  scene(): LinkScene;
  partOf(partId: number): MechanicalPart;
}

/** 直接对接布局：破碎机(0,0) 朝 0°（输出 px → +X），熔炼炉(1,0) 朝 90°（输入 nz → -X）。 */
function dockedRig(): Rig {
  const parts = [part(1, 'crusher', 0, 0, 0), part(2, 'smelter', 1, 0, 90)];
  const ports = new PortRuntime();
  ports.install(1, CRUSHER, CRUSHER_OUT, 'port.output');
  ports.install(2, SMELTER, SMELTER_IN, 'port.through');
  return {
    parts,
    ports,
    links: new MaterialLinkRuntime(),
    partOf: (partId) => parts.find((entry) => entry.id === partId)!,
    scene: () => ({
      partOf: (partId) => parts.find((entry) => entry.id === partId),
      portOf: (partId, slotId) => ports.get(partId, slotId),
    }),
  };
}

const FROM = { entityId: 1, slotId: CRUSHER_OUT };
const TO = { entityId: 2, slotId: SMELTER_IN };

describe('连接建立：端口与方向', () => {
  it('输出接口 → 相邻且正对的输入接口：建立成功，ID 稳定规范', () => {
    const rig = dockedRig();
    const result = rig.links.create(FROM, TO, rig.scene());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.link.id).toBe('link:1:slot.crusher.out.px->2:slot.smelter.in.nz');
    expect(rig.links.all()).toHaveLength(1);
  });

  it('自连、反向、未知机器、未装接口盒都被拒绝', () => {
    const rig = dockedRig();
    expect(rig.links.create(FROM, { entityId: 1, slotId: CRUSHER_IN }, rig.scene()))
      .toEqual({ ok: false, reason: 'self-link' });
    expect(rig.links.create(TO, FROM, rig.scene()))
      .toEqual({ ok: false, reason: 'wrong-role' });
    expect(rig.links.create({ entityId: 99, slotId: CRUSHER_OUT }, TO, rig.scene()))
      .toEqual({ ok: false, reason: 'missing-part' });
    // 输入位没装盒时不能作为连接端点。
    const noBox = dockedRig();
    noBox.ports.remove(2, SMELTER_IN);
    expect(noBox.links.create(FROM, TO, noBox.scene()))
      .toEqual({ ok: false, reason: 'missing-port' });
  });

  it('直通接口必须端口对接：不相邻 / 隔一格 / 背对都拒绝', () => {
    const parts = [
      part(1, 'crusher', 0, 0, 0),
      part(2, 'smelter', 1, 0, 0), // 输入 nz 朝 -Z，背对上游
      part(3, 'smelter', 3, 0, 90), // 距离 2 格
    ];
    const ports = new PortRuntime();
    ports.install(1, CRUSHER, CRUSHER_OUT, 'port.output');
    ports.install(2, SMELTER, SMELTER_IN, 'port.through');
    ports.install(3, SMELTER, SMELTER_IN, 'port.through');
    const links = new MaterialLinkRuntime();
    const scene: LinkScene = {
      partOf: (partId) => parts.find((entry) => entry.id === partId),
      portOf: (partId, slotId) => ports.get(partId, slotId),
    };
    expect(links.create(FROM, TO, scene)).toEqual({ ok: false, reason: 'not-adjacent' });
    expect(links.create(FROM, { entityId: 3, slotId: SMELTER_IN }, scene))
      .toEqual({ ok: false, reason: 'not-adjacent' });
  });

  it('重复连接被拒绝，且数量受接口盒输出口限制', () => {
    const rig = dockedRig();
    expect(rig.links.create(FROM, TO, rig.scene()).ok).toBe(true);
    expect(rig.links.create(FROM, TO, rig.scene()))
      .toEqual({ ok: false, reason: 'duplicate-link' });
    expect(rig.links.create(FROM, { entityId: 2, slotId: SMELTER_IN }, rig.scene()))
      .toEqual({ ok: false, reason: 'duplicate-link' });
  });

  it('直通盒一个输出口只能连一条：第二条被拒绝', () => {
    const rig = dockedRig();
    const second = part(3, 'smelter', 2, 0, 90);
    const parts = [...rig.parts, second];
    rig.ports.install(3, SMELTER, SMELTER_IN, 'port.through');
    const scene: LinkScene = {
      partOf: (partId) => parts.find((entry) => entry.id === partId),
      portOf: (partId, slotId) => rig.ports.get(partId, slotId),
    };
    expect(rig.links.create(FROM, TO, scene).ok).toBe(true);
    expect(rig.links.create(FROM, { entityId: 3, slotId: SMELTER_IN }, scene))
      .toEqual({ ok: false, reason: 'from-port-full' });
  });
});

describe('分流 / 合流的近距定向对接', () => {
  it('分流盒可连两个下游：相邻对接 + 2m 内定向；超出 2m 拒绝', () => {
    const parts = [
      part(1, 'crusher', 0, 0, 0),
      part(2, 'smelter', 1, 0, 90),
      part(3, 'smelter', 2, 0, 90),
      part(4, 'smelter', 3, 0, 90),
    ];
    const ports = new PortRuntime();
    ports.install(1, CRUSHER, CRUSHER_OUT, 'port.splitter');
    for (const id of [2, 3, 4]) ports.install(id, SMELTER, SMELTER_IN, 'port.through');
    const links = new MaterialLinkRuntime();
    const scene: LinkScene = {
      partOf: (partId) => parts.find((entry) => entry.id === partId),
      portOf: (partId, slotId) => ports.get(partId, slotId),
    };
    expect(links.create(FROM, { entityId: 2, slotId: SMELTER_IN }, scene).ok).toBe(true);
    expect(links.create(FROM, { entityId: 3, slotId: SMELTER_IN }, scene).ok).toBe(true);
    // 第三个下游虽然几何可行，但分流盒只有 2 个输出口。
    expect(links.create(FROM, { entityId: 4, slotId: SMELTER_IN }, scene))
      .toEqual({ ok: false, reason: 'from-port-full' });
  });

  it('合流盒可接两路上游：正对的一路对接，偏 45° 的一路定向成立', () => {
    const parts = [
      part(1, 'crusher', 0, -1, 270), // 输出 px → +Z，正对下游输入
      part(2, 'crusher', -1, -1, 0), // 输出 px → +X，偏 45°
      part(3, 'smelter', 0, 0, 0),
    ];
    const ports = new PortRuntime();
    ports.install(1, CRUSHER, CRUSHER_OUT, 'port.through');
    ports.install(2, CRUSHER, CRUSHER_OUT, 'port.through');
    ports.install(3, SMELTER, SMELTER_IN, 'port.merger');
    const links = new MaterialLinkRuntime();
    const scene: LinkScene = {
      partOf: (partId) => parts.find((entry) => entry.id === partId),
      portOf: (partId, slotId) => ports.get(partId, slotId),
    };
    expect(links.create({ entityId: 1, slotId: CRUSHER_OUT }, { entityId: 3, slotId: SMELTER_IN }, scene).ok)
      .toBe(true);
    expect(links.create({ entityId: 2, slotId: CRUSHER_OUT }, { entityId: 3, slotId: SMELTER_IN }, scene).ok)
      .toBe(true);
    // 合流盒输入口上限 2。
    expect(links.countTo(3, SMELTER_IN)).toBe(2);
  });

  it('合流：上游背对下游时定向检查拒绝', () => {
    const parts = [
      part(1, 'crusher', -1, 0, 0), // 输出 px → +X，指向 +X，但下游在 +X 侧？下游输入朝 -Z，方向不符
      part(3, 'smelter', 0, 0, 0),
    ];
    const ports = new PortRuntime();
    ports.install(1, CRUSHER, CRUSHER_OUT, 'port.through');
    ports.install(3, SMELTER, SMELTER_IN, 'port.merger');
    const links = new MaterialLinkRuntime();
    const scene: LinkScene = {
      partOf: (partId) => parts.find((entry) => entry.id === partId),
      portOf: (partId, slotId) => ports.get(partId, slotId),
    };
    const result = links.create({ entityId: 1, slotId: CRUSHER_OUT }, { entityId: 3, slotId: SMELTER_IN }, scene);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['wrong-facing', 'out-of-reach']).toContain(result.reason);
  });
});

describe('失效与恢复', () => {
  it('旋转下游核心会断开几何对接，转回后恢复', () => {
    const parts = [part(1, 'crusher', 0, 0, 0), part(2, 'smelter', 1, 0, 90)];
    const ports = new PortRuntime();
    ports.install(1, CRUSHER, CRUSHER_OUT, 'port.output');
    ports.install(2, SMELTER, SMELTER_IN, 'port.through');
    const links = new MaterialLinkRuntime();
    const scene: LinkScene = {
      partOf: (partId) => parts.find((entry) => entry.id === partId),
      portOf: (partId, slotId) => ports.get(partId, slotId),
    };
    expect(links.create(FROM, TO, scene).ok).toBe(true);
    expect(links.snapshot(scene)[0]).toMatchObject({ active: true, status: 'ok' });

    const rotated: MechanicalPart = { ...parts[1]!, placement: { ...parts[1]!.placement, rotation: 0 } };
    const rotatedScene: LinkScene = {
      partOf: (partId) => (partId === 2 ? rotated : parts.find((entry) => entry.id === partId)),
      portOf: (partId, slotId) => ports.get(partId, slotId),
    };
    expect(links.snapshot(rotatedScene)[0]).toMatchObject({ active: false, status: 'inactive-geometry' });
    // 连接没有丢，转回去就恢复。
    expect(links.snapshot(scene)[0]).toMatchObject({ active: true, status: 'ok' });
  });

  it('拆掉输入接口盒：连接保留为失效；重装后恢复', () => {
    const rig = dockedRig();
    expect(rig.links.create(FROM, TO, rig.scene()).ok).toBe(true);
    rig.ports.remove(2, SMELTER_IN);
    expect(rig.links.snapshot(rig.scene())[0]).toMatchObject({
      active: false,
      status: 'inactive-missing-port',
    });
    expect(rig.ports.install(2, SMELTER, SMELTER_IN, 'port.through')).toEqual({ ok: true });
    expect(rig.links.snapshot(rig.scene())[0]).toMatchObject({ active: true, status: 'ok' });
  });

  it('机器被拆掉：连接被清理；拆掉的连接不留下任何物料（料只在接口盒缓冲里）', () => {
    const rig = dockedRig();
    expect(rig.links.create(FROM, TO, rig.scene()).ok).toBe(true);
    expect(rig.links.sync(new Set([1]))).toBe(1);
    expect(rig.links.all()).toHaveLength(0);
  });

  it('removeAt 解开一个端口上的全部连接', () => {
    const rig = dockedRig();
    rig.links.create(FROM, TO, rig.scene());
    expect(rig.links.removeAt(1, CRUSHER_OUT)).toBe(1);
    expect(rig.links.all()).toHaveLength(0);
    expect(rig.links.removeAt(1, CRUSHER_OUT)).toBe(0);
  });
});

describe('读投影', () => {
  it('snapshot 是纯 JSON：稳定 ID、两端、容量、状态、累计传递数', () => {
    const rig = dockedRig();
    rig.links.create(FROM, TO, rig.scene());
    const snapshot = rig.links.snapshot(rig.scene());
    expect(snapshot).toEqual([
      {
        id: 'link:1:slot.crusher.out.px->2:slot.smelter.in.nz',
        from: { entityId: 1, slotId: CRUSHER_OUT },
        to: { entityId: 2, slotId: SMELTER_IN },
        capacity: 1,
        active: true,
        status: 'ok',
        moved: 0,
      },
    ]);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot as never);
  });
});
