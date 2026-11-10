// M1.8 playthrough 共用工具：用真实鼠标/键盘事件驱动，靠 GameRead 的 buildTarget 做屏幕↔格子标定。
//
// 设计原则（不许走捷径）：
// - 所有放置都靠真实鼠标点击；本文件只负责「把目标格换算成屏幕归一化坐标」；
// - 换算靠探针 + 仿射拟合 + 牛顿迭代修正，探针读的是游戏自己的建造目标状态；
// - 每次放置前断言目标格与合法性，绝不「点下去再看运气」。

const DEFAULT_READ = 'mechanical';

export function createHarness(play) {
  /**
   * 显式按键生命周期：down -> 持续 -> 一定 up（finally）。
   * devkit 的 keyboard.hold 已经这么做，但装备/上层的异常路径里偶发遗留按键状态；
   * 这里统一走自己的封装，并在导航超时/卡位时强制释放移动键。
   */
  const MOVEMENT_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  const holdKeys = async (keys, ms) => {
    const list = typeof keys === 'string' ? [keys] : [...keys];
    let down = 0;
    try {
      for (const key of list) { await play.page.keyboard.down(key); down += 1; }
      await play.wait(ms);
    } finally {
      for (let index = down - 1; index >= 0; index -= 1) {
        try { await play.page.keyboard.up(list[index]); } catch { /* 页面可能已卸载 */ }
      }
    }
  };
  const releaseMovement = async () => {
    for (const key of MOVEMENT_KEYS) {
      try { await play.page.keyboard.up(key); } catch { /* ignore */ }
    }
  };
  const releaseAll = async () => {
    for (const key of [...MOVEMENT_KEYS, 'KeyC', 'KeyF', 'KeyR', 'KeyT', 'KeyY', 'KeyO', 'KeyK', 'KeyL', 'KeyJ', 'KeyH', 'KeyP', 'KeyQ', 'KeyE', 'KeyX', 'KeyV']) {
      try { await play.page.keyboard.up(key); } catch { /* ignore */ }
    }
  };
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  /** 切到空快捷栏槽（索引 5），回到普通建造模式，便于读取建造目标。 */
  const parkOnEmptySlot = async () => {
    await play.keyboard.press('Digit6');
    await play.advance(0.05);
    const s = await state();
    assert(s.ui?.hotbar?.selected === 5, 'expected empty hotbar slot 5, got ' + s.ui?.hotbar?.selected);
  };

  const state = async () => play.state(DEFAULT_READ);

  const probeCell = async (pt) => {
    await play.mouse.move([pt[0], pt[1]]);
    // 鼠标位置 -> 拾取结果可能晚一帧，探针需要短暂等待（90ms ≈ 5 帧）。
    await play.wait(90);
    const s = await state();
    const t = s.ui?.buildTarget;
    const hovered = s.ui?.hoveredPartId ?? null;
    if (!t || !t.active || !t.cell) return null;
    return { gx: t.cell.gx, gz: t.cell.gz, level: t.level, valid: t.valid, hovered };
  };

  // ---- 最小二乘拟合 gx,gz ≈ a*x + b*y + c ----
  const solve3 = (m, v) => {
    const a = m.map((row) => row.slice());
    const b = v.slice();
    for (let col = 0; col < 3; col += 1) {
      let pivot = col;
      for (let row = col + 1; row < 3; row += 1) {
        if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
      }
      if (Math.abs(a[pivot][col]) < 1e-12) return null;
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
      const div = a[col][col];
      for (let k = col; k < 3; k += 1) a[col][k] /= div;
      b[col] /= div;
      for (let row = 0; row < 3; row += 1) {
        if (row === col) continue;
        const factor = a[row][col];
        if (factor === 0) continue;
        for (let k = col; k < 3; k += 1) a[row][k] -= factor * a[col][k];
        b[row] -= factor * b[col];
      }
    }
    return [b[0], b[1], b[2]];
  };

  const fitAffine = (samples) => {
    // samples: [{x,y,gx,gz}]
    const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const atgx = [0, 0, 0];
    const atgz = [0, 0, 0];
    for (const s of samples) {
      const row = [s.x, s.y, 1];
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) ata[i][j] += row[i] * row[j];
        atgx[i] += row[i] * (s.gx + 0.5);
        atgz[i] += row[i] * (s.gz + 0.5);
      }
    }
    const fx = solve3(ata, atgx);
    const fz = solve3(ata, atgz);
    if (!fx || !fz) return null;
    return { fx, fz };
  };

  const invert2 = (a1, b1, a2, b2) => {
    const det = a1 * b2 - b1 * a2;
    if (Math.abs(det) < 1e-12) return null;
    return {
      m00: b2 / det,
      m01: -b1 / det,
      m10: -a2 / det,
      m11: a1 / det,
    };
  };

  /**
   * 标定：在屏幕上撒若干探针，拟合「屏幕坐标 → 格子坐标」，供 pointForCell 反解。
   *
   * 标定前先把快捷栏切到空槽（索引 5）：这样处于「普通建造模式」，
   * 建造目标读数对任何格都会给出答案（不会因为格里有机械零件而变成 hover 导致没有目标）。
   * 只标定玩家当前所在层。
   */
  const calibrate = async (label = 'calibrate') => {
    await parkOnEmptySlot();
    // 密度要够：玩家站在二楼平台上时，屏幕上只有平台那一块是「有该层支撑」的格，
    // 稀疏探针很可能只命中最少数，仿射拟合会失败。
    // 5x7 探针（35 点）足够拟合仿射（最少 4 点即可），比 6x9=54 点快约 35%。
    const points = [];
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 7; col += 1) {
        points.push([0.2 + col * 0.1, 0.26 + row * 0.1]);
      }
    }
    const samples = [];
    const collectPoints = async (list) => {
      for (const pt of list) {
        const cell = await probeCell(pt);
        if (cell) samples.push({ x: pt[0], y: pt[1], gx: cell.gx, gz: cell.gz });
      }
    };
    await collectPoints(points);
    // 二楼可能只有很小的可建造区域（玩家自建几块楼板），粗网格命中不足时
    // 以已命中的点为质心再做一轮更密的网格，避免仿射拟合被少数点带偏。
    if (samples.length >= 1 && samples.length < 12) {
      const cx = samples.reduce((sum, s) => sum + s.x, 0) / samples.length;
      const cy = samples.reduce((sum, s) => sum + s.y, 0) / samples.length;
      const fine = [];
      for (let row = 0; row < 11; row += 1) {
        for (let col = 0; col < 13; col += 1) {
          fine.push([cx - 0.072 + col * 0.012, cy - 0.075 + row * 0.015]);
        }
      }
      await collectPoints(fine);
    }
    await play.mouse.move([0.02, 0.02]);
    assert(samples.length >= 4, label + ': calibration needs at least 4 probes, got ' + samples.length);
    const fit = fitAffine(samples);
    assert(fit !== null, label + ': affine fit failed');
    const inv = invert2(fit.fx[0], fit.fx[1], fit.fz[0], fit.fz[1]);
    assert(inv !== null, label + ': screen→cell matrix is singular');
    console.log(label + '=CALIBRATED samples=' + samples.length
      + ' jacobian=[' + fit.fx[0].toFixed(2) + ',' + fit.fx[1].toFixed(2) + ';'
      + fit.fz[0].toFixed(2) + ',' + fit.fz[1].toFixed(2) + ']');
    return { fit, inv };
  };

  /** 反解某格中心对应的屏幕坐标（牛顿迭代把探针结果收敛到目标格）。 */
  const pointForCell = async (cal, cell, options = {}) => {
    const avoidHover = options.avoidHover === true;
    // 探针必须在「普通建造模式」下读目标，否则格里有机械零件时会变成 hover、读不到格。
    await parkOnEmptySlot();
    const { fit, inv } = cal;
    const targetX = cell.gx + 0.5;
    const targetZ = cell.gz + 0.5;
    let x = inv.m00 * (targetX - fit.fx[2]) + inv.m01 * (targetZ - fit.fz[2]);
    let y = inv.m10 * (targetX - fit.fx[2]) + inv.m11 * (targetZ - fit.fz[2]);
    x = Math.min(0.96, Math.max(0.04, x));
    y = Math.min(0.94, Math.max(0.06, y));
    // 拟合本身在整个「玩家所在层」平面上都成立，所以即使某点没有可建造支撑（探针返回 null），
    // 也能用拟合式估出它落在哪一格，继续往目标格收敛。
    const estimateAt = (px, py) => ({
      gx: Math.floor(fit.fx[0] * px + fit.fx[1] * py + fit.fx[2]),
      gz: Math.floor(fit.fz[0] * px + fit.fz[1] * py + fit.fz[2]),
    });
    // 需要「鼠标不要压在已有零件上」时，靠这一组格内偏移把瞄准点在目标格里挪开。
    const NUDGES = [
      [0.32, 0], [-0.32, 0], [0, 0.32], [0, -0.32],
      [0.32, 0.32], [-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32],
    ];
    let nudgeIndex = 0;
    for (let attempt = 0; attempt < 26; attempt += 1) {
      const probed = await probeCell([x, y]);
      if (probed && probed.gx === cell.gx && probed.gz === cell.gz) {
        if (!avoidHover || probed.hovered === null) {
          await play.mouse.move([0.02, 0.02]);
          return [x, y];
        }
        const nudge = NUDGES[nudgeIndex % NUDGES.length];
        nudgeIndex += 1;
        x = Math.min(0.96, Math.max(0.04, x + inv.m00 * nudge[0] + inv.m01 * nudge[1]));
        y = Math.min(0.94, Math.max(0.06, y + inv.m10 * nudge[0] + inv.m11 * nudge[1]));
        continue;
      }
      const here = probed ?? estimateAt(x, y);
      const dGx = targetX - (here.gx + 0.5);
      const dGz = targetZ - (here.gz + 0.5);
      if (Math.abs(dGx) < 1e-9 && Math.abs(dGz) < 1e-9 && probed) {
        await play.mouse.move([0.02, 0.02]);
        return [x, y];
      }
      const stepX = inv.m00 * dGx + inv.m01 * dGz;
      const stepY = inv.m10 * dGx + inv.m11 * dGz;
      // 单步限幅，避免离群样本把点甩飞。
      x = Math.min(0.96, Math.max(0.04, x + Math.max(-0.06, Math.min(0.06, stepX))));
      y = Math.min(0.94, Math.max(0.06, y + Math.max(-0.05, Math.min(0.05, stepY))));
    }
    // 主循环收敛失败：以仿射估计点为中心做一次**稠密 2D 局部扫描**。
    // 相邻 1m 机械零件会挡住格子中心的射线，但目标格通常仍有可见的边角；
    // 稠密扫描不依赖方向假设，比「几个半径 × 几个方向」更容易找到这种边角。
    const scanStep = 0.015;
    const scanRadius = 0.1;
    for (let radius = 0; radius <= scanRadius + 1e-9; radius += scanStep) {
      const offsets = radius === 0 ? [[0, 0]] : [];
      if (radius > 0) {
        const ring = Math.max(1, Math.round((2 * Math.PI * radius) / scanStep));
        for (let index = 0; index < ring; index += 1) {
          const angle = (index / ring) * Math.PI * 2;
          offsets.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
        }
      }
      for (const [dx, dy] of offsets) {
        const candidate = [Math.min(0.96, Math.max(0.04, x + dx)), Math.min(0.94, Math.max(0.06, y + dy))];
        const probed = await probeCell(candidate);
        if (probed && probed.gx === cell.gx && probed.gz === cell.gz) {
          if (avoidHover && probed.hovered !== null) continue;
          await play.mouse.move([0.02, 0.02]);
          return candidate;
        }
      }
    }
    // 最后兜底：全屏粗扫（只在这个格子上一次都没探到时付这个成本）。
    // 相邻零件遮挡 / 标定漂移时，局部搜索可能一直落在错误的格子上；全屏扫描保证「只要可见就能找到」。
    for (let sy = 0.18; sy <= 0.92; sy += 0.08) {
      for (let sx = 0.12; sx <= 0.94; sx += 0.08) {
        const candidate = [sx, sy];
        const probed = await probeCell(candidate);
        if (probed && probed.gx === cell.gx && probed.gz === cell.gz) {
          if (avoidHover && probed.hovered !== null) continue;
          await play.mouse.move([0.02, 0.02]);
          return candidate;
        }
      }
    }
    throw new Error('could not resolve screen point for cell ' + cell.gx + ',' + cell.gz);
  };

  const currentTarget = async () => {
    const s = await state();
    return s.ui?.buildTarget ?? null;
  };

  /** 进入/退出楼层建造模式。 */
  const setFloorMode = async (active) => {
    const s = await state();
    const isActive = s.ui?.floorMode?.active === true;
    if (isActive === active) return;
    await play.keyboard.press('KeyV');
    await play.advance(0.05);
    const after = await state();
    assert((after.ui?.floorMode?.active === true) === active, 'floor mode toggle failed');
  };

  const selectFloorKind = async (kind) => {
    const index = { pillar: 0, deck: 1, opening: 2, stair: 3 }[kind];
    assert(index !== undefined, 'unknown floor kind ' + kind);
    await play.keyboard.press(['Digit1', 'Digit2', 'Digit3', 'Digit4'][index]);
    await play.advance(0.05);
    const s = await state();
    assert(s.ui?.floorMode?.kind === kind, 'floor kind should be ' + kind + ', got ' + s.ui?.floorMode?.kind);
  };

  /** 放置一个楼层结构（真实按键 + 真实点击）。 */
  const placeFloor = async (cal, kind, cell, rotation = 0) => {
    await selectFloorKind(kind);
    const turns = Math.round((rotation % 360) / 90);
    for (let i = 0; i < turns; i += 1) {
      await play.keyboard.press('KeyR');
      await play.advance(0.03);
    }
    const pt = await pointForCell(cal, cell);
    await play.mouse.move(pt);
    await play.wait(140);
    const target = await currentTarget();
    assert(target?.active === true, 'no build target at ' + kind + ' ' + cell.gx + ',' + cell.gz);
    assert(target.valid === true, kind + ' placement invalid at ' + cell.gx + ',' + cell.gz
      + ' (' + JSON.stringify(target) + ')');
    await play.mouse.click(pt);
    await play.wait(180);
  };

  /** 拆除鼠标指向的楼层结构。 */
  const removeFloorAt = async (cal, cell) => {
    const pt = await pointForCell(cal, cell);
    await play.mouse.move(pt);
    await play.wait(120);
    await play.keyboard.press('KeyX');
    await play.advance(0.05);
  };

  /** 只用仿射式反解屏幕点（不探针）。用于目标格已被零件占用、探针拿不到建造目标的情况。 */
  const pointForCellRaw = (cal, cell) => {
    const { fit, inv } = cal;
    const tx = cell.gx + 0.5;
    const tz = cell.gz + 0.5;
    const x = inv.m00 * (tx - fit.fx[2]) + inv.m01 * (tz - fit.fz[2]);
    const y = inv.m10 * (tx - fit.fx[2]) + inv.m11 * (tz - fit.fz[2]);
    return [Math.min(0.96, Math.max(0.04, x)), Math.min(0.94, Math.max(0.06, y))];
  };

  /**
   * 找到「鼠标悬停到某格上的零件」的屏幕点：从仿射估计点出发做小范围搜索，
   * 直到 `hoveredPartId` 非空。返回 { point, partId } 或 null。
   */
  const hoverPartAt = async (cal, cell) => {
    const base = pointForCellRaw(cal, cell);
    for (const [dx, dy] of SCREEN_NUDGES) {
      const candidate = [Math.min(0.97, Math.max(0.03, base[0] + dx)), Math.min(0.95, Math.max(0.05, base[1] + dy))];
      await play.mouse.move(candidate);
      await play.wait(120);
      const s = await state();
      const hovered = s.ui?.hoveredPartId ?? null;
      if (hovered !== null) return { point: candidate, partId: hovered };
    }
    return null;
  };

  /**
   * 找到「射线真的打到指定零件」的屏幕点。
   * 相邻格上的高零件会挡住目标零件（射线先撞到它），所以这里在仿射估计点周围
   * 做 8 方向 × 多半径的搜索，直到 hoveredPartId 等于目标 id。
   */
  const hoverSpecificPart = async (cal, cell, partId) => {
    const base = pointForCellRaw(cal, cell);
    // 1m 高的机器会挡住「格子中心」的射线；目标零件的顶面通常要往上瞄（屏幕 y 减小）。
    // 因此搜索要包含更大的半径，并优先/额外覆盖向上方向。
    const dirs = [
      [0, 0], [0, -1], [0, 1], [1, 0], [-1, 0],
      [0.7, -0.7], [-0.7, -0.7], [0.7, 0.7], [-0.7, 0.7],
      [0.4, -0.9], [-0.4, -0.9], [0.9, -0.4], [-0.9, -0.4],
    ];
    for (const radius of [0, 0.006, 0.012, 0.02, 0.03, 0.042, 0.055, 0.07, 0.09, 0.12, 0.16]) {
      for (const [dx, dy] of dirs) {
        const candidate = [
          Math.min(0.97, Math.max(0.03, base[0] + dx * radius)),
          Math.min(0.95, Math.max(0.05, base[1] + dy * radius)),
        ];
        await play.mouse.move(candidate);
        await play.wait(110);
        const s = await state();
        if ((s.ui?.hoveredPartId ?? null) === partId) return candidate;
      }
    }
    return null;
  };

  // ---------------- 机械零件放置 ----------------
  /** 选择快捷栏槽位（真实按键）。第 11/12 格用 `-`/`=`。 */
  const selectSlot = async (index) => {
    const codes = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6',
      'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
    const code = codes[index];
    assert(code !== undefined, 'invalid hotbar slot ' + index);
    await play.keyboard.press(code);
    await play.advance(0.04);
  };

  /**
   * 在指定屏幕点附近放置机械零件。
   * 相邻格上的高零件（例如立式传动带高 3m）会挡住目标格的射线，让「悬停零件」抢走建造目标；
   * 所以这里在目标格内做一次小范围搜索，找到「落在目标格 + 没有压到任何零件」的瞄准点。
   */
  const SCREEN_NUDGES = (() => {
    const list = [[0, 0]];
    for (const radius of [0.008, 0.016, 0.026, 0.038]) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
        list.push([dx * radius, dy * radius]);
      }
    }
    return list;
  })();

  const aimAt = async (pt, cell) => {
    for (const [dx, dy] of SCREEN_NUDGES) {
      const candidate = [Math.min(0.97, Math.max(0.03, pt[0] + dx)), Math.min(0.95, Math.max(0.05, pt[1] + dy))];
      await play.mouse.move(candidate);
      await play.wait(140);
      const s = await state();
      const t = s.ui?.buildTarget;
      const hovered = s.ui?.hoveredPartId ?? null;
      if (!t?.active || !t.cell) continue;
      if (hovered !== null) continue;
      if (cell && (t.cell.gx !== cell.gx || t.cell.gz !== cell.gz)) continue;
      if (t.valid !== true) continue;
      return { point: candidate, state: s };
    }
    return null;
  };

  const placePartAtPoint = async (pt, slot, rotation = 0, label = 'part', cell = null) => {
    await selectSlot(slot);
    // 机械放置的朝向是**全局累积**状态：必须按「目标 − 上一次」的差值按 R，
    // 否则第二次放齿轮时会带着上一次（例如溜槽的 270°）朝向，端口全部转错方向、连不上。
    const turns = ((((rotation - lastPlacementRotation) % 360) + 360) % 360) / 90;
    for (let i = 0; i < turns; i += 1) {
      await play.keyboard.press('KeyR');
      await play.advance(0.03);
    }
    lastPlacementRotation = ((rotation % 360) + 360) % 360;
    const aimed = await aimAt(pt, cell);
    const aimedState = aimed ? aimed.state : await state();
    if (label) {
      console.log('PLACE-PROBE ' + label + ' aimed=' + (aimed ? 'yes' : 'no')
        + ' slot=' + aimedState.ui?.hotbar?.selected
        + ' selectedItem=' + String(aimedState.ui?.selectedItem)
        + ' target=' + JSON.stringify(aimedState.ui?.buildTarget)
        + ' hover=' + JSON.stringify(aimedState.ui?.hoveredPartId));
    }
    assert(aimed !== null,
      label + ': no aim point found for'
      + (cell ? ' cell ' + cell.gx + ',' + cell.gz : ' the given point')
      + ' — target=' + JSON.stringify(aimedState.ui?.buildTarget)
      + ' hover=' + JSON.stringify(aimedState.ui?.hoveredPartId));
    const before = aimedState.parts.length;
    await play.mouse.click(aimed.point);
    await play.wait(240);
    const after = await state();
    assert(after.parts.length === before + 1,
      label + ': click did not create a part'
      + (cell ? ' at ' + cell.gx + ',' + cell.gz : '')
      + ', parts ' + before + ' -> ' + after.parts.length
      + ' target=' + JSON.stringify(after.ui?.buildTarget));
    return after.parts[after.parts.length - 1];
  };

  /** 按格子放置机械零件（该格必须还没有零件）。 */
  const placePart = async (cal, slot, cell, rotation = 0, label = 'part') => {
    const pt = await pointForCell(cal, cell);
    return placePartAtPoint(pt, slot, rotation, label, cell);
  };

  // ---------------- 玩家导航 ----------------
  // 相机是 8 向俯视（默认 yaw = 45°），所以 WASD 的世界方向不是轴对齐的。
  // 这里在运行时实测四个方向键的世界单位向量，再按目标方向挑最合适的按键组合，
  // 不假设任何固定 yaw。
  let learned = null;
  let lastPlacementRotation = 0;
  const KEY_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  const KEY_SUBSETS = [
    ['KeyW'], ['KeyA'], ['KeyS'], ['KeyD'],
    ['KeyW', 'KeyA'], ['KeyW', 'KeyD'], ['KeyA', 'KeyS'], ['KeyS', 'KeyD'],
  ];

  const learnMovement = async () => {
    const measure = async (key) => {
      const before = (await state()).player.position;
      await holdKeys([key], 260);
      await play.advance(0.05);
      const after = (await state()).player.position;
      const dx = after[0] - before[0];
      const dz = after[2] - before[2];
      const len = Math.hypot(dx, dz);
      return len > 1e-6 ? [dx / len, dz / len] : [0, 0];
    };
    learned = {};
    for (const key of KEY_CODES) learned[key] = await measure(key);
    console.log('LEARNED=' + JSON.stringify(learned));
    return learned;
  };

  const keysToward = (dx, dz) => {
    if (!learned) throw new Error('learnMovement() must run before navigating');
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) return [];
    const tx = dx / len;
    const tz = dz / len;
    let best = [];
    let bestDot = -Infinity;
    for (const subset of KEY_SUBSETS) {
      let sx = 0;
      let sz = 0;
      for (const key of subset) {
        sx += learned[key][0];
        sz += learned[key][1];
      }
      const slen = Math.hypot(sx, sz);
      if (slen < 1e-9) continue;
      const dot = (sx / slen) * tx + (sz / slen) * tz;
      if (dot > bestDot) {
        bestDot = dot;
        best = subset;
      }
    }
    return best;
  };

  const holdToward = async (dx, dz, ms) => {
    const keys = keysToward(dx, dz);
    if (keys.length === 0) return;
    await holdKeys(keys, ms);
  };

  /** 沿世界方向持续前进，直到玩家所在格等于目标格（有超时保护）。 */
  const gotoCell = async (cell, timeoutMs = 14000, trace = false) => {
    const started = Date.now();
    let iteration = 0;
    let lastCell = null;
    let stuck = 0;
    try {
      while (Date.now() - started < timeoutMs) {
        const s = await state();
        const current = s.player.cell;
        if (current.gx === cell.gx && current.gz === cell.gz) {
          if (trace) console.log('WALK-OK ' + JSON.stringify(current) + ' in ' + iteration + ' steps');
          return true;
        }
        if (lastCell !== null && lastCell.gx === current.gx && lastCell.gz === current.gz) stuck += 1;
        else stuck = 0;
        lastCell = { gx: current.gx, gz: current.gz };
        const keys = keysToward(cell.gx - current.gx, cell.gz - current.gz);
        if (keys.length === 0) return true;
        if (trace && iteration % 6 === 0) {
          console.log('WALK ' + iteration + ' ' + JSON.stringify(current) + ' keys=' + keys.join('+')
            + ' pos=' + JSON.stringify(s.player.position.map((v) => Math.round(v * 100) / 100)));
        }
        // 卡位（连续 6 次没有换格）：垂直方向侧移一步，绕开自己建出来的机器/楼梯。
        if (stuck >= 6) {
          const dx = cell.gx - current.gx;
          const dz = cell.gz - current.gz;
          const perp = stuck % 12 === 6 ? { x: -dz, z: dx } : { x: dz, z: -dx };
          await holdToward(perp.x, perp.z, 320);
          stuck = 0;
        } else {
          await holdKeys(keys, 130);
        }
        iteration += 1;
      }
    } finally {
      await releaseMovement();
    }
    if (trace) {
      const s = await state();
      console.log('WALK-STUCK at ' + JSON.stringify(s.player.cell) + ' target=' + JSON.stringify(cell));
    }
    return false;
  };

  /** 一直朝某世界方向走，直到玩家层数变成目标层（爬楼梯 / 下楼）。 */
  const climbTo = async (level, dirX, dirZ, maxIterations = 90) => {
    for (let i = 0; i < maxIterations; i += 1) {
      const s = await state();
      if (s.player.level === level) return true;
      await holdToward(dirX, dirZ, 180);
    }
    const s = await state();
    console.log('CLIMB-FAIL level=' + s.player.level + ' cell=' + JSON.stringify(s.player.cell));
    return false;
  };

  /** 鼠标点到某个已知屏幕点（用于选中零件）。 */
  const clickAt = async (pt) => {
    await play.mouse.move(pt);
    await play.wait(140);
    await play.mouse.click(pt);
    await play.wait(180);
  };

  /** 按住某键指定毫秒（摇柄、持续时间型交互用）。 */
  const holdKey = async (key, ms) => {
    await holdKeys(key, ms);
    await play.advance(0.05);
  };

  const findPart = async (predicate) => {
    const s = await state();
    return s.parts.find(predicate);
  };

  /** 让鼠标悬停到某格上的零件（用于右键交互 / 悬停读数）。 */
  const hoverCell = async (cal, cell) => {
    const pt = await pointForCell(cal, cell);
    await play.mouse.move(pt);
    await play.wait(200);
    return pt;
  };

  const rightClickAt = async (pt) => {
    // 用原生 Playwright 右键（与 M1.7 验收脚本同一路径，最可靠）。
    const size = play.page.viewportSize() ?? { width: 1280, height: 720 };
    await play.page.mouse.click(pt[0] * size.width, pt[1] * size.height, { button: 'right' });
    await play.advance(0.08);
  };

  const clearHover = async () => {
    await play.mouse.move([0.02, 0.02]);
    await play.wait(200);
  };

  return {
    assert,
    state,
    parkOnEmptySlot,
    probeCell,
    calibrate,
    pointForCell,
    pointForCellRaw,
    hoverPartAt,
    hoverSpecificPart,
    currentTarget,
    setFloorMode,
    selectFloorKind,
    placeFloor,
    removeFloorAt,
    learnMovement,
    keysToward,
    holdToward,
    selectSlot,
    placePart,
    placePartAtPoint,
    gotoCell,
    climbTo,
    clickAt,
    holdKey,
    holdKeys,
    releaseMovement,
    releaseAll,
    findPart,
    hoverCell,
    rightClickAt,
    clearHover,
  };
}