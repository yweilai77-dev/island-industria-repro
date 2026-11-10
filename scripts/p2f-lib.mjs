// P2-E3/F 共用工具：真实键鼠/事务，唯一读取 GameRead `mechanical`；仅允许 __II_TEST_TECH__/__II_TEST_ENDGAME__。
import { createP2dCtx } from './p2d-assembly-lib.mjs';
import { createOrderKit } from './m20-order-lib.mjs';
import { trace } from './p2f-trace.mjs';

/** 快捷栏槽位（正式起步包绑定）。 */
export const SLOT = {
  SHAFT: 0, GEAR12: 1, GEAR24: 2, CHUTE: 6, VDRIVE: 7, FLY: 8, CRUSHER: 9, SMELTER: 10, FORGE: 11,
};
export const SLOT_OF_ITEM = {
  shaft: SLOT.SHAFT, gear_12: SLOT.GEAR12, gear_24: SLOT.GEAR24, chute: SLOT.CHUTE,
  vertical_drive: SLOT.VDRIVE, flywheel_source: SLOT.FLY, crusher: SLOT.CRUSHER,
  smelter: SLOT.SMELTER, forge: SLOT.FORGE,
};

export const LAYOUT_EARLY = [
  { cell: { gx: -8, gz: 8 }, slot: SLOT.FLY, rot: 0, label: 'E-flywheel' },
  { cell: { gx: -7, gz: 8 }, slot: SLOT.SHAFT, rot: 0, label: 'E-shaft-a' },
  { cell: { gx: -6, gz: 8 }, slot: SLOT.SHAFT, rot: 0, label: 'E-shaft-b' },
  { cell: { gx: -5, gz: 8 }, slot: SLOT.GEAR12, rot: 0, label: 'E-gear12-a' },
  { cell: { gx: -4, gz: 8 }, slot: SLOT.SHAFT, rot: 0, label: 'E-shaft-c' },
  { cell: { gx: -3, gz: 8 }, slot: SLOT.CRUSHER, rot: 0, label: 'E-crusher' },
  { cell: { gx: -5, gz: 9 }, slot: SLOT.GEAR24, rot: 0, label: 'E-gear24-b' },
  { cell: { gx: -4, gz: 9 }, slot: SLOT.SHAFT, rot: 0, label: 'E-shaft-d' },
  { cell: { gx: -3, gz: 9 }, slot: SLOT.SHAFT, rot: 0, label: 'E-shaft-e' },
  { cell: { gx: -2, gz: 9 }, slot: SLOT.SMELTER, rot: 0, label: 'E-smelter' },
  { cell: { gx: -5, gz: 7 }, slot: SLOT.GEAR24, rot: 0, label: 'E-gear24-a' },
  { cell: { gx: -4, gz: 7 }, slot: SLOT.SHAFT, rot: 0, label: 'E-shaft-f' },
  { cell: { gx: -3, gz: 7 }, slot: SLOT.SHAFT, rot: 0, label: 'E-shaft-g' },
  { cell: { gx: -2, gz: 7 }, slot: SLOT.FORGE, rot: 0, label: 'E-forge' },
  { cell: { gx: -2, gz: 8 }, slot: SLOT.CHUTE, rot: 270, label: 'E-chute' },
];

export const LAYOUT_FINAL = [
  { cell: { gx: -7, gz: 7 }, slot: SLOT.FLY, rot: 0, label: 'F-flywheel-a' },
  { cell: { gx: -6, gz: 7 }, slot: SLOT.GEAR12, rot: 0, label: 'F-gear-a1' },
  { cell: { gx: -5, gz: 7 }, slot: SLOT.FORGE, rot: 0, label: 'F-forge' },
  { cell: { gx: -6, gz: 8 }, slot: SLOT.GEAR12, rot: 0, label: 'F-gear-a2' },
  { cell: { gx: -5, gz: 8 }, slot: SLOT.SHAFT, rot: 0, label: 'F-shaft-a' },
  { cell: { gx: -4, gz: 8 }, slot: SLOT.CRUSHER, rot: 0, label: 'F-crusher' },
  { cell: { gx: -3, gz: 8 }, slot: SLOT.SMELTER, rot: 90, label: 'F-smelter-a' },
  { cell: { gx: -2, gz: 8 }, slot: SLOT.SMELTER, rot: 90, label: 'F-smelter-b' },
  { cell: { gx: -3, gz: 11 }, slot: SLOT.FLY, rot: 90, label: 'F-flywheel-b' },
  { cell: { gx: -3, gz: 10 }, slot: SLOT.GEAR12, rot: 90, label: 'F-gear-b1' },
  { cell: { gx: -3, gz: 9 }, slot: SLOT.SHAFT, rot: 90, label: 'F-shaft-b1' },
  { cell: { gx: -2, gz: 10 }, slot: SLOT.GEAR12, rot: 90, label: 'F-gear-b2' },
  { cell: { gx: -2, gz: 9 }, slot: SLOT.SHAFT, rot: 90, label: 'F-shaft-b2' },
];
export const FRAMES_FINAL = [{ gx: -4, gz: 7 }, { gx: -3, gz: 7 }, { gx: -2, gz: 7 }];


const R = (inCount, outItem, outCount, seconds) => ({ inItem: 'iron_ingot', inCount, outItem, outCount, seconds });
export const RECIPES = {
  'forge-shaft': R(2, 'shaft', 1, 5),
  'forge-vertical-drive': R(3, 'vertical_drive', 1, 6),
  'forge-chute': R(2, 'chute', 1, 4),
  'forge-interface-box': R(2, 'interface_box', 1, 5),
  'forge-output-box': R(2, 'output_interface_box', 1, 5),
  'forge-splitter-box': R(3, 'splitter_box', 1, 6),
  'forge-merger-box': R(3, 'merger_box', 1, 6),
  'forge-crusher': R(6, 'crusher', 1, 8),
  'forge-smelter': R(7, 'smelter', 1, 9),
  'forge-processing-core': R(8, 'forge', 1, 10),
  'forge-structure-frame': R(3, 'structure_frame', 1, 5),
  'forge-gear-12': R(1, 'gear_12', 2, 4),
  'forge-gear-24': R(1, 'gear_24', 1, 5),
  'forge-flywheel': R(12, 'flywheel_source', 1, 12),
  'forge-batch-shaft': R(4, 'shaft', 2, 7),
};

const TECH_NODES = {
  T11: 'tech:gear-manufacture', T12: 'tech:chute-logistics', T13: 'tech:cross-level-drive',
  T14: 'tech:input-interface', T21: 'tech:output-interface', T22: 'tech:split-merge',
  T23: 'tech:core-replication', T24: 'tech:flywheel-production', T25: 'tech:structure-assembly',
  T31: 'tech:batch-processing', T32: 'tech:line-integration', T33: 'tech:combined-works',
};
export { TECH_NODES };

/**
 * 创建完整 Playthrough 上下文：放置/端口/连接/组合助手 + 订单工具 + 本包专用生产/科技/存档助手。
 * @param {import('@forgeax/engine/devkit').PlayContext} play
 */
export function createP2f(play, h) {
  /** 由返回对象回填：内部生产助手复用「状态校验过」的投料/取货实现。 */
  let feedMachineInternal = null;
  let collectMachineInternal = null;
  const C = createP2dCtx(play, h);
  const K = createOrderKit(play, h);
  const { assert, state, countOf, machineById, machineOf } = C;
  const log = (label, payload) => console.log('P2F-' + label + '=' + JSON.stringify(payload));

  const techSnapshot = (s) => s.tech ?? null;
  const nodeOf = (s, nodeId) => techSnapshot(s)?.nodes?.find((node) => node.id === nodeId) ?? null;
  const nodeStatus = (s, nodeId) => nodeOf(s, nodeId)?.status ?? 'missing';
  const waitForState = async (label, predicate, timeoutSeconds = 20) => {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutSeconds * 1000) {
      await play.advance(0.3);
      last = await state();
      if (predicate(last)) return last;
    }
    throw new Error(label + ' timeout; last=' + JSON.stringify({
      tech: techSnapshot(last)?.nodes?.map((n) => n.id + ':' + n.status),
      inventory: last.inventory,
      machines: last.production?.machines,
    }));
  };

  // ---- 科技交付（与 UI 同一协议命令；真实校验 + 真实扣料） ----
  const submitTech = async (nodeId) => {
    await play.page.evaluate((id) => globalThis.__II_TEST_TECH__?.submitAll(id), nodeId);
    return waitForState('tech ' + nodeId + ' completed',
      (s) => nodeStatus(s, nodeId) === 'completed', 20);
  };
  const submitItem = async (nodeId, itemId, count) => {
    await play.page.evaluate((args) => globalThis.__II_TEST_TECH__?.submit(args.nodeId, args.itemId, args.count),
      { nodeId, itemId, count });
    await play.advance(0.5);
  };
  const trackTech = async (nodeId) => {
    await play.page.evaluate((id) => globalThis.__II_TEST_TECH__?.track(id), nodeId);
    await play.advance(0.5);
    return waitForState('tech tracked', (s) => techSnapshot(s)?.trackedId === nodeId, 5);
  };
  const beginProof = async () => {
    await play.page.evaluate(() => globalThis.__II_TEST_ENDGAME__?.beginProof());
    await play.advance(0.5);
  };

  /** 玩家移动后屏幕标定会失效：只有真的换过格才重新标定，避免每次交互都付标定成本。 */
  let lastCalibratedCell = null;
  const calibrateIfMoved = async (label = 'P2F') => {
    const s = await state();
    const cell = s.player.cell;
    if (lastCalibratedCell !== null
      && lastCalibratedCell.gx === cell.gx && lastCalibratedCell.gz === cell.gz) return;
    await C.calibrate(label);
    lastCalibratedCell = { gx: cell.gx, gz: cell.gz };
  };

  // ---- 动力与站位：走到飞轮旁 → 确保离合挂上 → 按住 C 储能 → 回到作业站位 ----
  let workSpot = null;
  const setWorkSpot = (cell) => { workSpot = { gx: cell.gx, gz: cell.gz }; };
  const goWorkSpot = async () => {
    if (workSpot === null) return;
    const s = await state();
    if (s.player.cell.gx === workSpot.gx && s.player.cell.gz === workSpot.gz) return;
    await h.gotoCell(workSpot, 12000, false);
  };
  /**
   * 飞轮可摇柄范围（米）。引擎规则：水平距离 <= range(2.2) 且同层；这里留 0.2 余量。
   * 关键：**不需要站在飞轮旁边**，只要在范围内就能摇——以前的实现强制走到邻格，
   * 一旦被自己建的机器挡住就报「cannot reach any winding spot」（真实失败原因之一）。
   */
  const WIND_RANGE = 2.0;
  const windDistance = (s, cell) => {
    const pos = s.player.position;
    const cx = cell.gx + 0.5;
    const cz = cell.gz + 0.5;
    return Math.hypot(pos[0] - cx, pos[2] - cz);
  };
  const withinWindRange = (s, cell) => s.player.level === 0 && windDistance(s, cell) <= WIND_RANGE;
  /** 站到能摇到飞轮的位置：优先原地（在范围内就直接摇），否则尝试八邻格/直走靠近。 */
  const approachWheel = async (cell) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let s = await state();
      if (withinWindRange(s, cell)) return true;
      const spots = [
        { gx: cell.gx + 1, gz: cell.gz }, { gx: cell.gx - 1, gz: cell.gz },
        { gx: cell.gx, gz: cell.gz + 1 }, { gx: cell.gx, gz: cell.gz - 1 },
        { gx: cell.gx + 1, gz: cell.gz + 1 }, { gx: cell.gx - 1, gz: cell.gz + 1 },
        { gx: cell.gx + 1, gz: cell.gz - 1 }, { gx: cell.gx - 1, gz: cell.gz - 1 },
      ];
      for (const spot of spots) {
        s = await state();
        if (s.parts.some((part) => part.placement.gx === spot.gx && part.placement.gz === spot.gz)) continue;
        if (await h.gotoCell(spot, 5000, false)) return true;
      }
      // 邻格都走不到：朝飞轮方向直走一段（允许从 2.2 m 外靠近到范围内）。
      s = await state();
      const pos = s.player.position;
      const dx = (cell.gx + 0.5) - pos[0];
      const dz = (cell.gz + 0.5) - pos[2];
      await h.holdToward(dx, dz, 900);
      await play.advance(0.2);
    }
    return withinWindRange(await state(), cell);
  };
  const windAt = async (flywheelCell, flywheelId, ms = 6500) => {
    let before = await state();
    const source = before.sources.find((entry) => entry.partId === flywheelId);
    if (source?.enabled !== true) {
      await calibrateIfMoved('WIND-ENABLE');
      await C.setSource(flywheelCell, flywheelId, true);
      before = await state();
    }
    const reached = await approachWheel(flywheelCell);
    assert(reached, 'cannot get within ' + WIND_RANGE + ' m of flywheel ' + JSON.stringify(flywheelCell)
      + '; player=' + JSON.stringify(before.player.cell) + ' pos=' + JSON.stringify(before.player.position));
    await calibrateIfMoved('WIND');
    await h.selectSlot(SLOT.SHAFT);
    // 摇柄 = 按住 C 让游戏继续跑（windRate 按模拟时间结算）。
    // 以前用「按住 C 等真实毫秒」，一次 6.5 s 真实时间；现在改成按住 C + advance(秒)：
    // 同一套物理（每帧 windRate*delta），但墙钟时间从 6.5 s 降到 ~0.3 s。
    const windSeconds = Math.max(1, ms / 1000);
    const energyOf = (snapshot) => snapshot.sources.find((entry) => entry.partId === flywheelId)?.energy ?? 0;
    const energyBefore = energyOf(await state());
    const crank = async (seconds) => {
      await play.page.keyboard.down('KeyC');
      try {
        await play.advance(seconds);
      } finally {
        try { await play.page.keyboard.up('KeyC'); } catch { /* 页面可能已卸载 */ }
      }
      await play.advance(0.1);
      return state();
    };
    let after = await crank(windSeconds);
    if (energyOf(after) <= energyBefore + 1) {
      // 输入没生效（没摇到/离得太远）：补摇一次并给出明确错误。
      after = await crank(Math.max(windSeconds, 2.5));
      const retried = energyOf(after);
      assert(retried > energyBefore + 1, 'winding produced no energy: before=' + energyBefore + ' after=' + retried
        + ' player=' + JSON.stringify(after.player.cell));
    }
    return after;
  };
  /** 所有飞轮补能：能量 < 250 的源优先，最多补 2 个（终局观察窗口用）。 */
  const windBoth = async (ms = 6500) => {
    let s = await state();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      s = await state();
      const entries = s.sources
        .map((source) => {
          const part = s.parts.find((entry) => entry.partId === source.partId);
          return { source, cell: part ? { gx: part.placement.gx, gz: part.placement.gz } : undefined };
        })
        .filter((entry) => entry.cell !== undefined);
      const target = entries
        .filter((entry) => (entry.source.energy ?? 0) < 250)
        .sort((a, b) => (a.source.energy ?? 0) - (b.source.energy ?? 0))[0];
      if (target === undefined) return s;
      s = await windAt(target.cell, target.source.partId, ms);
    }
    await goWorkSpot();
    return s;
  };
  /** 保证「驱动锻压机」的那个网络有能量：不足就走到对应飞轮补能。 */
  const ensurePower = async (minEnergy = 120) => {
    let s = await state();
    const forgeId = forgeIdOf(s);
    const network = forgeId === undefined
      ? undefined
      : s.networks.find((entry) => entry.machineIds.includes(forgeId));
    const sourceId = network?.sourceIds?.[0];
    const source = s.sources.find((entry) => entry.partId === sourceId) ?? s.sources[0];
    if (source === undefined) return s;
    // minEnergy 会被钳制到真实容量（旧代码传 999 是无效阈值：容量只有 300，
    // 于是每轮都去「补能」并尝试走到飞轮邻格，被机器挡住后误报无法摇柄）。
    const capacity = source.energyCapacity ?? 300;
    const target = Math.min(minEnergy, Math.max(1, capacity - 20));
    if (source.enabled === true && (source.energy ?? 0) >= target) return s;
    const part = s.parts.find((entry) => entry.partId === source.partId);
    if (part === undefined) return s;
    // 一次 windAt ≈ +250 能量；容量 300。补到接近满能量，减少补能次数（旧实现每轮都补）。
    let wound = s;
    for (let pass = 0; pass < 3; pass += 1) {
      wound = await windAt({ gx: part.placement.gx, gz: part.placement.gz }, source.partId, 6500);
      const now = wound.sources.find((entry) => entry.partId === source.partId);
      if ((now?.energy ?? 0) >= capacity - 40) break;
    }
    await goWorkSpot();
    return wound;
  };

  // ---- 生产 ----
  const crusherIdOf = (s) => machineOf(s, 'crush-iron-ore')?.partId;
  const smelterIdOf = (s) => machineOf(s, 'smelt-crushed-ore')?.partId;
  const forgeIdOf = (s) => s.production.machines.find((m) => m.recipeId?.startsWith('forge-'))?.partId;
  const cellOfMachine = (s, partId) => {
    const part = s.parts.find((entry) => entry.partId === partId);
    return part ? { gx: part.placement.gx, gz: part.placement.gz } : undefined;
  };
  const producedCount = (s, itemId) => s.production.produced.find((e) => e.itemId === itemId)?.count ?? 0;

  /** 大块推进游戏时间：每 6 s 检查一次并与动力维护配合（避免每帧轮询的实时开销）。 */
  const advanceUntil = async (label, predicate, maxGameSeconds = 120) => {
    let elapsed = 0;
    let last = await state();
    let noProgress = 0;
    let stamp = '';
    while (elapsed < maxGameSeconds) {
      last = await ensurePower(100);
      await play.advance(6);
      elapsed += 6;
      last = await state();
      if (predicate(last)) return last;
      // 连续 3 个 6s 窗口没有任何加工推进 → 提前失败并给出可定位的状态（避免长超时掩盖真实原因）。
      const nextStamp = JSON.stringify((last.production?.machines ?? []).map((m) => [m.partId, m.block, m.inputCount, m.progress, m.producedTotal]));
      noProgress = nextStamp === stamp ? noProgress + 1 : 0;
      stamp = nextStamp;
      if (noProgress >= 3) {
        throw new Error(label + ' stalled (no machine progress for 18 s): '
          + JSON.stringify({ machines: last.production?.machines, sources: last.sources, networks: last.networks?.map((n) => [n.id, n.status, n.speedFactor]) }));
      }
    }
    throw new Error(label + ' timeout after ' + maxGameSeconds + 's game; '
      + JSON.stringify({ produced: last.production?.produced, machines: last.production?.machines, sources: last.sources }));
  };

  /** 手动三段生产：矿→碎→锭（每轮 4 件，取空缓冲）。返回背包铁锭数。 */
  const runManualRounds = async (rounds) => {
    for (let round = 0; round < rounds; round += 1) {
      let s = await ensurePower();
      const crusherId = crusherIdOf(s);
      const smelterId = smelterIdOf(s);
      const crusherCell = cellOfMachine(s, crusherId);
      const smelterCell = cellOfMachine(s, smelterId);
      const crushedBefore = producedCount(s, 'crushed_ore');
      await (feedMachineInternal ?? C.feedMachine)(crusherCell, crusherId, 4);
      await advanceUntil('crush ' + round, (now) => producedCount(now, 'crushed_ore') >= crushedBefore + 4, 40);
      await (collectMachineInternal ?? C.collectMachine)(crusherCell, crusherId, 1);
      s = await ensurePower();
      const smeltBefore = producedCount(s, 'iron_ingot');
      await (feedMachineInternal ?? C.feedMachine)(smelterCell, smelterId, 4);
      await advanceUntil('smelt ' + round, (now) => producedCount(now, 'iron_ingot') >= smeltBefore + 4, 50);
      await (collectMachineInternal ?? C.collectMachine)(smelterCell, smelterId, 1);
    }
    return countOf(await state(), 'iron_ingot');
  };

  /** 自动送料（溜槽→输入盒）生产：只喂破碎机，收熔炼炉产物。 */
  const runAutoRounds = async (rounds) => {
    for (let round = 0; round < rounds; round += 1) {
      const s0 = await ensurePower();
      const crusherId = crusherIdOf(s0);
      const crusherCell = cellOfMachine(s0, crusherId);
      const smeltBefore = producedCount(s0, 'iron_ingot');
      await (feedMachineInternal ?? C.feedMachine)(crusherCell, crusherId, 4);
      const done = await advanceUntil('auto chain ' + round,
        (now) => producedCount(now, 'iron_ingot') >= smeltBefore + 4, 70);
      await (collectMachineInternal ?? C.collectMachine)(cellOfMachine(done, smelterIdOf(done)), smelterIdOf(done), 1);
    }
    const s = await state();
    return { ingots: countOf(s, 'iron_ingot'), crushed: countOf(s, 'crushed_ore') };
  };

  // ---- 锻压：切配方 → 投料 → 等产物 → 取货（自动分批，避免产物缓冲 4 格卡死） ----
  const switchForgeRecipe = async (forgeId, forgeCell, recipeId) => {
    await calibrateIfMoved('RECIPE');
    for (let guard = 0; guard < 24; guard += 1) {
      const s = await state();
      const machine = machineById(s, forgeId);
      if (machine === undefined) throw new Error('forge machine missing');
      if (machine.recipeId === recipeId && machine.inputCount === 0 && machine.progress === 0) return s;
      await C.cycleRecipeAt(forgeCell, forgeId);
    }
    const s = await state();
    throw new Error('cannot switch forge to ' + recipeId + ', now ' + machineById(s, forgeId)?.recipeId);
  };

  const craft = async (recipeId, cycles) => {
    const spec = RECIPES[recipeId];
    assert(spec !== undefined, 'unknown recipe ' + recipeId);
    await ensurePower();
    let s = await state();
    const forgeId = forgeIdOf(s);
    const forgeCell = cellOfMachine(s, forgeId);
    await switchForgeRecipe(forgeId, forgeCell, recipeId);
    const inCap = 12;
    const chunkMax = Math.max(1, Math.min(Math.floor(inCap / spec.inCount), Math.floor(4 / spec.outCount)));
    let remaining = cycles;
    let done = 0;
    while (remaining > 0) {
      const chunk = Math.min(chunkMax, remaining);
      s = await ensurePower();
      const before = machineById(s, forgeId).producedTotal;
      const wantInput = spec.inCount * chunk;
      if (countOf(s, spec.inItem) < wantInput) throw new Error('not enough ' + spec.inItem + ' for ' + recipeId);
      await (feedMachineInternal ?? C.feedMachine)(forgeCell, forgeId, wantInput);
      await advanceUntil('craft ' + recipeId + ' x' + chunk,
        (now) => machineById(now, forgeId).producedTotal >= before + spec.outCount * chunk,
        spec.seconds * chunk + 30);
      await (collectMachineInternal ?? C.collectMachine)(forgeCell, forgeId, 1);
      remaining -= chunk;
      done += chunk;
      const inv = countOf(await state(), spec.outItem);
      log('CRAFT', { recipeId, cycles: chunk, done, outItem: spec.outItem, outCount: spec.outCount, inventory: inv });
    }
    return countOf(await state(), spec.outItem);
  };

  /** 物品 → 唯一锻压配方（交付前按需补料；数量不足时只补差额）。 */
  const ITEM_RECIPE = {
    shaft: 'forge-shaft', gear_12: 'forge-gear-12', gear_24: 'forge-gear-24', chute: 'forge-chute',
    vertical_drive: 'forge-vertical-drive', interface_box: 'forge-interface-box',
    output_interface_box: 'forge-output-box', splitter_box: 'forge-splitter-box',
    merger_box: 'forge-merger-box', structure_frame: 'forge-structure-frame',
    crusher: 'forge-crusher', smelter: 'forge-smelter', forge: 'forge-processing-core', flywheel_source: 'forge-flywheel',
  };
  /** 按科技节点 cost 补齐真实材料（不注入；缺什么就真实锻什么）。 */
  const ensureDelivery = async (nodeId) => {
    let s = await state();
    const node = nodeOf(s, nodeId);
    assert(node !== undefined, 'unknown tech node ' + nodeId);
    for (const entry of node.cost) {
      s = await state();
      const have = countOf(s, entry.itemId);
      const missing = entry.count - have;
      if (missing <= 0) continue;
      const recipeId = ITEM_RECIPE[entry.itemId];
      assert(recipeId !== undefined, 'no recipe for delivery item ' + entry.itemId);
      const spec = RECIPES[recipeId];
      const cycles = Math.ceil(missing / spec.outCount);
      log('ENSURE-DELIVERY', { nodeId, itemId: entry.itemId, missing, recipeId, cycles });
      await craft(recipeId, cycles);
    }
    return state();
  };

  /** 保证背包里至少有 n 件物品（缺则真实锻造补齐，用于布局/安装前的备料）。 */
  const ensureStock = async (itemId, n) => {
    let s = await state();
    const have = countOf(s, itemId);
    if (have >= n) return have;
    const recipeId = ITEM_RECIPE[itemId];
    assert(recipeId !== undefined, 'no recipe to stock ' + itemId);
    const spec = RECIPES[recipeId];
    await craft(recipeId, Math.ceil((n - have) / spec.outCount));
    s = await state();
    const after = countOf(s, itemId);
    assert(after >= n, 'stock ' + itemId + ' must reach ' + n + ', got ' + after);
    return after;
  };

  /** 确保快捷栏绑定了某物品（产物/新零件进背包后需要重新绑定才能放置）。 */
  const ensureHotbar = async (itemId) => {
    const slot = SLOT_OF_ITEM[itemId];
    if (slot === undefined) return;
    const s = await state();
    if (s.ui.hotbar.slots[slot] === itemId) return;
    await K.bindHotbarFromBackpack(itemId, slot);
  };

  /** 悬停点缓存：key = partId@玩家格（玩家换格后屏幕坐标会变，缓存自然失效）。 */
  const hoverCache = new Map();
  /**
   * 直接瞄零件「顶面」：1m 高的机器常常挡住格子中心的射线，但顶面从俯视相机看是可见的。
   * 以格子中心的地面投影为基准，往上（屏幕 y 减小）偏移逐步搜索，命中 hoveredPartId 即返回。
   */
  const aimPartTop = async (cell, partId) => {
    const base = h.pointForCellRaw(C.calRef.value, cell);
    for (const up of [0.012, 0.022, 0.034, 0.05, 0.07, 0.095]) {
      for (const side of [0, -0.02, 0.02, -0.04, 0.04]) {
        const point = [Math.min(0.96, Math.max(0.04, base[0] + side)), Math.min(0.94, Math.max(0.06, base[1] - up))];
        await play.mouse.move(point);
        await play.wait(85);
        const s = await state();
        if (s.ui?.hoveredPartId === partId) return point;
      }
    }
    return null;
  };
  /** 给任意异步（CDP）操作加墙钟上限：挂住时快速失败并保留可定位的错误。 */
  const withWallTimeout = async (label, promise, ms) => {
    let timer = null;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' timed out after ' + Math.round(ms / 1000) + ' s wall')), ms);
    });
    // 超时后底层 CDP 调用可能才失败：先挂一个 catch，避免 unhandled rejection 干扰后续步骤。
    promise.catch(() => {});
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  };
  /** 每台机器的「能看见它的观察位」：hover 失败时换到这里再试（缓存复用）。 */
  const hoverVantage = new Map();
  const vantageSpotsFor = (cell) => [
    // 先试紧邻格（近距离看零件顶面最稳），再试 2-3 格外侧。
    { gx: cell.gx, gz: cell.gz + 1 }, { gx: cell.gx, gz: cell.gz - 1 },
    { gx: cell.gx + 1, gz: cell.gz }, { gx: cell.gx - 1, gz: cell.gz },
    { gx: cell.gx + 2, gz: cell.gz + 2 }, { gx: cell.gx + 2, gz: cell.gz - 2 },
    { gx: cell.gx - 2, gz: cell.gz + 2 }, { gx: cell.gx - 2, gz: cell.gz - 2 },
    { gx: cell.gx, gz: cell.gz + 3 }, { gx: cell.gx, gz: cell.gz - 3 },
    { gx: cell.gx + 3, gz: cell.gz }, { gx: cell.gx - 3, gz: cell.gz },
  ];

  const wrapAfterCalibration = (name, label) => async (...args) => {
    await calibrateIfMoved(label);
    return C[name](...args);
  };

  const api = {
    ...C,
    h,
    kit: K,
    calibrateIfMoved,
    aim: wrapAfterCalibration('aim', 'AIM'),
    placeRotated: wrapAfterCalibration('placeRotated', 'PLACE'),
    placeLayout: wrapAfterCalibration('placeLayout', 'LAYOUT'),
    onPart: wrapAfterCalibration('onPart', 'ONPART'),
    feedMachine: async (cell, partId, times, options = {}) => {
      const wallStartedF = Date.now();
      trace('FEED-START', { partId, times });
      await calibrateIfMoved('FEED');
      const capacityOf = (machine) => {
        if (machine === undefined || machine.recipeId === null) return 4;
        return machine.recipeId.startsWith('forge-') ? 12 : 4;
      };
      /** 机器状态指纹：投料成功必然让 inputCount/progress/producedTotal 之一变化。 */
      const signatureOf = (machine) => (machine === undefined
        ? 'missing'
        : [machine.inputCount, machine.outputCount, Math.round(machine.progress * 1000), machine.producedTotal, machine.recipeId].join('|'));
      let fed = 0;
      let attempts = 0;
      const maxAttempts = times * 3 + 6;
      while (fed < times && attempts < maxAttempts) {
        if (Date.now() - wallStartedF > 60000) {
          const stalledF = await state();
          throw new Error('feedMachine wall-timeout (60 s) part=' + partId + ' fed=' + fed + '/' + times
            + ' attempts=' + attempts + '; player=' + JSON.stringify(stalledF.player.cell)
            + ' hovered=' + String(stalledF.ui?.hoveredPartId) + ' machines='
            + JSON.stringify(stalledF.production.machines));
        }
        attempts += 1;
        let s = await state();
        let machine = machineById(s, partId);
        if (machine === undefined) throw new Error('feed target machine missing: ' + partId);
        const before = signatureOf(machine);
        if (s.ui?.hoveredPartId !== partId) {
          let hovered = false;
          // 先试缓存的悬停点（同一站位下稳定，避免每次都做 60+ 次探针搜索 = 数秒墙钟）。
          const cacheKey = partId + '@' + s.player.cell.gx + ',' + s.player.cell.gz;
          const cached = hoverCache.get(cacheKey);
          if (cached !== undefined) {
            await play.mouse.move(cached);
            await play.wait(90);
            s = await state();
            if (s.ui?.hoveredPartId === partId) hovered = true;
          }
          // 1) 先直接瞄顶面（最快、最不受遮挡影响）
          let topPoint = await withWallTimeout('aimPartTop ' + partId, aimPartTop(cell, partId), 12000);
          if (topPoint !== null) {
            hovered = true;
            hoverCache.set(cacheKey, topPoint);
          }
          // 2) 再退回格子搜索（最多一次，避免 60+ 探针 × 多次重试把流程拖到十几分钟）
          if (!hovered) {
            let point = null;
            try { point = await C.hoverPart(cell, partId); } catch (error) { /* 换位后再试 */ }
            await play.wait(90);
            s = await state();
            if (s.ui?.hoveredPartId === partId) {
              hovered = true;
              if (point !== null) hoverCache.set(cacheKey, point);
            }
          }
          if (!hovered) {
            // 遮挡/视角问题：只试 3 个观察位（相邻优先），且每次带墙钟上限，失败快返回。
            const vantages = [];
            const cachedSpot = hoverVantage.get(partId);
            if (cachedSpot !== undefined) vantages.push(cachedSpot);
            vantages.push(...vantageSpotsFor(cell).slice(0, 4));
            for (const spot of vantages) {
              if (!(await h.gotoCell(spot, 3500, false))) continue;
              await calibrateIfMoved('FEED-VANTAGE');
              let point = null;
              try { topPoint = await withWallTimeout('aimPartTop-vantage', aimPartTop(cell, partId), 8000); } catch (error) { topPoint = null; }
              if (topPoint !== null) {
                hovered = true;
                hoverVantage.set(partId, spot);
                hoverCache.set(partId + '@' + spot.gx + ',' + spot.gz, topPoint);
                break;
              }
              try { point = await C.hoverPart(cell, partId); } catch (error) { /* 下一个观察位 */ }
              await play.wait(80);
              s = await state();
              if (s.ui?.hoveredPartId === partId) {
                hovered = true;
                hoverVantage.set(partId, spot);
                if (point !== null) hoverCache.set(partId + '@' + spot.gx + ',' + spot.gz, point);
                break;
              }
            }
          }
          if (!hovered) {
            log('FEED-HOVER-MISS', { partId, attempts, player: (await state()).player.cell });
            continue;
          }
        }
        // 显式按键生命周期：down -> 90ms -> up（finally 保证释放，不留遗留按键）。
        try {
          await play.page.keyboard.down('KeyC');
          await play.wait(90);
        } finally {
          try { await play.page.keyboard.up('KeyC'); } catch { /* 页面可能已卸载 */ }
        }
        await play.advance(0.15);
        s = await state();
        machine = machineById(s, partId);
        if (signatureOf(machine) !== before) { fed += 1; continue; }
        // 状态没变化：输入缓冲已满（合法，调用方会推进生产）或这一次按 C 丢了。
        if (machine !== undefined && machine.inputCount >= capacityOf(machine)) { fed += 1; continue; }
        log('FEED-RETRY', { partId, attempts, fed, before, hovered: s.ui?.hoveredPartId ?? null });
      }
      trace('FEED-END', { partId, fed, times, attempts });
      if (fed < times) {
        log('FEED-INCOMPLETE', { partId, fed, times, attempts });
        if (options.strict === true) {
          throw new Error('feeding ' + times + ' item(s) into part ' + partId + ' failed: fed=' + fed + ' attempts=' + attempts);
        }
      }
      return state();
    },
    collectMachine: async (cell, partId, times = 1) => {
      await calibrateIfMoved('COLLECT');
      const s = await state();
      const machine = machineById(s, partId);
      const before = machine === undefined ? null : { item: machine.outputItem, count: machine.outputCount, produced: machine.producedTotal };
      await (collectMachineInternal ?? C.collectMachine)(cell, partId, times);
      let after = await state();
      const now = machineById(after, partId);
      if (before !== null && before.count > 0 && now !== undefined && now.outputCount >= before.count) {
        // 取货没生效：重试一次（右键丢帧）。
        await (collectMachineInternal ?? C.collectMachine)(cell, partId, 1);
        after = await state();
      }
      return after;
    },
    removePart: wrapAfterCalibration('removePart', 'REMOVE'),
    placeFrameAt: wrapAfterCalibration('placeFrameAt', 'FRAME'),
    removeAllParts: wrapAfterCalibration('removeAllParts', 'REMOVE-ALL'),
    log, techSnapshot, nodeOf, nodeStatus, waitForState, advanceUntil,
    submitTech, submitItem, trackTech, beginProof,
    windAt, windBoth, ensurePower, setWorkSpot, goWorkSpot,
    crusherIdOf, smelterIdOf, forgeIdOf, cellOfMachine, producedCount,
    runManualRounds, runAutoRounds, switchForgeRecipe, craft, ensureHotbar, ensureDelivery, ensureStock, ITEM_RECIPE,
  };
  // 主流程返回之后，内部生产助手也改走「状态校验过」的投料/取货实现（避免两套行为）。
  feedMachineInternal = api.feedMachine;
  collectMachineInternal = api.collectMachine;
  return api;
}