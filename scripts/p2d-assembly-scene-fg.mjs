// M2.0-P2-D 真实游戏验收：场景 F（拆解与恢复）、G（成员旋转与空间变化）。
import { LAYOUT_C, FRAMES_C, createP2dCtx } from './p2d-assembly-lib.mjs';

export async function runSceneFG(play, h, ctx) {
  const C = ctx ?? createP2dCtx(play, h);
  const {
    assert, state, machineOf, countOf, placeLayout, enableAllSources, calibrate, setSource,
    placeFrameAt, exitStructureMode, onPart, feedMachine, waitFor, removePart, removeAllParts,
  } = C;

  const itemsInWorld = (s) => countOf(s, 'iron_ore') + countOf(s, 'crushed_ore') + countOf(s, 'iron_ingot')
    + s.production.machines.reduce((total, machine) => total + machine.inputCount + machine.outputCount, 0)
    + s.ports.reduce((total, port) => total + port.count, 0);

  await play.step('30-scene-f-dismantle-and-restore', async () => {
    await calibrate('LEVEL0-WORK-F');
    let s = await placeLayout(LAYOUT_C);
    await enableAllSources(LAYOUT_C);
    for (const frame of FRAMES_C) await placeFrameAt(frame, 'F-frame');
    await exitStructureMode();
    s = await state();
    assert(s.assemblies.length === 1, 'scene F must form an assembly before dismantling');
    const assemblyId = s.assemblies[0].id;
    const memberIds = [...s.assemblies[0].memberIds];
    const crusherId = machineOf(s, 'crush-iron-ore').partId;
    const smelterId = machineOf(s, 'smelt-crushed-ore').partId;
    await onPart({ gx: -4, gz: 8 }, crusherId, 'KeyO');
    await onPart({ gx: -4, gz: 9 }, smelterId, 'KeyT');
    await onPart({ gx: -4, gz: 8 }, crusherId, 'KeyJ');
    await onPart({ gx: -4, gz: 9 }, smelterId, 'KeyJ');
    await feedMachine({ gx: -4, gz: 8 }, crusherId, 2);
    const started = await waitFor((now) => (now.links[0]?.moved ?? 0) >= 1, 40, 'scene-f-link');
    assert(started.ok, 'scene F material link must transfer before dismantling');

    // 冻结动力：拆结构模块期间加工进度不应因组合解除而重置。
    const sourceCrusher = s.parts.find((part) => part.kind === 'power-source'
      && part.placement.gx === -4 && part.placement.gz === 6);
    const sourceSmelter = s.parts.find((part) => part.kind === 'power-source'
      && part.placement.gx === -6 && part.placement.gz === 9);
    assert(sourceCrusher && sourceSmelter, 'scene F must find both power sources');
    await setSource({ gx: -4, gz: 6 }, sourceCrusher.partId, false);
    await setSource({ gx: -6, gz: 9 }, sourceSmelter.partId, false);
    const frozen = await waitFor((now) => now.production.machines.every((machine) => machine.powered === false), 8,
      'scene-f-frozen');
    assert(frozen.ok, 'scene F must be able to stop power for progress comparison');
    s = frozen.state;
    const beforeDismantle = {
      crusher: s.production.machines.find((machine) => machine.partId === crusherId),
      smelter: s.production.machines.find((machine) => machine.partId === smelterId),
      ports: JSON.stringify(s.ports),
      links: JSON.stringify(s.links),
      items: itemsInWorld(s),
      frames: C.frameCount(s),
    };

    const frames = s.assemblies[0].moduleIds
      .map((moduleId) => s.parts.find((entry) => entry.partId === moduleId))
      .filter(Boolean);
    assert(frames.length === 2, 'scene F assembly must have two structure frames');
    const first = frames[0];
    await removePart({ gx: first.placement.gx, gz: first.placement.gz }, first.partId);
    s = await state();
    assert(s.assemblies.length === 0, 'removing one structure frame must dissolve the assembly');
    assert(C.frameCount(s) === beforeDismantle.frames + 1, 'removing a frame must refund exactly one item');
    assert(s.parts.find((part) => part.partId === crusherId), 'member core ids must survive dismantling');
    assert(s.parts.find((part) => part.partId === smelterId), 'all member core ids must survive dismantling');
    assert(JSON.stringify(s.links) === beforeDismantle.links, 'dismantling must not touch material links');
    assert(JSON.stringify(s.ports) === beforeDismantle.ports, 'dismantling must not touch installed ports');
    assert(itemsInWorld(s) === beforeDismantle.items, 'dismantling must not lose or duplicate material');
    const crusherNow = s.production.machines.find((machine) => machine.partId === crusherId);
    assert(crusherNow?.progress === beforeDismantle.crusher?.progress,
      'dismantling must not reset processing progress');
    assert(crusherNow?.inputCount === beforeDismantle.crusher?.inputCount, 'dismantling must keep input buffers');

    const second = s.parts.find((part) => part.kind === 'structure');
    assert(second, 'the other structure frame must remain after first removal');
    await removePart({ gx: second.placement.gx, gz: second.placement.gz }, second.partId);
    s = await state();
    assert(s.assemblies.length === 0, 'no assembly may remain after both frames are removed');
    assert(C.frameCount(s) === beforeDismantle.frames + 2, 'both frames must be refunded exactly once');

    // 重新搭建：新组合沿用“重新分配”的新 ID，成员核心身份不变。
    for (const frame of FRAMES_C) await placeFrameAt(frame, 'F-reframe');
    await exitStructureMode();
    s = await state();
    assert(s.assemblies.length === 1, 'rebuilt structure must form a new assembly');
    const rebuilt = s.assemblies[0];
    assert(rebuilt.id !== assemblyId, 'rebuilt assembly must get a fresh stable id');
    assert(JSON.stringify([...rebuilt.memberIds].sort((a, b) => a - b)) === JSON.stringify([...memberIds].sort((a, b) => a - b)),
      'rebuilt assembly must keep the same member core ids');
    console.log('SCENE-F=' + JSON.stringify({
      dismantledAssemblyId: assemblyId,
      rebuiltAssemblyId: rebuilt.id,
      framesBefore: beforeDismantle.frames,
      framesAfter: C.frameCount(s),
      memberIds,
      crusherProgress: beforeDismantle.crusher?.progress,
      links: s.links.length,
      ports: s.ports.length,
    }));
    await C.shot('30-scene-f-rebuilt');
    await removeAllParts();
  });

  await play.step('40-scene-g-member-rotation', async () => {
    await calibrate('LEVEL0-WORK-G');
    let s = await placeLayout(LAYOUT_C);
    await enableAllSources(LAYOUT_C);
    for (const frame of FRAMES_C) await placeFrameAt(frame, 'G-frame');
    await exitStructureMode();
    s = await state();
    assert(s.assemblies.length === 1, 'scene G must form an assembly');
    const assembly = s.assemblies[0];
    const assemblyId = assembly.id;
    const bounds = JSON.stringify(assembly.bounds);
    const memberIds = [...assembly.memberIds];
    const smelterId = machineOf(s, 'smelt-crushed-ore').partId;
    const crusherId = machineOf(s, 'crush-iron-ore').partId;
    await onPart({ gx: -4, gz: 8 }, crusherId, 'KeyO');
    await onPart({ gx: -4, gz: 9 }, smelterId, 'KeyT');
    await onPart({ gx: -4, gz: 8 }, crusherId, 'KeyJ');
    await onPart({ gx: -4, gz: 9 }, smelterId, 'KeyJ');
    s = await state();
    assert(s.links.length === 1 && s.links[0].active === true, 'scene G link must be active before rotation');

    const beforeRotate = s.assemblies[0].members.find((member) => member.partId === smelterId);
    await onPart({ gx: -4, gz: 9 }, smelterId, 'KeyU');
    s = await state();
    assert(s.assemblies.length === 1, 'assembly must persist while a member rotates');
    const rotated = s.assemblies[0];
    assert(rotated.id === assemblyId, 'member rotation must keep assembly id stable');
    assert(JSON.stringify(rotated.memberIds) === JSON.stringify(memberIds), 'member rotation must keep member ids');
    assert(JSON.stringify(rotated.bounds) === bounds, '1x1 member rotation must keep assembly bounds');
    const smelterPart = s.parts.find((part) => part.partId === smelterId);
    assert(smelterPart?.placement.rotation === 90, 'smelter must really rotate 90 degrees');
    const afterMember = rotated.members.find((member) => member.partId === smelterId);
    assert(afterMember?.relative.rotation !== beforeRotate?.relative.rotation,
      'assembly must record the member relative direction change');
    // 旋转改变端口朝向：P2-C 的物料连接必须显式失效（不产生空间数据不一致）。
    assert(s.links[0].active === false && s.links[0].status === 'inactive-geometry',
      'rotating a member must deactivate the now-invalid material link, got ' + JSON.stringify(s.links[0]));
    console.log('SCENE-G-ROTATE=' + JSON.stringify({
      assemblyId: rotated.id,
      bounds: rotated.bounds,
      smelterRotation: smelterPart.placement.rotation,
      relativeBefore: beforeRotate?.relative,
      relativeAfter: afterMember?.relative,
      link: { active: s.links[0].active, status: s.links[0].status },
    }));
    await C.shot('40-scene-g-rotated-member');

    for (let index = 0; index < 3; index += 1) await onPart({ gx: -4, gz: 9 }, smelterId, 'KeyU');
    s = await state();
    assert(s.parts.find((part) => part.partId === smelterId)?.placement.rotation === 0, 'smelter must rotate back to 0');
    assert(s.assemblies.length === 1 && s.assemblies[0].id === assemblyId, 'assembly must survive the full rotation round');
    assert(JSON.stringify(s.assemblies[0].bounds) === bounds, 'assembly bounds must return exactly');
    assert(s.links[0].active === true && s.links[0].status === 'ok', 'material link must recover after rotating back');
    console.log('SCENE-G-RESTORED=' + JSON.stringify({ assemblyId, link: { active: s.links[0].active, status: s.links[0].status } }));
    await removeAllParts();
  });
}
