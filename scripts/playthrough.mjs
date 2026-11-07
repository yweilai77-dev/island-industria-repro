// M1.6 地图扩展验收 playthrough：用真实输入走完地图/边界/四矿/平台楼梯/建造流程。
// Run: pnpm exec forgeax project play scripts/playthrough.mjs --json --detail
// 说明：本阶段不提供通用 read projection，位置/落点以截图与 DOM 背包读数为证据。

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  let yawIndex = 1; // 初始相机 yaw = 45°（INITIAL_YAW_INDEX=1）

  const fps = async () => {
    const text = await play.page.evaluate(() => document.body.innerText);
    const match = text.match(/FPS ([0-9.]+)/);
    return match ? Number(match[1]) : -1;
  };

  const face = async (targetIndex) => {
    let delta = ((targetIndex - yawIndex) % 8 + 8) % 8;
    if (delta > 4) delta -= 8;
    const key = delta >= 0 ? 'KeyE' : 'KeyQ';
    for (let i = 0; i < Math.abs(delta); i += 1) await play.keyboard.press(key);
    yawIndex = ((yawIndex + delta) % 8 + 8) % 8;
    await play.wait(900); // 等相机阻尼收敛
  };

  const walk = async (meters) => {
    await play.keyboard.hold('KeyW', Math.round(meters * 250));
    await play.wait(100);
  };

  const inventory = async (label) => {
    await play.keyboard.press('Tab');
    await play.wait(450);
    const rows = await play.page.evaluate(() =>
      Array.from(document.querySelectorAll('.ii-row-count')).map((el) => el.textContent));
    const detail = await play.page.evaluate(() =>
      document.querySelector('.ii-detail-count')?.textContent ?? '');
    await play.screenshot('inventory-' + label);
    await play.keyboard.press('Tab');
    await play.wait(350);
    console.log('INVENTORY ' + label + ': ' + JSON.stringify(rows) + ' ' + detail);
    return rows;
  };

  const harvest = async (label) => {
    await play.screenshot('node-' + label + '-prompt');
    await play.keyboard.press('KeyF');
    await play.wait(3200);
    await play.screenshot('node-' + label + '-done');
    return inventory(label);
  };

  await play.step('01-start-and-fps', async () => {
    await play.screenshot('01-start');
    console.log('FPS_START=' + (await fps()));
  });

  await play.step('02-nw-edge', async () => {
    await walk(32.0); // 初始 yaw 45°：-X/-Z，一路夹到西北角 (-15.5,-15.5)
    await walk(2.0); // 额外推，证明边界夹紧
    await play.screenshot('02-nw-edge');
    console.log('FPS_EDGE=' + (await fps()));
  });

  await play.step('03-node-c', async () => {
    await face(6); // +X
    await walk(3.0);  // x = -12.5
    await face(4); // +Z
    await walk(8.5);  // z = -7.0，进入 C(-13,-7)
    await play.screenshot('03-node-c');
    await harvest('c');
  });

  await play.step('04-node-d', async () => {
    await face(4); // +Z，先夹到 z=15.5
    await walk(22.5);
    await face(6); // +X
    await walk(23.0); // x≈10.5
    // 现在大致 (10.5, 15.5)；直接 -Z 到 z=10.5
    await face(0); // -Z
    await walk(5.0);
    await play.screenshot('04-node-d');
    await harvest('d');
  });

  await play.step('05-node-b', async () => {
    await face(2); // -X
    await walk(6.0); // x≈4.5
    await face(0); // -Z
    await walk(15.5); // z≈-5，进入 B(4,-5)
    await play.screenshot('05-node-b');
    await harvest('b');
  });

  await play.step('06-node-a', async () => {
    await face(2); // -X
    await walk(9.0); // x≈-4.5
    await face(4); // +Z
    await walk(9.0); // z≈4，进入 A(-5,4)
    await play.screenshot('06-node-a');
    await harvest('a');
  });

  await play.step('07-stairs-platform', async () => {
    await face(0); // -Z
    await walk(0.5); // z≈3.5
    await face(6); // +X
    await walk(4.8); // 从楼梯低端 -4 爬升到平台 x≈0.3，level 1
    await play.screenshot('07-platform-up');
    // 在平台上放置 1×1（瞄准屏幕中上部平台区域）
    await play.mouse.move([0.5, 0.42]);
    await play.wait(200);
    await play.screenshot('08-platform-ghost');
    await play.mouse.click([0.5, 0.42]);
    await play.wait(200);
    await play.screenshot('09-platform-placed');
    // 选中并进入调整，再取消
    await play.mouse.click([0.5, 0.42]);
    await play.wait(200);
    await play.keyboard.press('KeyG');
    await play.wait(200);
    await play.mouse.move([0.55, 0.36]);
    await play.wait(200);
    await play.screenshot('10-platform-adjust');
    await play.keyboard.press('Escape');
    await play.wait(200);
    await play.screenshot('11-platform-adjust-cancel');
    // 删除平台建筑（X），验证 M1.5 拆除回归
    await play.keyboard.press('KeyX');
    await play.wait(300);
    await play.mouse.move([0.05, 0.05]);
    await play.wait(250);
    await play.screenshot('11b-platform-demolished');
    // 下楼：沿 -X 回到楼梯并下到地面
    await face(2); // -X
    await walk(4.8);
    await play.screenshot('12-stairs-down');
  });

  await play.step('08-se-corner', async () => {
    await face(4); // +Z，先到 z=15.5
    await walk(12.0);
    await face(6); // +X，到 x=15.5（东南角）
    await walk(22.0);
    await play.screenshot('13-se-corner');
    // 1×1 合法放置（瞄准玩家前方内侧地面）
    await play.mouse.move([0.5, 0.62]);
    await play.wait(250);
    await play.screenshot('14-corner-ghost-valid');
    await play.mouse.click([0.5, 0.62]);
    await play.wait(250);
    await play.screenshot('15-corner-placed');
    // 2×2 在边缘 → footprint 越界，红色非法幽灵（避开已放置格）
    await play.keyboard.press('BracketRight');
    await play.mouse.move([0.5, 0.55]);
    await play.wait(250);
    await play.screenshot('16-corner-ghost-invalid');
    await play.mouse.click([0.5, 0.55]);
    await play.wait(250);
    await play.screenshot('17-corner-invalid-click');
    await play.keyboard.press('BracketLeft');
    // 边界夹紧：+Z、+X 两个方向再推
    await face(4);
    await walk(1.5);
    await play.screenshot('17-boundary-south');
    await face(6);
    await walk(1.5);
    await play.screenshot('18-boundary-east');
  });

  await play.step('09-reload', async () => {
    const before = await fps();
    console.log('FPS_BEFORE_RELOAD=' + before);
    await play.reload();
    await play.wait(800);
    await play.screenshot('19-after-reload');
    console.log('FPS_AFTER_RELOAD=' + (await fps()));
  });
}