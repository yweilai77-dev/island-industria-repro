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

// M1.8 生产链新物品图标。风格与上面一致：64×64、内联、深色描边、无字体/外链依赖。
const CRUSHED_ORE_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<polygon points="4,52 16,40 28,45 40,34 52,43 60,52" fill="#6b6257" stroke="#2c3035" stroke-width="2"/>',
  '<polygon points="10,52 20,42 32,47 44,38 54,47 56,52" fill="#8a7f70"/>',
  '<circle cx="18" cy="36" r="5" fill="#9a8f7e" stroke="#2c3035" stroke-width="2"/>',
  '<circle cx="33" cy="29" r="4.5" fill="#7d7568" stroke="#2c3035" stroke-width="2"/>',
  '<circle cx="47" cy="35" r="4" fill="#8f8374" stroke="#2c3035" stroke-width="2"/>',
  '<circle cx="27" cy="22" r="3" fill="#5f574d" stroke="#2c3035" stroke-width="2"/>',
  '<circle cx="52" cy="24" r="2.5" fill="#6b6257" stroke="#2c3035" stroke-width="2"/>',
  '</svg>',
].join('');

const IRON_INGOT_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<polygon points="22,20 42,20 52,34 12,34" fill="#e6edf4" stroke="#2c3035" stroke-width="2"/>',
  '<polygon points="12,34 52,34 46,50 18,50" fill="#aab4bf" stroke="#2c3035" stroke-width="2"/>',
  '<polygon points="22,20 31,20 24,34 12,34" fill="#f7fbff" opacity="0.9"/>',
  '<path d="M20 43h22" stroke="#7d8895" stroke-width="2"/>',
  '<path d="M26 24h8" stroke="#ffffff" stroke-width="2" opacity="0.7"/>',
  '</svg>',
].join('');

const VERTICAL_DRIVE_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<rect x="14" y="6" width="36" height="52" rx="5" fill="#5b6068" stroke="#2c3035" stroke-width="2"/>',
  '<path d="M24 19v26M40 19v26" stroke="#8b95a0" stroke-width="4"/>',
  '<circle cx="32" cy="18" r="8" fill="#c7d0da" stroke="#2c3035" stroke-width="2"/>',
  '<circle cx="32" cy="46" r="8" fill="#c7d0da" stroke="#2c3035" stroke-width="2"/>',
  '<circle cx="32" cy="18" r="2.5" fill="#3d4650"/>',
  '<circle cx="32" cy="46" r="2.5" fill="#3d4650"/>',
  '<path d="M12 32h4M48 32h4" stroke="#3d4650" stroke-width="2"/>',
  '</svg>',
].join('');

const FLYWHEEL_SOURCE_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<circle cx="27" cy="32" r="21" fill="#47606f" stroke="#22303d" stroke-width="2"/>',
  '<circle cx="27" cy="32" r="14" fill="#5b6068" stroke="#22303d" stroke-width="2"/>',
  '<path d="M27 18v28M13 32h28M17 22l20 20M37 22L17 42" stroke="#8b95a0" stroke-width="2.5"/>',
  '<circle cx="27" cy="32" r="4" fill="#d9a441" stroke="#5a3f15" stroke-width="2"/>',
  '<rect x="44" y="28" width="10" height="8" rx="2" fill="#9aa4ae" stroke="#2c3035" stroke-width="2"/>',
  '<path d="M54 32h4" stroke="#3d4650" stroke-width="4"/>',
  '<rect x="56" y="18" width="4" height="14" rx="2" fill="#c7d0da" stroke="#3d4650" stroke-width="2"/>',
  '<circle cx="58" cy="16" r="3" fill="#c7d0da" stroke="#3d4650" stroke-width="2"/>',
  '</svg>',
].join('');

const CRUSHER_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<polygon points="10,6 54,6 46,26 18,26" fill="#5b6068" stroke="#2c3035" stroke-width="2"/>',
  '<rect x="14" y="26" width="36" height="22" rx="3" fill="#47606f" stroke="#2c3035" stroke-width="2"/>',
  '<circle cx="24" cy="37" r="7" fill="#c7d0da" stroke="#2c3035" stroke-width="2"/>',
  '<circle cx="40" cy="37" r="7" fill="#c7d0da" stroke="#2c3035" stroke-width="2"/>',
  '<path d="M19 33.5h10M19 37h10M19 40.5h10" stroke="#8b95a0" stroke-width="1.5"/>',
  '<path d="M35 33.5h10M35 37h10M35 40.5h10" stroke="#8b95a0" stroke-width="1.5"/>',
  '<path d="M24 26v-3M40 26v-3M17 37h-3M47 37h3" stroke="#2c3035" stroke-width="2"/>',
  '<rect x="25" y="48" width="14" height="8" rx="2" fill="#6f7a84" stroke="#2c3035" stroke-width="2"/>',
  '</svg>',
].join('');

const SMELTER_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<rect x="12" y="12" width="40" height="44" rx="4" fill="#7a4a3a" stroke="#2c3035" stroke-width="2"/>',
  '<path d="M12 20h40M12 28h40M12 36h40M12 44h40M12 52h40" stroke="#5a3529" stroke-width="1.5"/>',
  '<path d="M32 12v8M22 20v8M42 28v8M22 36v8M42 44v8M32 52v4" stroke="#5a3529" stroke-width="1.5"/>',
  '<rect x="23" y="31" width="18" height="14" rx="2" fill="#241209" stroke="#2c3035" stroke-width="2"/>',
  '<rect x="26" y="35" width="12" height="7" rx="1" fill="#ff9a3c"/>',
  '<rect x="28" y="37" width="8" height="3" fill="#ffd9a0"/>',
  '<path d="M14 56h36" stroke="#3d4650" stroke-width="2"/>',
  '</svg>',
].join('');

const FORGE_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<rect x="14" y="46" width="36" height="8" rx="2" fill="#3d4650" stroke="#2c3035" stroke-width="2"/>',
  '<polygon points="22,32 42,32 47,46 17,46" fill="#8b95a0" stroke="#2c3035" stroke-width="2"/>',
  '<rect x="16" y="26" width="32" height="7" rx="2" fill="#c7d0da" stroke="#2c3035" stroke-width="2"/>',
  '<polygon points="48,26 56,26 53,33 46,33" fill="#c7d0da" stroke="#2c3035" stroke-width="2"/>',
  '<rect x="18" y="6" width="20" height="11" rx="3" fill="#9aa4ae" stroke="#2c3035" stroke-width="2"/>',
  '<rect x="36" y="9" width="18" height="5" rx="2" fill="#8a6a3c" stroke="#2c3035" stroke-width="2"/>',
  '<path d="M14 20l4-4M22 17l2-3" stroke="#ffb066" stroke-width="2" opacity="0.8"/>',
  '</svg>',
].join('');

const CHUTE_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<g transform="rotate(-18 32 32)">',
  '<path d="M9 20v10a13 13 0 0 0 13 13h20a13 13 0 0 0 13-13V20" fill="none" stroke="#2c3035" stroke-width="9" stroke-linecap="round"/>',
  '<path d="M9 20v10a13 13 0 0 0 13 13h20a13 13 0 0 0 13-13V20" fill="none" stroke="#8b95a0" stroke-width="5.5" stroke-linecap="round"/>',
  '<path d="M9 20v10a13 13 0 0 0 13 13h20a13 13 0 0 0 13-13V20" fill="none" stroke="#4a5560" stroke-width="2" stroke-linecap="round"/>',
  '</g>',
  '</svg>',
].join('');

// P2-B：基础接口盒。视觉语言沿用机械零件：深色描边、金属灰机身 + 琥珀色接口环。
const INTERFACE_BOX_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<rect x="12" y="18" width="40" height="30" rx="4" fill="#5f6a74" stroke="#2c3035" stroke-width="2"/>',
  '<rect x="18" y="24" width="28" height="18" rx="3" fill="#39434d" stroke="#2c3035" stroke-width="2"/>',
  '<circle cx="24" cy="33" r="4.5" fill="#d9a441" stroke="#5a3f15" stroke-width="2"/>',
  '<circle cx="40" cy="33" r="4.5" fill="#d9a441" stroke="#5a3f15" stroke-width="2"/>',
  '<rect x="28" y="31" width="8" height="4" fill="#8b95a0"/>',
  '<rect x="20" y="48" width="6" height="8" rx="1" fill="#8b95a0" stroke="#2c3035" stroke-width="2"/>',
  '<rect x="38" y="48" width="6" height="8" rx="1" fill="#8b95a0" stroke="#2c3035" stroke-width="2"/>',
  '</svg>',
].join('');

// P2-C：输出接口盒。沿用接口盒机身，接口环改成朝外的箭头（表示只输出）。
const OUTPUT_INTERFACE_BOX_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<rect x="12" y="18" width="40" height="30" rx="4" fill="#5a6b7c" stroke="#2c3035" stroke-width="2"/>',
  '<rect x="18" y="24" width="18" height="18" rx="3" fill="#33414f" stroke="#2c3035" stroke-width="2"/>',
  '<circle cx="24" cy="33" r="4.5" fill="#5fb0d9" stroke="#1e465c" stroke-width="2"/>',
  '<path d="M33 33h13m0 0-4-4m4 4-4 4" fill="none" stroke="#5fb0d9" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>',
  '<rect x="20" y="48" width="6" height="8" rx="1" fill="#8b95a0" stroke="#2c3035" stroke-width="2"/>',
  '<rect x="38" y="48" width="6" height="8" rx="1" fill="#8b95a0" stroke="#2c3035" stroke-width="2"/>',
  '</svg>',
].join('');

// P2-C：分流接口盒（一进二出）。
const SPLITTER_BOX_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<rect x="12" y="18" width="40" height="30" rx="4" fill="#5a6b7c" stroke="#2c3035" stroke-width="2"/>',
  '<circle cx="21" cy="33" r="4" fill="#c9d6e2" stroke="#2c3035" stroke-width="2"/>',
  '<circle cx="43" cy="25" r="4" fill="#7fd08a" stroke="#234a2c" stroke-width="2"/>',
  '<circle cx="43" cy="41" r="4" fill="#7fd08a" stroke="#234a2c" stroke-width="2"/>',
  '<path d="M25 33h8m0 0 4-8m-4 8 4 8" fill="none" stroke="#c9d6e2" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  '<rect x="20" y="48" width="6" height="8" rx="1" fill="#8b95a0" stroke="#2c3035" stroke-width="2"/>',
  '<rect x="38" y="48" width="6" height="8" rx="1" fill="#8b95a0" stroke="#2c3035" stroke-width="2"/>',
  '</svg>',
].join('');

// P2-C：合流接口盒（二进一出）。
const MERGER_BOX_SVG = [
  '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">',
  '<rect x="12" y="18" width="40" height="30" rx="4" fill="#5a6b7c" stroke="#2c3035" stroke-width="2"/>',
  '<circle cx="21" cy="25" r="4" fill="#c58ad9" stroke="#48254f" stroke-width="2"/>',
  '<circle cx="21" cy="41" r="4" fill="#c58ad9" stroke="#48254f" stroke-width="2"/>',
  '<circle cx="43" cy="33" r="4" fill="#c9d6e2" stroke="#2c3035" stroke-width="2"/>',
  '<path d="M25 25l8 8m-8 8 8-8" fill="none" stroke="#c9d6e2" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  '<rect x="20" y="48" width="6" height="8" rx="1" fill="#8b95a0" stroke="#2c3035" stroke-width="2"/>',
  '<rect x="38" y="48" width="6" height="8" rx="1" fill="#8b95a0" stroke="#2c3035" stroke-width="2"/>',
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
    case 'crushed_ore':
      return CRUSHED_ORE_SVG;
    case 'iron_ingot':
      return IRON_INGOT_SVG;
    case 'vertical_drive':
      return VERTICAL_DRIVE_SVG;
    case 'flywheel_source':
      return FLYWHEEL_SOURCE_SVG;
    case 'crusher':
      return CRUSHER_SVG;
    case 'smelter':
      return SMELTER_SVG;
    case 'forge':
      return FORGE_SVG;
    case 'chute':
      return CHUTE_SVG;
    case 'interface_box':
      return INTERFACE_BOX_SVG;
    case 'output_interface_box':
      return OUTPUT_INTERFACE_BOX_SVG;
    case 'splitter_box':
      return SPLITTER_BOX_SVG;
    case 'merger_box':
      return MERGER_BOX_SVG;
    default:
      return PLACEHOLDER_SVG;
  }
}
