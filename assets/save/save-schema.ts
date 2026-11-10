/**
 * 正式存档 v1 的聚合入口：快照类型 + 版本常量 + 每个切片的纯校验/规整函数。
 *
 * 历史原因（单文件 20KB 提交限制）拆成 4 个文件，本文件只做 re-export；
 * 所有调用方继续 import ../save/save-schema.ts，不需要改 import。
 */
export * from './save-types.ts';
export * from './save-normalize-primitives.ts';
export * from './save-normalize-core.ts';
export * from './save-normalize-world.ts';
