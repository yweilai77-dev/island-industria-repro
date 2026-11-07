import type { Cell } from '../grid/grid.ts';
import type { Level } from '../spatial/space.ts';

/** build 插件的稳定系统名：grid-overlay 通过它声明后置依赖。 */
export const BUILD_SYSTEM_NAME = 'island-industria/build';
/** build 每帧写给 grid-overlay 的建造目标状态。 */
export const BUILD_TARGET_STATE_KEY = 'IslandIndustriaBuildTarget';

export interface BuildTargetState {
  /** 是否存在有效的目标支撑位置。 */
  readonly active: boolean;
  readonly cell?: Cell;
  readonly level?: Level;
  readonly baseY?: number;
  /** 当前 Placement 是否通过建造合法性检查；active=false 时无意义。 */
  readonly valid?: boolean;
}
