// M1.8 playthrough 共用工具：用真实鼠标/键盘事件驱动，靠 GameRead 的 buildTarget 做屏幕↔格子标定。
//
// 设计原则（不许走捷径）：
// - 所有放置都靠真实鼠标点击；本文件只负责「把目标格换算成屏幕归一化坐标」；
// - 换算靠探针 + 仿射拟合 + 牛顿迭代修正，探针读的是游戏自己的建造目标状态；
// - 每次放置前断言目标格与合法性，绝不「点下去再看运气」。

const DEFAULT_READ = 'mechanical';

export function createHarness(play) {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  const state = async () => play.state(DEFAULT_READ);

  const probeCell = async (pt) => {
    await play.mouse.move([pt[0], pt[1]]);
    await play.wait(110);
    const s = await state();
    const t = s.ui?.buildTarget;
    if (!t || !t.active || !t.cell) return null;
    return { gx: t.cell.gx, gz: t.cell.gz, level: t.level, valid: t.valid };
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
   * 只标定玩家当前所在层（buildTarget.level 与玩家层一致）。
   */
  const calibrate = async (label = 'calibrate') => {
    const points = [
      [0.28, 0.32], [0.52, 0.30], [0.74, 0.34],
      [0.30, 0.56], [0.55, 0.58], [0.76, 0.54],
      [0.40, 0.44], [0.66, 0.46],
    ];
    const samples = [];
    for (const pt of points) {
      const cell = await probeCell(pt);
      if (cell) samples.push({ x: pt[0], y: pt[1], gx: cell.gx, gz: cell.gz });
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
  const pointForCell = async (cal, cell) => {
    const { fit, inv } = cal;
    const targetX = cell.gx + 0.5;
    const targetZ = cell.gz + 0.5;
    let x = inv.m00 * (targetX - fit.fx[2]) + inv.m01 * (targetZ - fit.fz[2]);
    let y = inv.m10 * (targetX - fit.fx[2]) + inv.m11 * (targetZ - fit.fz[2]);
    x = Math.min(0.96, Math.max(0.04, x));
    y = Math.min(0.94, Math.max(0.06, y));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const probed = await probeCell([x, y]);
      if (!probed) {
        x = x * 0.9 + 0.5 * 0.1;
        y = y * 0.9 + 0.5 * 0.1;
        continue;
      }
      if (probed.gx === cell.gx && probed.gz === cell.gz) {
        await play.mouse.move([0.02, 0.02]);
        return [x, y];
      }
      const dGx = targetX - (probed.gx + 0.5);
      const dGz = targetZ - (probed.gz + 0.5);
      x = Math.min(0.96, Math.max(0.04, x + inv.m00 * dGx + inv.m01 * dGz));
      y = Math.min(0.94, Math.max(0.06, y + inv.m10 * dGx + inv.m11 * dGz));
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

  /** 按住某键移动玩家指定毫秒。 */
  const move = async (key, ms) => {
    await play.keyboard.hold(key, ms);
    await play.advance(0.05);
  };

  /** 一直按住某个方向键直到玩家所在格等于目标格（有超时保护）。 */
  const walkToCell = async (keys, cell, timeoutMs = 4000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const s = await state();
      if (s.player.cell.gx === cell.gx && s.player.cell.gz === cell.gz) return true;
      await play.keyboard.hold(keys, 160);
    }
    return false;
  };

  /** 选择快捷栏槽位（真实按键；第 11/12 格用 DOM 点击）。 */
  const selectSlot = async (index) => {
    const codes = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6',
      'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
    const code = codes[index];
    assert(code !== undefined, 'invalid hotbar slot ' + index);
    await play.keyboard.press(code);
    await play.advance(0.04);
  };

  /** 放置一个机械零件：选中槽位 → 旋转到位 → 点到目标格。 */
  const placePart = async (cal, slot, cell, rotation = 0, label = 'part') => {
    await selectSlot(slot);
    const turns = Math.round((rotation % 360) / 90);
    for (let i = 0; i < turns; i += 1) {
      await play.keyboard.press('KeyR');
      await play.advance(0.03);
    }
    const pt = await pointForCell(cal, cell);
    await play.mouse.move(pt);
    await play.wait(150);
    const before = (await state()).parts.length;
    await play.mouse.click(pt);
    await play.wait(200);
    const after = await state();
    assert(after.parts.length === before + 1,
      label + ': expected a new part at ' + cell.gx + ',' + cell.gz
      + ', parts ' + before + ' -> ' + after.parts.length
      + ' target=' + JSON.stringify(after.ui?.buildTarget));
    return after.parts[after.parts.length - 1];
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
    await play.mouse.click(pt, { button: 'right' });
    await play.advance(0.06);
  };

  const clearHover = async () => {
    await play.mouse.move([0.02, 0.02]);
    await play.wait(200);
  };

  return {
    assert,
    state,
    probeCell,
    calibrate,
    pointForCell,
    currentTarget,
    setFloorMode,
    selectFloorKind,
    placeFloor,
    removeFloorAt,
    move,
    walkToCell,
    selectSlot,
    placePart,
    findPart,
    hoverCell,
    rightClickAt,
    clearHover,
  };
}
