import type { AssemblySnapshot } from './assembly-runtime.ts';
import type { AssemblyId } from './ids.ts';

/**
 * M2.0-P2-D `assembly` 服务契约（只有类型 + 模块声明，没有实现）。
 *
 * 实现放在 `assembly.pack.ts`：插件每帧从真实零件推导组合关系并保留稳定 ID，
 * 只把**只读**快照暴露给唯一 GameRead 与其它系统；任何系统都不得通过本服务修改组合。
 */
export interface AssemblyService {
  /** 全部组合机械的只读快照（纯 JSON，按 Assembly ID 稳定排序）。 */
  snapshot(): readonly AssemblySnapshot[];
  /** 某零件（成员核心或结构模块）所属的组合机械。 */
  assemblyOf(partId: number): AssemblySnapshot | undefined;
  /** 当前（被选中零件所属的）组合机械 ID；没有选中或不在组合中为 undefined。 */
  selectedAssemblyId(): AssemblyId | undefined;
  /** 结构放置模式是否激活（供读投影/验收使用）。 */
  modeActive(): boolean;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    /** 组合机械（Assembly）运行时（由 assembly 插件提供）。 */
    assembly: AssemblyService;
  }
}
