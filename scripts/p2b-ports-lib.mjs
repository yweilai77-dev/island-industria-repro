// M2.0-P2-B 验收：接口盒物品 → 真实安装位 → 自动输入（溜槽 → 接口盒 → 核心输入缓冲）
//
// 布局与已验收的 M1.8 产线一致（只多了一个接口盒）：
//   飞轮(-8,8) → 轴(-7,8) → 轴(-6,8) → 12T(-5,8) ┬→ 轴(-4,8) → 破碎机(-3,8)  产物出口(-2,8)
//                                                └→ 24T(-5,9) → 轴(-4,9) → 轴(-3,9) → 熔炼炉(-2,9)
//   锻压机支路：24T(-5,7) 与 12T(-5,8) 外啮合 → 轴(-4,7) → 轴(-3,7) → 锻压机(-2,7)
//
// 场景：
//   A 旧式人工生产（无接口盒、无溜槽，全程手动按 C / 右键）
//   B 制造接口盒（锻压机真实产出）→ 安装到熔炼炉输入安装位，背包减少、世界可见
//   C 自动输入（溜槽 → 接口盒 → 熔炼炉输入缓冲 → 真实熔炼）
//   D 新旧方式共存（同一台机器同时手动投料 + 自动输入，不重复）
//   E 拆卸与恢复（返还物品、连接解除、盒内物料交回、重装后自动输入恢复）
//   F 异常（安装位占用、溜槽断开、机器断电）
// P2-B 验收脚本的共享上下文：常量、布局与全部交互助手。
// 拆分原因：单文件超过工程 20 KB 上限（提交钩子会拒绝）。行为与拆分前完全一致。

const SHAFT = 0;
const GEAR12 = 1;
const GEAR24 = 2;
const CHUTE = 6;
const FLYWHEEL = 8;
const CRUSHER = 9;
const SMELTER = 10;
const FORGE = 11;

const ORE_TARGET = 16;
const CRUSHER_CELL = { gx: -3, gz: 8 };
const SMELTER_CELL = { gx: -2, gz: 9 };
const CHUTE_CELL = { gx: -2, gz: 8 };
const FORGE_CELL = { gx: -2, gz: 7 };

/** 无溜槽的基础产线（场景 A 先跑纯手动）。 */
const LINE = [
  { cell: { gx: -8, gz: 8 }, slot: FLYWHEEL, rot: 0, label: 'flywheel' },
  { cell: { gx: -7, gz: 8 }, slot: SHAFT, rot: 0, label: 'shaft-a' },
  { cell: { gx: -6, gz: 8 }, slot: SHAFT, rot: 0, label: 'shaft-b' },
  { cell: { gx: -5, gz: 8 }, slot: GEAR12, rot: 0, label: 'gear12' },
  { cell: { gx: -4, gz: 8 }, slot: SHAFT, rot: 0, label: 'shaft-c' },
  { cell: { gx: -3, gz: 8 }, slot: CRUSHER, rot: 0, label: 'crusher' },
  { cell: { gx: -5, gz: 9 }, slot: GEAR24, rot: 0, label: 'gear24' },
  { cell: { gx: -4, gz: 9 }, slot: SHAFT, rot: 0, label: 'shaft-d' },
  { cell: { gx: -3, gz: 9 }, slot: SHAFT, rot: 0, label: 'shaft-e' },
  { cell: { gx: -2, gz: 9 }, slot: SMELTER, rot: 0, label: 'smelter' },
];

const FORGE_BRANCH = [
  { cell: { gx: -5, gz: 7 }, slot: GEAR24, rot: 0, label: 'gear24-forge' },
  { cell: { gx: -4, gz: 7 }, slot: SHAFT, rot: 0, label: 'shaft-f1' },
  { cell: { gx: -3, gz: 7 }, slot: SHAFT, rot: 0, label: 'shaft-f2' },
  { cell: { gx: -2, gz: 7 }, slot: FORGE, rot: 0, label: 'forge' },
];

/**
 * 创建一份交互上下文。所有可变状态（points / 标定）都保存在这里，
 * 由 entry 传给各阶段，保证两个阶段共享同一个世界与同一次标定。
 */
export function createPortContext(play, h) {
  const assert = h.assert;
  const points = {};
  const calRef = { value: undefined };

  // ---- 放置朝向记账（本脚本必须自己做，原因如下） ----
  // `R` 在 mechanical 插件里既旋转放置幽灵、又被 mechanical-runtime 用来切换锻压机配方，
  // 一次按 R 会**同时**把幽灵转 90°。m18-helpers 的 placePartAtPoint 只按「目标 − 上次传入值」
  // 补按 R，它不知道配方切换偷偷转过幽灵，于是放溜槽时会多转 180°。
  // 这里自己维护「幽灵真实朝向 ghost」与「helper 记账 belief」，每次放置前手动补按 R，
  // 再以 belief 为参数调用 helper（让它一次都不按），放完用读投影核对实际旋转。
  let ghost = 0;

  const pressRotate = async (times) => {
    for (let index = 0; index < times; index += 1) {
      await play.keyboard.press('KeyR');
      await play.advance(0.06);
    }
    ghost = (ghost + 90 * times) % 360;
  };

  /** 切换锻压机配方：R 同时会转动放置幽灵，必须记账。 */
  const cycleRecipe = async () => {
    await play.keyboard.press('KeyR');
    await play.advance(0.2);
    ghost = (ghost + 90) % 360;
  };

  const removePart = async (cell, partId) => {
    await h.selectSlot(SHAFT);
    const point = await h.hoverSpecificPart(cal.value, cell, partId);
    assert(point !== null, 'must be able to aim at part ' + partId + ' to remove it');
    await play.mouse.move(point);
    await play.wait(130);
    await h.clickAt(point);
    await play.keyboard.press('Delete');
    await play.advance(0.4);
  };

  /**
   * 放置并要求最终旋转等于 rotation（不满足就删掉重试，最多 4 次）。
   * 始终以 0 作为 helper 的 rotation 参数 → helper 一次都不按 R（它的内部记账也不变），
   * 真正的转向全部由 pressRotate 完成并记在 ghost 上。
   */
  const placeRotated = async (pt, slot, rotation, label, cell) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const need = ((((rotation - ghost) % 360) + 360) % 360) / 90;
      await pressRotate(need);
      const part = await h.placePartAtPoint(pt, slot, 0, label, cell);
      const placed = (await h.state()).parts.find((entry) => entry.partId === part.partId);
      if (placed && placed.placement.rotation === rotation) return part;
      // 观测值优先：用真实旋转修正模型，删掉后重试。
      ghost = placed ? placed.placement.rotation : ghost;
      await removePart(cell, part.partId);
      pt = await h.pointForCell(cal.value, cell, { avoidHover: true });
    }
    throw new Error('could not place ' + label + ' with rotation ' + rotation);
  };

  const countOf = (state, itemId) => state.inventory.find((entry) => entry.itemId === itemId)?.count ?? 0;
  const machineOf = (state, recipeId) => state.production.machines.find((machine) => machine.recipeId === recipeId);
  const machineById = (state, partId) => state.production.machines.find((machine) => machine.partId === partId);

  const hoverMachine = async (cell, partId) => {
    await h.selectSlot(SHAFT);
    const point = await h.hoverSpecificPart(cal.value, cell, partId);
    assert(point !== null, 'must be able to aim at part ' + partId + ' at ' + JSON.stringify(cell));
    await play.mouse.move(point);
    await play.wait(140);
    return point;
  };

  const ensurePowered = async () => {
    let state = await h.state();
    if (state.sources[0].engaged === true && (state.sources[0].energy ?? 0) > 200) return state;
    // 关键：先把鼠标移到飞轮上再按住 C。按住 C 在机器上会触发「手动投料」，
    // 那会在补能量的同时偷偷消耗原料，污染后续的库存断言。
    await h.selectSlot(SHAFT);
    if (points['flywheel']) {
      await play.mouse.move(points['flywheel']);
      await play.wait(120);
    }
    await h.holdKey('KeyC', 5000);
    state = await h.state();
    if (state.sources[0].enabled !== true) {
      await h.selectSlot(SHAFT);
      await h.clickAt(points['flywheel']);
      await h.rightClickAt(points['flywheel']);
      await play.advance(0.4);
    }
    return h.state();
  };

  const feedByC = async (point, times) => {
    await play.mouse.move(point);
    await play.wait(140);
    for (let index = 0; index < times; index += 1) {
      await play.keyboard.press('KeyC');
      await play.advance(0.08);
    }
  };

  const takeByRightClick = async (point, times = 1) => {
    for (let index = 0; index < times; index += 1) {
      await play.mouse.move(point);
      await play.wait(130);
      await h.rightClickAt(point);
      await play.advance(0.3);
    }
  };
  return {
    points,
    calRef,
    assert,
    countOf,
    machineOf,
    machineById,
    hoverMachine,
    ensurePowered,
    feedByC,
    takeByRightClick,
    placeRotated,
    removePart,
    cycleRecipe,
    ORE_TARGET,
    SHAFT,
    GEAR12,
    CHUTE,
    CRUSHER_CELL,
    SMELTER_CELL,
    CHUTE_CELL,
    FORGE_CELL,
    LINE,
    FORGE_BRANCH,
  };
}
