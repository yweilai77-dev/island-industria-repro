/**
 * P2-D 结构模块放置模式 / 目标的 World 资源键。
 *
 * 与 `build/target.ts`、`build/floors.ts` 的既有键同样的用法：
 * - 资源存在 = 结构放置模式激活；其它输入系统（build / mechanical / ports）据此让出输入；
 * - 目标资源只读投影给唯一 GameRead 与验收脚本，不是给测试开后门（真正放置仍走真实鼠标与合法性校验）。
 */

export const STRUCTURE_MODE_KEY = 'IslandIndustriaStructureMode';
export const STRUCTURE_TARGET_STATE_KEY = 'IslandIndustriaStructureTarget';

export interface StructureModeState {
  readonly active: boolean;
}

export interface StructureTargetState {
  readonly active: boolean;
  readonly cell: { readonly gx: number; readonly gz: number } | null;
  readonly level: number | null;
  readonly valid: boolean;
  /** 不可放置原因（可读，便于验收与调试）：not-adjacent / occupied / no-item / unsupported。 */
  readonly reason: string | null;
}
