/**
 * 3D 方块字形 HUD 的纯布局数据（单位坐标系）：
 * 7 段数码管数字、字母 F、加号，以及“数字拆位”辅助函数。
 * 渲染由 harvest 插件用 Box 实体拼装，不依赖 DOM / UI 资产。
 */

export const DIGIT_WIDTH = 0.6;
export const DIGIT_HEIGHT = 1.0;
export const SEGMENT_THICKNESS = 0.14;

export interface SegmentRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 7 段顺序：A 上、B 右上、C 右下、D 下、E 左下、F 左上、G 中。 */
export const SEGMENT_RECTS: readonly SegmentRect[] = [
  { x: 0, y: 0.43, w: 0.46, h: 0.14 },
  { x: 0.23, y: 0.25, w: 0.14, h: 0.36 },
  { x: 0.23, y: -0.25, w: 0.14, h: 0.36 },
  { x: 0, y: -0.43, w: 0.46, h: 0.14 },
  { x: -0.23, y: -0.25, w: 0.14, h: 0.36 },
  { x: -0.23, y: 0.25, w: 0.14, h: 0.36 },
  { x: 0, y: 0, w: 0.46, h: 0.14 },
];

const DIGIT_SEGMENTS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5], // 0
  [1, 2], // 1
  [0, 1, 6, 4, 3], // 2
  [0, 1, 6, 2, 3], // 3
  [5, 6, 1, 2], // 4
  [0, 5, 6, 2, 3], // 5
  [0, 5, 6, 4, 2, 3], // 6
  [0, 1, 2], // 7
  [0, 1, 2, 3, 4, 5, 6], // 8
  [0, 1, 2, 3, 5, 6], // 9
];

/** 数字 0-9 需要点亮的段索引。 */
export function digitSegments(digit: number): readonly number[] {
  return DIGIT_SEGMENTS[((digit % 10) + 10) % 10] ?? [];
}

/** 字母 F 的段（A、F、G、E）。 */
export const LETTER_F_SEGMENTS: readonly number[] = [0, 5, 6, 4];
/** 矿点枯竭提示用数字 0。 */
export const DEPLETED_SEGMENTS: readonly number[] = DIGIT_SEGMENTS[0] ?? [];

/** 加号的两条线段（水平、垂直，单位坐标）。 */
export const PLUS_RECTS: readonly SegmentRect[] = [
  { x: 0, y: 0, w: 0.42, h: 0.12 },
  { x: 0, y: 0, w: 0.12, h: 0.42 },
];

/** 把非负整数拆成固定宽度数字数组，例如 40 -> [4, 0]。 */
export function splitDigits(value: number, minDigits = 1): readonly number[] {
  const safe = Math.max(0, Math.floor(value));
  const text = String(safe);
  const width = Math.max(minDigits, text.length);
  const padded = text.padStart(width, '0');
  return [...padded].map((char) => Number(char));
}
