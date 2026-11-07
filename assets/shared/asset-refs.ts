import { AssetGuid } from '@forgeax/engine/pack/guid';
import { definePackageId } from '@forgeax/engine/pack/source';
import type { PackageId } from '@forgeax/engine/pack/source';
import type { AssetGuid as AssetGuidType } from '@forgeax/engine/types';

/** GUID 的文本形式（Pack 配置和 SceneEntity 组件字段里用字符串 GUID）。 */
export function guidText(value: AssetGuidType): string {
  return AssetGuid.format(value);
}

/** 由「包 ID + 源键」派生稳定 GUID：UUIDv5(packageId, sourceKey)。 */
export function assetGuid(packageId: PackageId, sourceKey: string): AssetGuidType {
  return AssetGuid.derive(packageId, sourceKey);
}

/** 每个 Pack 一个稳定包 ID，GUID 都从它派生，改包 ID 等于更换整套资产身份。 */
export const PACKAGE_IDS = Object.freeze({
  materials: definePackageId('019fbf00-4a00-7000-8000-000000000000'),
  geometry: definePackageId('019fbf00-4b00-7000-8000-000000000000'),
  scene: definePackageId('019fbf00-4c00-7000-8000-000000000000'),
  camera: definePackageId('019fbf00-4d00-7000-8000-000000000000'),
  gridOverlay: definePackageId('019fbf00-4e00-7000-8000-000000000000'),
  player: definePackageId('019fbf00-4f00-7000-8000-000000000000'),
  build: definePackageId('019fbf00-5000-7000-8000-000000000000'),
  resource: definePackageId('019fbf00-5100-7000-8000-000000000000'),
  harvest: definePackageId('019fbf00-5200-7000-8000-000000000000'),
  inventory: definePackageId('019fbf00-5300-7000-8000-000000000000'),
  // M1.4 前端 root 与 UI 桥接
  frontend: definePackageId('019fbf00-5400-7000-8000-000000000000'),
  hotbar: definePackageId('019fbf00-5500-7000-8000-000000000000'),
  gameUiBridge: definePackageId('019fbf00-5600-7000-8000-000000000000'),
  // M1.5-B 独立空间服务与固定结构
  spatial: definePackageId('019fbf00-5700-7000-8000-000000000000'),
  structures: definePackageId('019fbf00-5800-7000-8000-000000000000'),
  // M1.7-A 机械零件/端口/放置系统
  mechanical: definePackageId('019fbf00-5900-7000-8000-000000000000'),
});