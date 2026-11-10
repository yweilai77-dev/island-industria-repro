// M2.0-P2-D 真实游戏验收：场景 A（基础组合）与场景 B（多核心组合）。
// 全部走真实键鼠：普通放置核心 → P 进入结构模式 → 左键放结构框架 → 读 assemblies。
import { LAYOUT_A, FRAMES_A, LAYOUT_B, FRAMES_B, createP2dCtx } from './p2d-assembly-lib.mjs';

export async function runSceneAB(play, h, ctx) {
  const C = ctx ?? createP2dCtx(play, h);
  const {
    assert, state, machineOf, placeLayout, enableAllSources, calibrate, removeAllParts,
    harvestOre, placeFrameAt, exitStructureMode, selectPart, shotSelected , assemblySummary,
  } = C;

  await play.step('01-harvest-and-scene-a-build', async () => {
    await h.learnMovement();
    await calibrate('LEVEL0-ORE-A');
    await harvestOre(6, C.constants.ORE_NODE_A_VIEW, C.constants.BUILD_SPOT);
    await calibrate('LEVEL0-WORK-A');
    let s = await placeLayout(LAYOUT_A);
    assert(s.parts.length === LAYOUT_A.length, 'scene A must place ' + LAYOUT_A.length + ' cores');
    assert(s.production.machines.length === 2, 'scene A must track two machines');
    for (const frame of FRAMES_A) await placeFrameAt(frame, 'A-frame');
    await exitStructureMode();
    s = await state();
    assert(s.assemblies.length === 1, 'one structure frame must create exactly one assembly, got ' + s.assemblies.length);
    const assembly = s.assemblies[0];
    assert(assembly.memberIds.length === 2, 'scene A assembly must have two member cores');
    const cores = assembly.members.map((member) => member.coreId).sort();
    assert(JSON.stringify(cores) === JSON.stringify(['core.crusher', 'core.smelter']),
      'scene A members must keep their own core ids, got ' + JSON.stringify(cores));
    assert(assembly.moduleIds.length === 1, 'scene A assembly must reference the one structure frame');
    assert(assembly.links.length === 2, 'scene A assembly must record the two core-module structure links');
    assert(assembly.powerDemandTorque > 0, 'assembly must expose summed member rated torque');
    console.log('SCENE-A-ASSEMBLY=' + JSON.stringify(assemblySummary(assembly)));

    const crusherId = machineOf(s, 'crush-iron-ore').partId;
    const selected = await selectPart({ gx: -4, gz: 8 }, crusherId, 'scene-a-crusher');
    assert(selected.ui.selectedAssemblyId === assembly.id, 'selecting a member core must identify its assembly');
    const stillThere = selected.parts.find((part) => part.partId === crusherId);
    assert(stillThere, 'member core must remain an individual part while selected as assembly');
    await shotSelected('01-scene-a-assembly');
    await removeAllParts();
  });

  await play.step('10-scene-b-three-cores', async () => {
    await calibrate('LEVEL0-WORK-B');
    let s = await placeLayout(LAYOUT_B);
    assert(s.parts.length === LAYOUT_B.length, 'scene B must place three cores');
    for (const frame of FRAMES_B) await placeFrameAt(frame, 'B-frame');
    await exitStructureMode();
    s = await state();
    assert(s.assemblies.length === 1, 'scene B must form exactly one assembly');
    const assembly = s.assemblies[0];
    assert(assembly.memberIds.length === 3, 'scene B assembly must have three member cores');
    assert(assembly.moduleIds.length === 3, 'scene B assembly must reference three structure frames');
    const members = assembly.members.map((member) => member.partId).sort((a, b) => a - b);
    assert(JSON.stringify(members) === JSON.stringify([...assembly.memberIds].sort((a, b) => a - b)),
      'assembly member list must match the real member part ids');
    const coreKinds = assembly.members.map((member) => member.coreId).sort();
    assert(JSON.stringify(coreKinds) === JSON.stringify(['core.crusher', 'core.forge', 'core.smelter']),
      'three cores must keep their own processing core identity, got ' + JSON.stringify(coreKinds));
    assert(s.production.machines.length === 3, 'three independent machines must still be tracked');
    for (const member of assembly.members) {
      const part = s.parts.find((entry) => entry.partId === member.partId);
      assert(part && part.kind === 'machine', 'assembly member must be a real machine part');
      assert(part.placement.gx === member.placement.gx && part.placement.gz === member.placement.gz
        && part.placement.rotation === member.placement.rotation && part.placement.level === member.placement.level,
        'assembly member placement must equal the real part placement');
    }
    console.log('SCENE-B-ASSEMBLY=' + JSON.stringify(assemblySummary(assembly)));
    const anyMember = assembly.memberIds[assembly.memberIds.length - 1];
    const selected = await selectPart({ gx: -4, gz: 10 }, anyMember, 'scene-b-member');
    assert(selected.ui.selectedAssemblyId === assembly.id, 'selecting any member must identify the same assembly');
    await shotSelected('10-scene-b-three-cores');
    await removeAllParts();
  });
}
