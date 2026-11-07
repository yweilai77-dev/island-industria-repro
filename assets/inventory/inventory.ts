import { requireItemDefinition, type ItemId } from '../items/items.ts';

/**
 * 库存纯逻辑 + 服务接口。
 * - 堆叠数据只保存 itemId 与 count，与物品定义分离；
 * - 数量参数必须是有效的非负整数：0 为无操作，负数/小数/NaN/Infinity 抛错且不改变状态。
 */

export interface ItemStack {
  readonly itemId: ItemId;
  count: number;
}

export interface InventoryState {
  stacks: ItemStack[];
}

/** 数量参数非法（负数、小数、NaN、Infinity 等）。 */
export class InvalidItemCountError extends RangeError {
  readonly count: number;
  constructor(count: number) {
    super(`item count must be a non-negative integer, received ${String(count)}`);
    this.name = 'InvalidItemCountError';
    this.count = count;
  }
}

/** 校验数量参数：必须是非负整数（Number.isInteger 已排除 NaN/Infinity/小数）。 */
export function assertItemCount(count: number): void {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw new InvalidItemCountError(count);
  }
}

function assertMaxStack(maxStack: number): void {
  if (!Number.isInteger(maxStack) || maxStack <= 0) {
    throw new RangeError(`maxStack must be a positive integer, received ${String(maxStack)}`);
  }
}

export function createInventoryState(): InventoryState {
  return { stacks: [] };
}

/** 总数（所有堆之和）。 */
export function inventoryCount(state: InventoryState, itemId: ItemId): number {
  let total = 0;
  for (const stack of state.stacks) {
    if (stack.itemId === itemId) total += stack.count;
  }
  return total;
}

/** 是否至少有 count 个；count = 0 恒为 true。 */
export function inventoryHas(state: InventoryState, itemId: ItemId, count: number): boolean {
  assertItemCount(count);
  return inventoryCount(state, itemId) >= count;
}

/**
 * 添加物品：先补充已有未满堆，再按 maxStack 新开堆；无容量上限。
 * 返回实际加入数量（数量合法时等于参数）。
 */
export function inventoryAdd(
  state: InventoryState,
  itemId: ItemId,
  count: number,
  maxStack: number,
): number {
  assertItemCount(count);
  assertMaxStack(maxStack);
  if (count === 0) return 0;

  let remaining = count;
  for (const stack of state.stacks) {
    if (stack.itemId !== itemId) continue;
    const space = maxStack - stack.count;
    if (space <= 0) continue;
    const put = Math.min(space, remaining);
    stack.count += put;
    remaining -= put;
    if (remaining === 0) return count;
  }
  while (remaining > 0) {
    const put = Math.min(maxStack, remaining);
    state.stacks.push({ itemId, count: put });
    remaining -= put;
  }
  return count;
}

/**
 * 整笔移除：数量不足返回 false 且不改变库存；成功时从第一堆开始扣，空堆删除。
 * count = 0 无操作并返回 true。
 */
export function inventoryRemove(state: InventoryState, itemId: ItemId, count: number): boolean {
  assertItemCount(count);
  if (count === 0) return true;
  if (inventoryCount(state, itemId) < count) return false;

  let remaining = count;
  const kept: ItemStack[] = [];
  for (const stack of state.stacks) {
    if (stack.itemId !== itemId || remaining === 0) {
      kept.push(stack);
      continue;
    }
    const take = Math.min(stack.count, remaining);
    stack.count -= take;
    remaining -= take;
    if (stack.count > 0) kept.push(stack);
  }
  state.stacks = kept;
  return true;
}

/** 只读快照（副本，外部无法修改内部堆叠数组）。 */
export function inventorySnapshot(state: InventoryState): readonly ItemStack[] {
  return state.stacks.map((stack) => ({ itemId: stack.itemId, count: stack.count }));
}

export interface InventoryService {
  /** 添加物品，返回实际加入数量；数量非法时抛错。 */
  add(itemId: ItemId, count?: number): number;
  /** 整笔移除；数量不足返回 false 且不变；数量非法时抛错。 */
  remove(itemId: ItemId, count?: number): boolean;
  /** 该物品总数（所有堆之和）。 */
  count(itemId: ItemId): number;
  /** 是否至少有 count 个；count = 0 返回 true。 */
  has(itemId: ItemId, count?: number): boolean;
  /** 只读堆叠快照，供 UI/存档使用。 */
  stacks(): readonly ItemStack[];
}

/** 由纯逻辑组装的服务（插件与测试共用；maxStack 来自物品定义）。 */
export function createInventoryService(): InventoryService {
  const state = createInventoryState();
  const maxStackOf = (itemId: ItemId): number => requireItemDefinition(itemId).maxStack;
  return {
    add: (itemId, count = 1) => inventoryAdd(state, itemId, count, maxStackOf(itemId)),
    remove: (itemId, count = 1) => {
      requireItemDefinition(itemId);
      return inventoryRemove(state, itemId, count);
    },
    count: (itemId) => inventoryCount(state, itemId),
    has: (itemId, count = 1) => {
      requireItemDefinition(itemId);
      return inventoryHas(state, itemId, count);
    },
    stacks: () => inventorySnapshot(state),
  };
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    inventory: InventoryService;
  }
}

