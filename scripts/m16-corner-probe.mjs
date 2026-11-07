// temporary corner placement probe (delete before delivery)
/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function probe(play) {
  let yaw = 1;
  const face = async (t) => { let d = ((t-yaw)%8+8)%8; if (d>4) d-=8; const k = d>=0?'KeyE':'KeyQ'; for (let i=0;i<Math.abs(d);i++) await play.keyboard.press(k); yaw=((yaw+d)%8+8)%8; await play.wait(900); };
  const walk = async (m) => { await play.keyboard.hold('KeyW', Math.round(m*250)); await play.wait(120); };
  await play.step('to-corner', async () => {
    await face(6); await walk(17); await face(4); await walk(13);
    await play.screenshot('corner');
    await play.mouse.move([0.5,0.62]); await play.wait(250);
    await play.screenshot('ghost-1x1-p0');
    await play.mouse.click([0.5,0.62]); await play.wait(300);
    await play.screenshot('placed-p0');
  });
  await play.step('2x2-points', async () => {
    await play.keyboard.press('BracketRight'); await play.wait(300);
    const pts = [[0.5,0.62],[0.5,0.55],[0.52,0.66],[0.46,0.66],[0.54,0.58],[0.56,0.62],[0.44,0.62]];
    for (let i=0;i<pts.length;i++) {
      await play.mouse.move(pts[i]); await play.wait(250);
      await play.screenshot('2x2-' + i + '-' + pts[i].join('_'));
    }
    // also 1x1 at p0 after placement (should hit placed building / hide ghost)
    await play.keyboard.press('BracketLeft'); await play.wait(250);
    await play.mouse.move([0.5,0.62]); await play.wait(250);
    await play.screenshot('1x1-p0-after-place');
  });
}
