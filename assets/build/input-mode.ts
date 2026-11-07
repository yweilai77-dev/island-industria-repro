import { isMechanicalItem, type ItemId } from '../items/items.ts';

/**
 * 机械模式判定：快捷栏选中机械零件物品时为机械模式。
 * 普通建筑系统据此在机械模式下完全让出输入（不处理放置/选中/旋转/拆除/调整）。
 */
export function isMechanicalSelection(selectedItemId: ItemId | null): boolean {
  return isMechanicalItem(selectedItemId);
}
