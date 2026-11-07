/**
 * 前端物品图标（内联 SVG，无外部资源）。
 * 物品定义里的 icon 字段决定使用哪个 SVG；新增物品时在此扩展即可。
 */
const IRON_ORE_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<polygon points="32,4 57,18 57,46 32,60 7,46 7,18" fill="#7a3416" stroke="#2a1208" stroke-width="2"/>',
  '<polygon points="32,10 51,21 51,43 32,54 13,43 13,21" fill="#b5541c"/>',
  '<polygon points="32,10 51,21 32,32 13,21" fill="#d9782f"/>',
  '<polygon points="13,43 32,32 32,54" fill="#8f3f14"/>',
  '<polygon points="51,43 32,32 32,54" fill="#a34a17"/>',
  '<polygon points="32,22 40,27 40,37 32,42 24,37 24,27" fill="#ffb066" opacity="0.85"/>',
  '</svg>',
].join('');

const PLACEHOLDER_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<rect x="12" y="12" width="40" height="40" rx="8" fill="#3a4a5c" stroke="#22303d" stroke-width="2"/>',
  '<text x="32" y="40" font-size="20" text-anchor="middle" fill="#9fb3c8">?</text>',
  '</svg>',
].join('');

/** 按物品定义的 icon 字段返回对应 SVG；未知图标返回占位图。 */
export function itemIconSvg(iconKey: string): string {
  switch (iconKey) {
    case 'iron_ore':
      return IRON_ORE_SVG;
    default:
      return PLACEHOLDER_SVG;
  }
}
