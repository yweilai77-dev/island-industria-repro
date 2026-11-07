// M1.8 smoke：只验证新 Pack（floors）与扩展后的 mechanical read 能让游戏正常启动。
/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  await play.step('01-boot-and-read', async () => {
    const state = await play.state('mechanical');
    console.log('BOOT=' + JSON.stringify({
      revision: state.revision,
      parts: state.parts.length,
      sources: state.sources.length,
      productionMachines: state.production?.machines?.length ?? null,
      productionChutes: state.production?.chutes?.length ?? null,
      inventory: state.inventory?.length ?? null,
    }));
    await play.screenshot('01-boot');
  });

  await play.step('02-floor-mode-toggle', async () => {
    // V 进入楼层建造模式：只验证按键被处理且游戏不崩（目标格是否有效取决于相机与地面）。
    await play.keyboard.press('KeyV');
    await play.advance(0.1);
    await play.screenshot('02-floor-mode');
    await play.keyboard.press('Escape');
    await play.advance(0.1);
    const state = await play.state('mechanical');
    console.log('AFTER_V=' + JSON.stringify({ revision: state.revision }));
  });
}
