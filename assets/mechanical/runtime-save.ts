/**
 * M2.0-P2-E3 机械运行时的存档适配层（从 runtime.ts 抽出，守住单文件 20KB 限制）。
 *
 * 只做两件事：
 * 1) 把动力源启停 + 加工运行时状态包装成 persistence 需要的窄接口（不复制状态）；
 * 2) 为唯一 GameRead 提供存档验收需要的只读世界字段（buildings/resources）。
 */
import type { MechanicalRuntimeState } from './runtime-state.ts';
import type { ProductionRuntime } from '../production/production-runtime.ts';
import type { MechanicalService } from './mechanical.pack.ts';
import type { MechanicalRuntimeSavePort, SaveRestoreReport } from '../save/save-ports.ts';
import type {
  SaveBuildingRecord,
  SaveProductionSlice,
  SaveResourceRecord,
  SaveSourceRecord,
} from '../save/save-schema.ts';
import { normalizeSourcesSlice } from '../save/save-schema.ts';
import { restoreProduction, snapshotProduction } from './production-save.ts';
import type {} from '../build/build.pack.ts';
import type {} from '../resource/resource.ts';

export interface RuntimeSaveDeps {
  readonly state: MechanicalRuntimeState;
  readonly production: ProductionRuntime;
  readonly mechanical: MechanicalService;
}

/** 构造 mechanicalRuntimeSave 服务（由 runtime.ts 在 effect 内 provide）。 */
export function createRuntimeSavePort(deps: RuntimeSaveDeps): MechanicalRuntimeSavePort {
  const { state, production, mechanical } = deps;
  return {
    snapshotSources: (): readonly SaveSourceRecord[] => mechanical.parts()
      .filter((part) => part.def.kind === 'power-source')
      .sort((a, b) => a.id - b.id)
      .map((part) => ({ partId: part.id, enabled: state.isSourceEnabled(part.id) })),
    restoreSources: (raw: unknown): SaveRestoreReport => {
      const normalized = normalizeSourcesSlice(raw);
      const parts = mechanical.parts();
      // 先按恢复后的零件表重建拓扑/动力源运行时状态，再写开关。
      state.sync(mechanical.revision, parts, mechanical.connections());
      const byId = new Map(parts.map((part) => [part.id, part]));
      const issues: string[] = [...normalized.issues];
      let restored = 0;
      for (const record of normalized.value) {
        const part = byId.get(record.partId);
        if (part === undefined || part.def.kind !== 'power-source') {
          issues.push('source restore skipped: not a power source ' + record.partId);
          continue;
        }
        state.setSourceEnabled(record.partId, record.enabled);
        restored += 1;
      }
      return { restored, issues };
    },
    snapshotProduction: (): SaveProductionSlice => snapshotProduction(production),
    restoreProduction: (raw: unknown): SaveRestoreReport =>
      restoreProduction(production, mechanical.parts(), raw),
  };
}

/** 存档验收用的只读世界字段（建筑/矿量）；服务缺失时返回空数组。 */
export interface RuntimeWorldReadFields {
  readonly buildings: readonly SaveBuildingRecord[];
  readonly resources: readonly SaveResourceRecord[];
}

export function readWorldReadFields(read: (name: string) => unknown): RuntimeWorldReadFields {
  const buildings = read('buildings') as
    | { snapshotSave(): { buildings: readonly SaveBuildingRecord[] } }
    | undefined;
  const resources = read('resourceNodes') as
    | { snapshot(): readonly SaveResourceRecord[] }
    | undefined;
  return {
    buildings: buildings?.snapshotSave().buildings ?? [],
    resources: resources?.snapshot() ?? [],
  };
}
