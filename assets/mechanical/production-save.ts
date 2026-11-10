/**
 * M2.0-P2-E3 加工运行时的存档切片（纯逻辑，零引擎依赖，可在单测里用真实 ProductionRuntime 验证）。
 *
 * 为什么单独一个文件：加工状态（机器输入/输出缓冲、周期进度、溜槽在途物品）是**真实世界状态**，
 * 不存会丢物品；但它的所有者在 assets/production/**（本轮其他工程师正在改，不能动）。
 * 这里只通过 ProductionRuntime 的**公开方法**读写（machineState/chuteState/sync/snapshot），
 * 不复制第二套加工状态。
 *
 * 明确不存：
 * - running/block（当帧锁存与阻塞原因，读档后由下一帧重新判定，属于派生量）；
 * - 累计产出 producedTotals 的全局表（生产目标基线随订单重新开始；不参与物品所有权）。
 */
import { getItemDefinition } from '../items/items.ts';
import { recipesFor } from '../production/recipes.ts';
import { ensureRecipeSelected, inputCapacity, outputCapacity } from '../production/production.ts';
import type { ProductionRuntime } from '../production/production-runtime.ts';
import type { MechanicalPart } from './parts.ts';
import { normalizeProductionSlice, type SaveProductionSlice } from '../save/save-schema.ts';
import type { SaveRestoreReport } from '../save/save-ports.ts';

/** 从真实运行时导出加工切片（机器缓冲/进度 + 溜槽在途物品）。 */
export function snapshotProduction(runtime: ProductionRuntime): SaveProductionSlice {
  const snapshot = runtime.snapshot();
  return {
    machines: snapshot.machines.map((machine) => ({
      partId: machine.partId,
      recipeId: machine.recipeId,
      progress: machine.progress,
      inputItem: machine.inputItem,
      inputCount: machine.inputCount,
      outputItem: machine.outputItem,
      outputCount: machine.outputCount,
      producedTotal: machine.producedTotal,
    })),
    chutes: snapshot.chutes.map((chute) => ({
      partId: chute.partId,
      itemId: chute.itemId,
      t: chute.t,
      blocked: chute.blocked,
      delivered: chute.delivered,
    })),
  };
}

function clampCount(value: number, capacity: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(capacity, Math.floor(value)));
}

/**
 * 把加工切片恢复进真实运行时。调用方必须已经恢复零件（本函数先 sync 一次，
 * 让 ProductionRuntime 按新零件表建好 MachineState/ChuteState）。
 * 逐条校验、逐条跳过；不丢物品（缓冲直接写回，不经过库存）。
 */
export function restoreProduction(
  runtime: ProductionRuntime,
  parts: readonly MechanicalPart[],
  raw: unknown,
): SaveRestoreReport {
  const normalized = normalizeProductionSlice(raw);
  const issues: string[] = [...normalized.issues];
  runtime.sync(parts);
  const byId = new Map(parts.map((part) => [part.id, part]));
  let restored = 0;
  for (const record of normalized.value.machines) {
    const part = byId.get(record.partId);
    if (part === undefined || part.def.kind !== 'machine') {
      issues.push('machine restore skipped: not a machine part ' + record.partId);
      continue;
    }
    const state = runtime.machineState(record.partId);
    if (state === undefined) {
      issues.push('machine restore skipped: no runtime state ' + record.partId);
      continue;
    }
    const list = recipesFor(part.def.id);
    if (record.recipeId !== null) {
      const recipe = list.find((candidate) => candidate.id === record.recipeId);
      if (recipe === undefined) {
        issues.push('machine recipe repaired: ' + part.def.id + ' has no recipe ' + record.recipeId);
        ensureRecipeSelected(state, part.def);
      } else {
        state.recipeId = recipe.id;
        state.recipeIndex = list.indexOf(recipe);
      }
    } else {
      state.recipeId = null;
      ensureRecipeSelected(state, part.def);
    }
    state.progress = Math.max(0, Math.min(1, record.progress));
    const inputItem = record.inputItem === null || getItemDefinition(record.inputItem) === undefined
      ? null
      : record.inputItem;
    const outputItem = record.outputItem === null || getItemDefinition(record.outputItem) === undefined
      ? null
      : record.outputItem;
    const inputCount = clampCount(record.inputCount, inputCapacity(part.def));
    const outputCount = clampCount(record.outputCount, outputCapacity(part.def));
    if (inputCount !== record.inputCount || outputCount !== record.outputCount) {
      issues.push('machine buffer clamped: ' + record.partId);
    }
    state.inputItem = inputCount > 0 ? inputItem : null;
    state.inputCount = state.inputItem === null ? 0 : inputCount;
    state.outputItem = outputCount > 0 ? outputItem : null;
    state.outputCount = state.outputItem === null ? 0 : outputCount;
    state.producedTotal = Math.max(0, Math.floor(record.producedTotal));
    state.running = false;
    state.block = 'no-recipe';
    restored += 1;
  }
  for (const record of normalized.value.chutes) {
    const part = byId.get(record.partId);
    if (part === undefined || part.def.kind !== 'transport') {
      issues.push('chute restore skipped: not a transport part ' + record.partId);
      continue;
    }
    const state = runtime.chuteState(record.partId);
    if (state === undefined) {
      issues.push('chute restore skipped: no runtime state ' + record.partId);
      continue;
    }
    const itemId = record.itemId === null || getItemDefinition(record.itemId) === undefined
      ? null
      : record.itemId;
    state.item = itemId === null ? null : { itemId, t: record.t, blocked: record.blocked };
    state.delivered = Math.max(0, Math.floor(record.delivered));
    restored += 1;
  }
  return { restored, issues };
}
