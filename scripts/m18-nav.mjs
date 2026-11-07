// 导航探针：确认玩家移动方向与阻挡情况（相机 yaw=0）。
/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  const read = async (label) => {
    const s = await play.state('mechanical');
    console.log(label + '=' + JSON.stringify({
      cell: s.player.cell,
      pos: s.player.position.map((v) => Math.round(v * 100) / 100),
      level: s.player.level,
      support: s.player.supportId,
    }));
    return s;
  };
  await play.step('01-initial', async () => {
    await read('P0');
  });
  await play.step('02-press-A', async () => {
    await play.keyboard.hold('KeyA', 600);
    await play.advance(0.05);
    await read('A600');
  });
  await play.step('03-press-D', async () => {
    await play.keyboard.hold('KeyD', 600);
    await play.advance(0.05);
    await read('D600');
  });
  await play.step('04-press-W', async () => {
    await play.keyboard.hold('KeyW', 600);
    await play.advance(0.05);
    await read('W600');
  });
  await play.step('05-press-S', async () => {
    await play.keyboard.hold('KeyS', 600);
    await play.advance(0.05);
    await read('S600');
  });
  await play.step('06-array-hold-AS', async () => {
    await play.keyboard.hold(['KeyA', 'KeyS'], 600);
    await play.advance(0.05);
    await read('AS600');
  });
  await play.step('07-long-A', async () => {
    await play.keyboard.hold('KeyA', 1500);
    await play.advance(0.05);
    await read('A1500');
  });
}
