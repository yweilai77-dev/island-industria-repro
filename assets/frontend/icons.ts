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

const SHAFT_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<rect x="7" y="27" width="50" height="10" rx="4" fill="#8b95a0" stroke="#3d4650" stroke-width="2"/>',
  '<rect x="2" y="24" width="8" height="16" rx="2" fill="#c7d0da" stroke="#3d4650" stroke-width="2"/>',
  '<rect x="54" y="24" width="8" height="16" rx="2" fill="#c7d0da" stroke="#3d4650" stroke-width="2"/>',
  '<rect x="25" y="28" width="14" height="3" fill="#3d4650"/>',
  '</svg>',
].join('');

function gearSvg(teeth: number): string {
  const points: string[] = [];
  const cx = 32;
  const cy = 32;
  const outer = 26;
  const inner = 20;
  for (let index = 0; index < teeth; index += 1) {
    const a0 = (index / teeth) * Math.PI * 2;
    const a1 = ((index + 0.5) / teeth) * Math.PI * 2;
    points.push(`${cx + Math.cos(a0) * outer},${cy + Math.sin(a0) * outer}`);
    points.push(`${cx + Math.cos(a1) * outer},${cy + Math.sin(a1) * outer}`);
    points.push(`${cx + Math.cos(a1) * inner},${cy + Math.sin(a1) * inner}`);
  }
  return [
    '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
    `<polygon points="${points.join(' ')}" fill="#b48b4a" stroke="#4a351c" stroke-width="2"/>`,
    '<circle cx="32" cy="32" r="7" fill="#2c2419" stroke="#4a351c" stroke-width="2"/>',
    '</svg>',
  ].join('');
}

const POWER_SOURCE_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<rect x="12" y="20" width="40" height="28" rx="5" fill="#47606f" stroke="#22303d" stroke-width="2"/>',
  '<circle cx="32" cy="34" r="10" fill="#d9a441" stroke="#5a3f15" stroke-width="2"/>',
  '<path d="M32 24v20M22 34h20M25 27l14 14M39 27L25 41" stroke="#5a3f15" stroke-width="2"/>',
  '</svg>',
].join('');

const MACHINE_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<rect x="10" y="22" width="44" height="28" rx="4" fill="#5b6068" stroke="#2c3035" stroke-width="2"/>',
  '<rect x="20" y="8" width="10" height="18" rx="2" fill="#9aa4ae" stroke="#2c3035" stroke-width="2"/>',
  '<circle cx="44" cy="34" r="9" fill="#c7a04a" stroke="#5a3f15" stroke-width="2"/>',
  '<path d="M44 25v18M35 34h18" stroke="#5a3f15" stroke-width="2"/>',
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
    case 'shaft':
      return SHAFT_SVG;
    case 'gear_12':
      return gearSvg(12);
    case 'gear_24':
      return gearSvg(24);
    case 'power_source':
      return POWER_SOURCE_SVG;
    case 'machine':
      return MACHINE_SVG;
    default:
      return PLACEHOLDER_SVG;
  }
}
