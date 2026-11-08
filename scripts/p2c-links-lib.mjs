// M2.0-P2-C 真实游戏验收共享上下文：常量、布局、放置/交互/校验助手。
// 设计原则与 M1.8 / P2-B 脚本一致：全部走真实键鼠（不注入状态、不改游戏代码），
// 断言只读唯一 GameRead `mechanical`（含 P2-C 新增的 links 字段）。
//
// 与 P2-B 的差异：
// - P2-C 新增键 O / K / L（安装输出 / 分流 / 合流接口盒）、J（建链）、H（解链）；
// - `R` 仍然同时旋转放置幽灵与切换配方，因此本脚本自己记账（ghost），
//   并且在按 R 之前把鼠标移到天空，避免「旋转幽灵时顺手切了机器的配方」。
// 文件拆分原因：单文件超过工程 20 KB 提交上限。

const SHAFT = 0;
const GEAR12 = 1;
const GEAR24 = 2;
const POWER = 3;
const MACHINE = 4;
const CHUTE = 6;
const VDRIVE = 7;
const FLY = 8;
const CRUSHER = 9;
const SMELTER = 10;
const FORGE = 11;

const ORE_TARGET_A = 20;
const ORE_TARGET_B = 10;
const ORE_NODE_A_VIEW = { gx: -6, gz: 4 };
const ORE_NODE_B_VIEW = { gx: 3, gz: -4 };
const BUILD_SPOT = { gx: -6, gz: 7 };

/**
 * 场景 A / D / E：核心直接对接。
 * 动力必须经过传动轴：机械端口规则不允许「动力源输出 ←→ 机器输入」直连
 * （output↔input 不是合法轴向对），所以每个核心用「动力源 → 轴 → 核心」供电。
 * 布局：轴/源在核心动力面一侧；破碎机(-4,8) rot0 输出 px → 熔炼炉(-3,8) rot90 输入 nz。
 */
export const LAYOUT_A = [
  { cell: { gx: -6, gz: 8 }, slot: POWER, rot: 0, label: 'A-source-crusher' },
  { cell: { gx: -5, gz: 8 }, slot: SHAFT, rot: 0, label: 'A-shaft-crusher' },
  { cell: { gx: -4, gz: 8 }, slot: CRUSHER, rot: 0, label: 'A-crusher' },
  { cell: { gx: -3, gz: 8 }, slot: SMELTER, rot: 90, label: 'A-smelter' },
  { cell: { gx: -3, gz: 9 }, slot: SHAFT, rot: 90, label: 'A-shaft-smelter' },
  { cell: { gx: -3, gz: 10 }, slot: POWER, rot: 90, label: 'A-source-smelter' },
];

/**
 * 场景 B：双路合流。
 * crusher1(-4,7) rot270 输出 px → +Z，正对 smelter(-4,8) rot0 输入 nz；
 * crusher2(-3,7) rot180 输出 px → -X，偏 45° 近距定向进同一合流盒。
 * 注意 (-6,7) 是玩家站位，任何场景布局都不能占用它。
 */
export const LAYOUT_B = [
  { cell: { gx: -6, gz: 8 }, slot: POWER, rot: 0, label: 'B-source-smelter' },
  { cell: { gx: -5, gz: 8 }, slot: SHAFT, rot: 0, label: 'B-shaft-smelter' },
  { cell: { gx: -4, gz: 5 }, slot: POWER, rot: 270, label: 'B-source-crusher1' },
  { cell: { gx: -4, gz: 6 }, slot: SHAFT, rot: 270, label: 'B-shaft-crusher1' },
  { cell: { gx: -1, gz: 7 }, slot: POWER, rot: 180, label: 'B-source-crusher2' },
  { cell: { gx: -2, gz: 7 }, slot: SHAFT, rot: 180, label: 'B-shaft-crusher2' },
  { cell: { gx: -4, gz: 7 }, slot: CRUSHER, rot: 270, label: 'B-crusher1' },
  { cell: { gx: -3, gz: 7 }, slot: CRUSHER, rot: 180, label: 'B-crusher2' },
  { cell: { gx: -4, gz: 8 }, slot: SMELTER, rot: 0, label: 'B-smelter' },
];

/** 场景 C：一路分流到两台下游（下游 rot0，输入朝 -Z；动力链向西，避开屏幕右上角）。 */
export const LAYOUT_C = [
  { cell: { gx: -4, gz: 6 }, slot: POWER, rot: 270, label: 'C-source-crusher' },
  { cell: { gx: -4, gz: 7 }, slot: SHAFT, rot: 270, label: 'C-shaft-crusher' },
  { cell: { gx: -6, gz: 9 }, slot: POWER, rot: 0, label: 'C-source-smelter-a' },
  { cell: { gx: -5, gz: 9 }, slot: SHAFT, rot: 0, label: 'C-shaft-smelter-a' },
  { cell: { gx: -6, gz: 10 }, slot: POWER, rot: 0, label: 'C-source-smelter-b' },
  { cell: { gx: -5, gz: 10 }, slot: SHAFT, rot: 0, label: 'C-shaft-smelter-b' },
  { cell: { gx: -4, gz: 8 }, slot: CRUSHER, rot: 270, label: 'C-crusher' },
  { cell: { gx: -4, gz: 9 }, slot: SMELTER, rot: 0, label: 'C-smelter-a' },
  { cell: { gx: -4, gz: 10 }, slot: SMELTER, rot: 0, label: 'C-smelter-b' },
];

/** 场景 F：三台核心串联 + 制造演示。 */
export const LAYOUT_F = [
  { cell: { gx: -6, gz: 8 }, slot: POWER, rot: 0, label: 'F-source-crusher' },
  { cell: { gx: -5, gz: 8 }, slot: SHAFT, rot: 0, label: 'F-shaft-crusher' },
  { cell: { gx: -3, gz: 10 }, slot: POWER, rot: 90, label: 'F-source-smelter' },
  { cell: { gx: -3, gz: 9 }, slot: SHAFT, rot: 90, label: 'F-shaft-smelter' },
  { cell: { gx: -1, gz: 7 }, slot: POWER, rot: 180, label: 'F-source-forge' },
  { cell: { gx: -2, gz: 7 }, slot: SHAFT, rot: 180, label: 'F-shaft-forge' },
  { cell: { gx: -4, gz: 8 }, slot: CRUSHER, rot: 0, label: 'F-crusher' },
  { cell: { gx: -3, gz: 8 }, slot: SMELTER, rot: 90, label: 'F-smelter' },
  { cell: { gx: -3, gz: 7 }, slot: FORGE, rot: 180, label: 'F-forge' },
];

export function createCtx(play, h) {
  const assert = h.assert;
  const calRef = { value: undefined };
  const points = {};
  let ghost = 0;

  const state = () => h.state();
  const countOf = (s, itemId) => s.inventory.find((entry) => entry.itemId === itemId)?.count ?? 0;
  const machineById = (s, partId) => s.production.machines.find((entry) => entry.partId === partId);
  const machineOf = (s, recipeId) => s.production.machines.find((entry) => entry.recipeId === recipeId);
  const partOf = (s, partId) => s.parts.find((entry) => entry.partId === partId);
  const producedOf = (s, itemId) => s.production.produced.find((entry) => entry.itemId === itemId)?.count ?? 0;
  const portsOf = (s, partId) => s.ports.filter((entry) => entry.partId === partId);
  const linksTo = (s, partId) => s.links.filter((entry) => entry.to.entityId === partId);
  const linksFrom = (s, partId) => s.links.filter((entry) => entry.from.entityId === partId);

  /** 读投影里的接口盒缓冲总数。 */
  const heldInPorts = (s) => s.ports.reduce((total, entry) => total + entry.count, 0);

  /** 读投影里的机器缓冲总数（输入+输出）。 */
  const heldInMachines = (s) => s.production.machines.reduce(
    (total, entry) => total + entry.inputCount + entry.outputCount, 0,
  );

  const sky = async () => {
    await play.mouse.move([0.02, 0.02]);
    await play.wait(60);
  };

  /**
   * 按 R 旋转放置幽灵。
   * 关键：R 只在「快捷栏选中机械零件」时才旋转幽灵（空槽选中时机械系统让出输入），
   * 而 pointForCell 探测时会临时切到空槽，所以这里必须先切回机械槽再按 R。
   * 同时先移到天空，避免 R 被当成「切换悬停机器配方」。
   */
  const pressRotate = async (times) => {
    if (times > 0) await h.selectSlot(SHAFT);
    for (let index = 0; index < times; index += 1) {
      await sky();
      await play.keyboard.press('KeyR');
      await play.advance(0.06);
    }
    ghost = (ghost + 90 * times) % 360;
  };

  /** 悬停锻压机按 R 切换配方（R 同时转幽灵，必须记账）。 */
  const cycleRecipe = async (point) => {
    await h.selectSlot(SHAFT);
    await play.mouse.move(point);
    await play.wait(150);
    await play.keyboard.press('KeyR');
    await play.advance(0.25);
    ghost = (ghost + 90) % 360;
  };

  /** 悬停到指定机器再按 R 切配方（不依赖缓存屏幕点）。 */
  const cycleRecipeAt = async (cell, partId) => {
    const point = await hoverPart(cell, partId);
    await play.keyboard.press('KeyR');
    await play.advance(0.25);
    ghost = (ghost + 90) % 360;
    return point;
  };

  const aim = async (cell) => h.pointForCell(calRef.value, cell, { avoidHover: true });

  /** 放置并要求最终旋转等于 rotation（观测值优先，不满足就删掉重试）。 */
  const placeRotated = async (pt, slot, rotation, label, cell) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const need = ((((rotation - ghost) % 360) + 360) % 360) / 90;
      await pressRotate(need);
      let part;
      try {
        part = await h.placePartAtPoint(pt, slot, 0, label, cell);
      } catch (error) {
        const s = await state();
        console.log('PLACE-FAIL ' + label + ' cell=' + JSON.stringify(cell) + ' slot=' + slot
          + ' hotbar=' + JSON.stringify(s.ui?.hotbar) + ' selected=' + String(s.ui?.selectedItem)
          + ' inventory=' + JSON.stringify(s.inventory) + ' parts=' + s.parts.length);
        throw error;
      }
      const placed = (await state()).parts.find((entry) => entry.partId === part.partId);
      if (placed && placed.placement.rotation === rotation) return part;
      console.log('PLACE-RETRY ' + label + ' wanted=' + rotation + ' got='
        + (placed ? placed.placement.rotation : 'missing') + ' ghost=' + ghost);
      ghost = placed ? placed.placement.rotation : ghost;
      await removePart(cell, part.partId);
      pt = await aim(cell);
    }
    throw new Error('could not place ' + label + ' with rotation ' + rotation);
  };

  const placeLayout = async (layout) => {
    for (const item of layout) {
      let pt;
      try {
        pt = await aim(item.cell);
      } catch (error) {
        // 相机/标定漂移时重新标定一次再试（不改变任何游戏状态）。
        console.log('PLACE-RECAL ' + item.label + ' reason=' + error.message);
        await calibrate('RECAL-' + item.label);
        pt = await aim(item.cell);
      }
      points[item.label] = pt;
      await placeRotated(pt, item.slot, item.rot, item.label, item.cell);
    }
    await h.clearHover();
    return state();
  };

  /** 悬停到指定机器上（机械模式，读 hoveredPartId）。 */
  const hoverPart = async (cell, partId) => {
    await h.selectSlot(SHAFT);
    const point = await h.hoverSpecificPart(calRef.value, cell, partId);
    assert(point !== null, 'must be able to aim at part ' + partId + ' at ' + JSON.stringify(cell));
    await play.mouse.move(point);
    await play.wait(160);
    return point;
  };

  /** 悬停机器并按一个 P2-C 交互键（T/O/K/L/Y/J/H/U）。 */
  const onPart = async (cell, partId, code) => {
    await hoverPart(cell, partId);
    await play.keyboard.press(code);
    await play.advance(0.35);
  };

  const toggleSource = async (cell, partId) => {
    await h.selectSlot(SHAFT);
    const point = await h.hoverSpecificPart(calRef.value, cell, partId);
    assert(point !== null, 'must be able to aim at power source ' + partId);
    await play.mouse.move(point);
    await play.wait(140);
    await h.rightClickAt(point);
    await play.advance(0.5);
  };

  const setSource = async (cell, partId, enabled) => {
    let s = await state();
    const current = s.sources.find((entry) => entry.partId === partId);
    if (!current) throw new Error('power source ' + partId + ' not found');
    if (current.enabled === enabled) return;
    await toggleSource(cell, partId);
    s = await state();
    const after = s.sources.find((entry) => entry.partId === partId);
    assert(after && after.enabled === enabled,
      'power source ' + partId + ' should be ' + (enabled ? 'enabled' : 'disabled'));
  };

  const enableAllSources = async (layout) => {
    const s = await state();
    for (const item of layout) {
      if (item.slot !== POWER) continue;
      const source = s.parts.find((part) => part.placement.gx === item.cell.gx
        && part.placement.gz === item.cell.gz
        && part.kind === 'power-source');
      assert(source, 'source part must exist at ' + JSON.stringify(item.cell));
      await setSource(item.cell, source.partId, true);
    }
  };

  const feedByC = async (point, times) => {
    await play.mouse.move(point);
    await play.wait(150);
    for (let index = 0; index < times; index += 1) {
      await play.keyboard.press('KeyC');
      await play.advance(0.1);
    }
  };

  /** 悬停到指定机器再按 C 投料（不依赖放置时缓存的屏幕点，避免瞄到隔壁机器）。 */
  const feedMachine = async (cell, partId, times) => {
    const point = await hoverPart(cell, partId);
    await feedByC(point, times);
  };

  /** 悬停到指定机器再右键取货（产物缓冲只有 4 格，收走才能继续生产）。 */
  const collectMachine = async (cell, partId, times = 1) => {
    const point = await hoverPart(cell, partId);
    for (let index = 0; index < times; index += 1) {
      await play.mouse.move(point);
      await play.wait(140);
      await h.rightClickAt(point);
      await play.advance(0.4);
    }
  };

  const takeByRightClick = async (point, times = 1) => {
    for (let index = 0; index < times; index += 1) {
      await play.mouse.move(point);
      await play.wait(140);
      await h.rightClickAt(point);
      await play.advance(0.35);
    }
  };

  /** 等待条件满足（每 0.5s 检查一次），返回是否成立。 */
  const waitFor = async (predicate, seconds = 20, label = '') => {
    const steps = Math.round(seconds / 0.5);
    for (let index = 0; index < steps; index += 1) {
      await play.advance(0.5);
      const s = await state();
      if (predicate(s)) return { ok: true, state: s };
    }
    const s = await state();
    console.log('WAIT-FAIL ' + label + ' ' + JSON.stringify({
      production: s.production,
      ports: s.ports,
      links: s.links,
    }));
    return { ok: false, state: s };
  };

  /** 删除一台机器（选中后 Delete）；拆机时接口盒与缓冲物料由运行时交回库存。 */
  const removePart = async (cell, partId) => {
    await h.selectSlot(SHAFT);
    const point = await h.hoverSpecificPart(calRef.value, cell, partId);
    assert(point !== null, 'teardown: must be able to aim at part ' + partId);
    await play.mouse.move(point);
    await play.wait(140);
    await h.clickAt(point);
    await play.keyboard.press('Delete');
    await play.advance(0.4);
  };

  /** 拆掉本场景放置的全部机器，回到空地（下一场景重新搭建）。 */
  const removeAllParts = async () => {
    let s = await state();
    for (const part of [...s.parts]) {
      await removePart({ gx: part.placement.gx, gz: part.placement.gz }, part.partId);
    }
    s = await state();
    assert(s.parts.length === 0, 'teardown must remove every mechanical part, got ' + s.parts.length);
    assert(s.links.length === 0, 'teardown must clear every material link, got ' + s.links.length);
    assert(s.ports.length === 0, 'teardown must return every interface box, got ' + s.ports.length);
  };

  /** 截图前清掉选中高亮/放置幽灵，画面只保留真实机器、接口盒与物料连接。 */
  const shot = async (name) => {
    await play.keyboard.press('Escape');
    await h.clearHover();
    await play.advance(0.3);
    await play.screenshot(name);
  };

  const calibrate = async (label) => {
    // 相机是平滑跟随玩家的：刚走完路立刻标定会把"还在滑行"的相机当成稳态。
    await play.advance(0.8);
    calRef.value = await h.calibrate(label);
    return calRef.value;
  };

  return {
    assert,
    calRef,
    points,
    state,
    countOf,
    producedOf,
    machineById,
    machineOf,
    partOf,
    portsOf,
    linksTo,
    linksFrom,
    heldInPorts,
    heldInMachines,
    sky,
    pressRotate,
    cycleRecipe,
    cycleRecipeAt,
    aim,
    placeLayout,
    placeRotated,
    hoverPart,
    onPart,
    toggleSource,
    setSource,
    enableAllSources,
    feedByC,
    feedMachine,
    collectMachine,
    takeByRightClick,
    waitFor,
    removePart,
    removeAllParts,
    calibrate,
    shot,
    constants: {
      SHAFT, GEAR12, GEAR24, POWER, MACHINE, CHUTE, VDRIVE, FLY, CRUSHER, SMELTER, FORGE,
      ORE_TARGET_A, ORE_TARGET_B, ORE_NODE_A_VIEW, ORE_NODE_B_VIEW, BUILD_SPOT,
    },
  };
}
