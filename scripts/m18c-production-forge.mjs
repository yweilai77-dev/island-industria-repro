// 从 `m18c-production.mjs` 拆出的「锻压机支路 + 产物反哺建造」阶段。
// 拆分原因：主脚本加上 P2-B 的接口盒安装步骤后超过工程 20 KB 单文件上限（提交钩子会拒绝）。
// 行为与拆分前完全一致：同一个 step、同一串断言、同一组截图。
export async function runForgeStage(play, h, ctx) {
  const { points, cal, assert, LAYOUT, SHAFT, GEAR24, FORGE } = ctx;

  // ---- 原 `10-forge-ingots-into-a-part` 的步体（原样搬移） ----
    // 建锻压机支路：24T(-5,7) 与主链 12T(-5,8) 外啮合 → 轴(-4,7) → 轴(-3,7) → 锻压机(-2,7)
    const branch = [
      { cell: { gx: -5, gz: 7 }, slot: GEAR24, rot: 0, label: 'gear24-forge' },
      { cell: { gx: -4, gz: 7 }, slot: SHAFT, rot: 0, label: 'shaft-f1' },
      { cell: { gx: -3, gz: 7 }, slot: SHAFT, rot: 0, label: 'shaft-f2' },
      { cell: { gx: -2, gz: 7 }, slot: FORGE, rot: 0, label: 'forge' },
    ];
    for (const item of branch) {
      const pt = await h.pointForCell(cal, item.cell, { avoidHover: true });
      points[item.label] = pt;
      await h.placePartAtPoint(pt, item.slot, item.rot, item.label, item.cell);
    }
    await h.clearHover();
    let s = await h.state();
    const forge = s.production.machines.find((m) => m.recipeId === 'forge-shaft');
    console.log('FORGE-BUILT=' + JSON.stringify({
      parts: s.parts.length,
      networks: s.networks.map((n) => n.status + ':' + n.partIds.length),
      forge: forge && { id: forge.partId, powered: forge.powered, block: forge.block },
      ingots: s.inventory.find((e) => e.itemId === 'iron_ingot')?.count ?? 0,
    }));
    assert(s.parts.length === LAYOUT.length + branch.length,
      'expected ' + (LAYOUT.length + branch.length) + ' parts, got ' + s.parts.length);
    assert(forge !== undefined, 'the forge must be tracked as a production machine');
    assert(forge.powered === true, 'the forge must be driven by the same mechanical network');

    // 补能量 + 保证离合挂着，然后把熔炼炉里已产出的铁锭全部收进库存。
    await h.holdKey('KeyC', 3000);
    s = await h.state();
    if (s.sources[0].enabled !== true) {
      await h.selectSlot(SHAFT);
      await h.clickAt(points['flywheel']);
      await h.rightClickAt(points['flywheel']);
      await play.advance(0.4);
    }
    await h.selectSlot(SHAFT);
    const smelterId = (await h.state()).production.machines.find((m) => m.recipeId === 'smelt-crushed-ore').partId;
    const smelterPt = await h.hoverSpecificPart(cal, { gx: -2, gz: 9 }, smelterId);
    assert(smelterPt !== null, 'must be able to aim at the smelter to collect ingots');
    for (let i = 0; i < 4; i += 1) {
      await play.mouse.move(smelterPt);
      await play.wait(120);
      await h.rightClickAt(smelterPt);
      await play.advance(0.3);
      if (((await h.state()).inventory.find((e) => e.itemId === 'iron_ingot')?.count ?? 0) >= 2) break;
    }
    s = await h.state();
    const ingots = s.inventory.find((e) => e.itemId === 'iron_ingot')?.count ?? 0;
    console.log('INGOTS=' + JSON.stringify({ ingots }));
    assert(ingots >= 2, 'need at least 2 iron ingots to forge a shaft, got ' + ingots);

    // 悬停锻压机投料（锻压传动轴 = 2 铁锭）
    await h.selectSlot(SHAFT);
    const forgeId = (await h.state()).production.machines.find((m) => m.recipeId === 'forge-shaft').partId;
    const forgePt = await h.hoverSpecificPart(cal, { gx: -2, gz: 7 }, forgeId);
    assert(forgePt !== null, 'must be able to aim at the forge');
    await play.mouse.move(forgePt);
    await play.wait(150);
    const preFeed = await h.state();
    console.log('PRE-FEED=' + JSON.stringify({
      hovered: preFeed.ui?.hoveredPartId,
      forgeId,
      ingots: preFeed.inventory.find((e) => e.itemId === 'iron_ingot')?.count ?? 0,
      forge: preFeed.production.machines.find((m) => m.partId === forgeId),
    }));
    for (let i = 0; i < 2; i += 1) {
      await play.keyboard.press('KeyC');
      await play.advance(0.06);
      const step0 = await h.state();
      console.log('PRESS-' + i + '=' + JSON.stringify({
        ingots: step0.inventory.find((e) => e.itemId === 'iron_ingot')?.count ?? 0,
        forge: step0.production.machines.find((m) => m.partId === forgeId),
        allForge: step0.production.machines.filter((m) => m.recipeId === 'forge-shaft').length,
      }));
    }
    s = await h.state();
    const afterFeed = s.production.machines.find((m) => m.recipeId === 'forge-shaft');
    console.log('FORGE-FED=' + JSON.stringify({
      forge: afterFeed,
      ingots: s.inventory.find((e) => e.itemId === 'iron_ingot')?.count ?? 0,
    }));
    assert(afterFeed.running === true || afterFeed.progress > 0, 'the forge must start forging after being fed');

    // 等它锻出一根传动轴并取出。
    const shaftBefore = s.inventory.find((e) => e.itemId === 'shaft')?.count ?? 0;
    let forged = false;
    for (let i = 0; i < 40; i += 1) {
      await play.advance(1.0);
      const now = await h.state();
      const f = now.production.machines.find((m) => m.recipeId === 'forge-shaft');
      if (f && f.outputCount > 0) {
        await play.mouse.move(forgePt);
        await play.wait(120);
        await h.rightClickAt(forgePt);
        await play.advance(0.3);
        const collected = await h.state();
        const shaftAfter = collected.inventory.find((e) => e.itemId === 'shaft')?.count ?? 0;
        console.log('FORGED=' + JSON.stringify({ shaftBefore, shaftAfter, produced: collected.production.produced }));
        assert(shaftAfter > shaftBefore, 'the forged shaft must enter the inventory (' + shaftBefore + ' -> ' + shaftAfter + ')');
        forged = true;
        break;
      }
      if (now.sources[0].engaged !== true) {
        await h.holdKey('KeyC', 2200);
        if ((await h.state()).sources[0].enabled !== true) {
          await h.selectSlot(SHAFT);
          await h.clickAt(points['flywheel']);
          await h.rightClickAt(points['flywheel']);
        }
        await play.advance(0.3);
      }
    }
    assert(forged, 'the forge must produce a shaft from 2 iron ingots');
    await play.screenshot('12-forged-shaft');

    // 产物能继续用于建造：把刚锻出来的传动轴放到空地上（消耗 1 个、机械多 1 件）。
    const beforeParts = (await h.state()).parts.length;
    const beforeShafts = (await h.state()).inventory.find((e) => e.itemId === 'shaft')?.count ?? 0;
    const buildPt = await h.pointForCell(cal, { gx: -4, gz: 6 });
    await h.placePartAtPoint(buildPt, SHAFT, 0, 'forged-shaft-placed', { gx: -4, gz: 6 });
    const finalState = await h.state();
    const afterShafts = finalState.inventory.find((e) => e.itemId === 'shaft')?.count ?? 0;
    console.log('REINVEST=' + JSON.stringify({ beforeParts, afterParts: finalState.parts.length, beforeShafts, afterShafts }));
    assert(finalState.parts.length === beforeParts + 1, 'the forged part must be placeable as a real machine part');
    assert(afterShafts === beforeShafts - 1, 'placing it must consume exactly one shaft from the inventory');
    await play.screenshot('13-forged-part-used-in-build');
}
