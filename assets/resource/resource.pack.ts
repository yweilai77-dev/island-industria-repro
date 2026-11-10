import type { EntityHandle, World } from '@forgeax/engine/ecs';
import { createIcosahedronGeometry, createOctahedronGeometry } from '@forgeax/engine/geometry';
import { quat } from '@forgeax/engine/math';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { ChildOf, Name, Transform } from '@forgeax/engine/scene';
import { ok, type AssetHandle } from '@forgeax/engine/types';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import { normalizeResourceSlice } from '../save/save-schema.ts';
import { placementCenter } from '../grid/grid.ts';
import {
  IRON_ORE_MAX_AMOUNT,
  IRON_ORE_NODES,
  nodePlacement,
  type ResourceNode,
} from './resource.ts';

const ROCK_COLOR = [0.2, 0.19, 0.18, 1] as const;
const ORE_COLOR = [0.72, 0.26, 0.06, 1] as const;
const ORE_EMISSIVE = [0.5, 0.12, 0.02] as const;
const DEG = Math.PI / 180;
/** 枯竭后保留的小残堆缩放。 */
const DEPLETED_SCALE = 0.45;

const BIG_ROCK = { pos: [0, 0.3, 0] as const, scale: 1, yaw: 20 };
const SMALL_ROCKS = [
  { pos: [0.48, 0.14, 0.2] as const, scale: 0.55, yaw: 40 },
  { pos: [-0.42, 0.12, 0.34] as const, scale: 0.45, yaw: -25 },
  { pos: [0.1, 0.1, -0.5] as const, scale: 0.4, yaw: 70 },
];
const ORE_CHUNKS = [
  { pos: [0, 0.8, 0] as const, scale: 1.1, yaw: 15 },
  { pos: [0.5, 0.38, 0.2] as const, scale: 1.0, yaw: -30 },
  { pos: [-0.45, 0.32, 0.35] as const, scale: 0.95, yaw: 55 },
  { pos: [0.22, 0.3, -0.55] as const, scale: 0.9, yaw: 80 },
  { pos: [-0.3, 0.58, -0.32] as const, scale: 1.0, yaw: -60 },
];

function spawnPart(
  world: World,
  parent: EntityHandle,
  mesh: AssetHandle<'mesh'>,
  material: AssetHandle<'material'>,
  part: { readonly pos: readonly [number, number, number]; readonly scale: number; readonly yaw: number },
): EntityHandle {
  const q = quat.fromAxisAngle(quat.create(), [0, 1, 0], part.yaw * DEG);
  return world
    .spawn(
      {
        component: Transform,
        data: {
          pos: part.pos,
          scale: [part.scale, part.scale, part.scale],
          quat: [q[0] ?? 0, q[1] ?? 0, q[2] ?? 0, q[3] ?? 1],
        },
      },
      { component: ChildOf, data: { parent } },
      { component: MeshFilter, data: { assetHandle: mesh } },
      { component: MeshRenderer, data: { materials: [material] } },
    )
    .unwrap();
}

/**
 * 铁矿石资源节点插件：
 * - 一次性创建岩石/矿脉几何体与材质，多处矿复用；
 * - 每处矿 = 父实体（格中心）+ 岩石/矿脉子实体；
 * - 提供 resourceNodes 服务：储量、枯竭状态、动态阻挡、采集扣减；
 * - 不实现完整背包/加工/采集 UI（采集逻辑在 harvest 插件）。
 */
export const ironOreResource: Plugin = {
  name: 'island-industria/resource',
  inject: ['world', 'assets'],
  apply(ctx) {
    const world = ctx.world;
    const assets = ctx.assets;
    if (!assets) throw new Error('resource system requires the asset service');

    ctx.effect(function* () {
      const rockMesh = assets.create(
        createIcosahedronGeometry(0.55, 1, { normals: 'flat' }).unwrap(),
      ).unwrap();
      const smallRockMesh = assets.create(
        createIcosahedronGeometry(0.3, 0, { normals: 'flat' }).unwrap(),
      ).unwrap();
      const oreMesh = assets.create(
        createOctahedronGeometry(0.16, 0, { normals: 'flat' }).unwrap(),
      ).unwrap();
      const rockMaterial = assets.create(
        Materials.standard({ baseColor: [...ROCK_COLOR], metallic: 0.03, roughness: 0.95 }),
      ).unwrap();
      const oreMaterial = assets.create(
        Materials.standard({
          baseColor: [...ORE_COLOR],
          metallic: 0.15,
          roughness: 0.55,
          emissive: [...ORE_EMISSIVE],
          emissiveIntensity: 1.0,
        }),
      ).unwrap();
      yield () => {
        for (const handle of [rockMesh, smallRockMesh, oreMesh, rockMaterial, oreMaterial]) {
          assets.release(handle).unwrap();
        }
      };

      const nodes: ResourceNode[] = [];
      const oreChunkEntities = new Map<number, EntityHandle[]>();

      // 按储量更新矿点外观：整簇缩小；枯竭时移除橙色矿脉、只留小残堆。
      const applyVisual = (node: ResourceNode): void => {
        const ratio = Math.max(0, Math.min(1, node.amount / IRON_ORE_MAX_AMOUNT));
        const scale = node.depleted ? DEPLETED_SCALE : 0.55 + 0.45 * ratio;
        world
          .set(node.entity, Transform, { scale: [scale, scale, scale] })
          .unwrap();
        if (node.depleted) {
          for (const chunk of oreChunkEntities.get(node.id) ?? []) {
            world.despawn(chunk).unwrap();
          }
          oreChunkEntities.set(node.id, []);
        }
      };

      for (const spec of IRON_ORE_NODES) {
        const center = placementCenter(nodePlacement(spec));
        const root = world
          .spawn(
            { component: Transform, data: { pos: [center[0], 0, center[2]] } },
            { component: Name, data: { value: spec.displayName } },
          )
          .unwrap();
        yield () => world.despawn(root).unwrap(); // 子实体随 ChildOf 级联销毁

        spawnPart(world, root, rockMesh, rockMaterial, BIG_ROCK);
        for (const part of SMALL_ROCKS) spawnPart(world, root, smallRockMesh, rockMaterial, part);
        const chunks: EntityHandle[] = [];
        for (const part of ORE_CHUNKS) {
          chunks.push(spawnPart(world, root, oreMesh, oreMaterial, part));
        }
        oreChunkEntities.set(spec.id, chunks);

        const node: ResourceNode = {
          ...spec,
          entity: root,
          amount: IRON_ORE_MAX_AMOUNT,
          depleted: false,
        };
        nodes.push(node);
        applyVisual(node);
      }

      const service = {
        nodes,
        isCellBlocked: (cell: { gx: number; gz: number }) =>
          nodes.some((node) => !node.depleted
            && cell.gx >= node.gx && cell.gx < node.gx + node.w
            && cell.gz >= node.gz && cell.gz < node.gz + node.d),
        nodeAtCell: (cell: { gx: number; gz: number }) =>
          nodes.find((node) => !node.depleted
            && cell.gx >= node.gx && cell.gx < node.gx + node.w
            && cell.gz >= node.gz && cell.gz < node.gz + node.d),
        harvest: (nodeId: number, amount = 1) => {
          const node = nodes.find((candidate) => candidate.id === nodeId);
          if (node === undefined || node.depleted || node.amount <= 0) return undefined;
          const requested = Math.max(1, Math.floor(amount));
          const deducted = Math.min(requested, node.amount);
          if (deducted <= 0) return undefined;
          node.amount -= deducted;
          if (node.amount <= 0) {
            node.amount = 0;
            node.depleted = true;
          }
          applyVisual(node);
          return { deducted, remaining: node.amount };
        },
        snapshot: () => nodes
          .map((node) => ({ id: node.id, amount: node.amount, depleted: node.depleted }))
          .sort((a, b) => a.id - b.id),
        restore: (raw: unknown) => {
          const normalized = normalizeResourceSlice(raw);
          const issues = [...normalized.issues];
          let restored = 0;
          for (const record of normalized.value) {
            const node = nodes.find((candidate) => candidate.id === record.id);
            if (node === undefined) {
              issues.push('unknown resource node skipped: ' + record.id);
              continue;
            }
            node.amount = record.amount;
            node.depleted = record.amount <= 0;
            applyVisual(node);
            restored += 1;
          }
          return { restored, issues };
        },
      };
      yield ctx.provide('resourceNodes', service);
    }, 'island-industria/resource');
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.resource,
  name: 'ISLAND INDUSTRIA / Resource',
  plugins: true,
  build: () =>
    ok({
      'plugin/resource': {
        kind: 'plugin',
        module: { specifier: './resource.pack.ts', export: 'ironOreResource' },
      },
    }),
});