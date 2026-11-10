// M2.0-P2-D 真实游戏验收：场景 C（组合中实际生产）、D（机械动力共存）、E（组合管理/整体选择）。
// 布局 C：破碎机 → P2-C 物料连接 → 熔炼炉；两台核心由两个结构框架组织成一个组合。
import { LAYOUT_C, FRAMES_C, createP2dCtx } from './p2d-assembly-lib.mjs';

const shared = {};

export async function runSceneCDE(play, h, ctx) {
  const C = ctx ?? createP2dCtx(play, h);
  const {
    assert, state, machineOf, countOf, placeLayout, enableAllSources, calibrate,
    placeFrameAt, exitStructureMode, onPart, feedMachine, collectMachine,
    waitFor, assemblySummary, selectPart, shotSelected, removeAllParts,
  } = C;

  const sourceAt = (s, cell) => s.parts.find((part) => part.kind === 'power-source'
    && part.placement.gx === cell.gx && part.placement.gz === cell.gz);

  await play.step('20-scene-c-production-in-assembly', async () => {
    await calibrate('LEVEL0-WORK-C');
    let s = await placeLayout(LAYOUT_C);
    assert(s.parts.length === LAYOUT_C.length, 'scene C must place the production line');
    await enableAllSources(LAYOUT_C);
    const powered = await waitFor((now) => now.production.machines.length === 2
      && now.production.machines.every((machine) => machine.powered === true), 8, 'scene-c-power');
    assert(powered.ok, 'scene C machines must be powered before assembly');
    s = powered.state;
    shared.beforeFrames = {
      networks: s.networks,
      machines: s.production.machines.map((machine) => ({
        partId: machine.partId, recipe: machine.recipeId, powered: machine.powered,
      })),
    };
    assert(s.assemblies.length === 0, 'before structure frames there must be no assembly');

    for (const frame of FRAMES_C) await placeFrameAt(frame, 'C-frame');
    await exitStructureMode();
    s = await state();
    assert(s.assemblies.length === 1, 'scene C must form one assembly');
    const assembly = s.assemblies[0];
    assert(assembly.memberIds.length === 2, 'scene C assembly must have two member cores');
    shared.assemblyId = assembly.id;
    shared.memberIds = [...assembly.memberIds];
    const crusherId = machineOf(s, 'crush-iron-ore').partId;
    const smelterId = machineOf(s, 'smelt-crushed-ore').partId;
    shared.crusherId = crusherId;
    shared.smelterId = smelterId;

    // P2-C 的接口盒与物料连接在组合内部照常工作（组合不会自动建链）。
    await onPart({ gx: -4, gz: 8 }, crusherId, 'KeyO');
    await onPart({ gx: -4, gz: 9 }, smelterId, 'KeyT');
    await onPart({ gx: -4, gz: 8 }, crusherId, 'KeyJ');
    await onPart({ gx: -4, gz: 9 }, smelterId, 'KeyJ');
    s = await state();
    assert(s.ports.length === 2, 'scene C must install output + through boxes');
    assert(s.links.length === 1, 'scene C must create exactly one material link');
    assert(s.ports.every((port) => port.partId === crusherId || port.partId === smelterId),
      'assembly must not create fake ports');

    const ore = countOf(s, 'iron_ore');
    assert(ore >= 4, 'scene C needs at least 4 ore, got ' + ore);
    await feedMachine({ gx: -4, gz: 8 }, crusherId, 4);
    const produced = await waitFor((now) => {
      const crusher = now.production.machines.find((machine) => machine.partId === crusherId);
      const smelter = now.production.machines.find((machine) => machine.partId === smelterId);
      return (crusher?.producedTotal ?? 0) >= 2 && (smelter?.producedTotal ?? 0) >= 2
        && (now.links[0]?.moved ?? 0) >= 2;
    }, 60, 'scene-c-production');
    assert(produced.ok, 'assembly members must run their own production while linked');
    s = produced.state;
    assert(s.assemblies.length === 1, 'assembly must still exist while producing');
    assert(s.links[0].active === true, 'material link must stay active inside the assembly');
    const after = await state();
    const crusherState = after.production.machines.find((machine) => machine.partId === crusherId);
    const smelterState = after.production.machines.find((machine) => machine.partId === smelterId);
    assert((crusherState?.producedTotal ?? 0) >= 2, 'crusher member must keep its own output');
    assert((smelterState?.producedTotal ?? 0) >= 2, 'smelter member must keep its own output');
    await collectMachine({ gx: -4, gz: 9 }, smelterId, 2);
    console.log('SCENE-C=' + JSON.stringify({
      assembly: assemblySummary(s.assemblies[0]),
      machines: s.production.machines.map((machine) => ({
        partId: machine.partId, recipe: machine.recipeId, produced: machine.producedTotal, powered: machine.powered,
      })),
      ports: s.ports.map((port) => ({ partId: port.partId, slotId: port.slotId, itemId: port.itemId, count: port.count })),
      links: s.links.map((link) => ({ id: link.id, active: link.active, moved: link.moved })),
    }));
    await C.shot('20-scene-c-production');
  });

  await play.step('21-scene-d-power-coexistence', async () => {
    let s = await state();
    const assembly = s.assemblies[0];
    assert(assembly && assembly.id === shared.assemblyId, 'assembly must persist across power checks');
    const afterNetworks = JSON.stringify(s.networks.map((network) => ({
      id: network.id, status: network.status, machines: network.machineIds, sources: network.sourceIds,
    })));
    const beforeNetworks = JSON.stringify(shared.beforeFrames.networks.map((network) => ({
      id: network.id, status: network.status, machines: network.machineIds, sources: network.sourceIds,
    })));
    // 组合只加结构零件（无端口），动力网络组件与成员归属必须完全一致。
    const beforeMachines = JSON.stringify(shared.beforeFrames.machines);
    const afterMachines = JSON.stringify(s.production.machines.map((machine) => ({
      partId: machine.partId, recipe: machine.recipeId, powered: machine.powered,
    })));
    assert(afterMachines === beforeMachines, 'assembly must not change machine drive state');
    assert(afterNetworks === beforeNetworks, 'assembly must not change power network topology');
    for (const partId of assembly.memberIds) {
      assert(s.networks.some((network) => network.machineIds.includes(partId)),
        'each member core must keep its own power link, missing ' + partId);
    }
    const networkPartIds = s.networks.flatMap((network) => [...network.machineIds, ...network.sourceIds]);
    for (const moduleId of assembly.moduleIds) {
      assert(networkPartIds.includes(moduleId) === false, 'structure modules must stay out of power networks');
    }
    const demand = assembly.members.reduce((total, member) => total + member.ratedLoadTorque, 0);
    assert(assembly.powerDemandTorque === demand,
      'assembly power demand must equal the sum of member rated torque');
    assert(assembly.powerDemandTorque > 0, 'assembly must expose a positive summed demand');
    console.log('SCENE-D=' + JSON.stringify({
      assemblyId: assembly.id,
      powerDemandTorque: assembly.powerDemandTorque,
      memberTorques: assembly.members.map((member) => ({ partId: member.partId, rated: member.ratedLoadTorque })),
      networks: s.networks.map((network) => ({
        id: network.id, status: network.status, machines: network.machineIds, sources: network.sourceIds,
      })),
      machines: s.production.machines.map((machine) => ({ partId: machine.partId, powered: machine.powered })),
    }));
  });

  await play.step('22-scene-e-assembly-selection', async () => {
    let s = await state();
    const assembly = s.assemblies[0];
    assert(assembly, 'scene E needs the assembly from scene C');
    const crusherId = shared.crusherId;
    const smelterId = shared.smelterId;
    const framePart = C.frameAt(s, FRAMES_C[0]);
    assert(framePart, 'scene E must find the structure frame part');
    const source = sourceAt(s, { gx: -4, gz: 6 });
    assert(source, 'scene E must find the power source part');

    const byCore = await selectPart({ gx: -4, gz: 8 }, crusherId, 'scene-e-core');
    assert(byCore.ui.selectedAssemblyId === assembly.id, 'selecting a member must identify the assembly');
    const byFrame = await selectPart({ gx: -3, gz: 8 }, framePart.partId, 'scene-e-frame');
    assert(byFrame.ui.selectedAssemblyId === assembly.id, 'selecting a structure module must identify the assembly');
    const byOther = await selectPart({ gx: -4, gz: 6 }, source.partId, 'scene-e-source');
    assert(byOther.ui.selectedAssemblyId === null, 'non-member part must not fake an assembly selection');

    const selectedCore = await selectPart({ gx: -4, gz: 8 }, crusherId, 'scene-e-core-again');
    assert(selectedCore.ui.selectedPartId === crusherId, 'member core must remain individually selectable');
    const machine = selectedCore.production.machines.find((entry) => entry.partId === crusherId);
    assert(machine, 'selected member core must keep its own machine state');
    const view = selectedCore.assemblies[0];
    assert(view.memberIds.length === 2 && view.moduleIds.length === 2, 'assembly view must expose members and modules');
    assert(view.members.every((member) => member.coreId.startsWith('core.')), 'members must expose their own core ids');
    assert(JSON.stringify(view.bounds) === JSON.stringify(assembly.bounds), 'assembly bounds must be stable');
    console.log('SCENE-E=' + JSON.stringify({
      selectedAssemblyId: selectedCore.ui.selectedAssemblyId,
      assembly: assemblySummary(view),
      individuallySelectedPart: selectedCore.ui.selectedPartId,
      selectedMachine: { partId: machine.partId, recipe: machine.recipeId, powered: machine.powered },
      smelterId,
    }));
    await shotSelected('22-scene-e-assembly-bounds');
    await removeAllParts();
  });
}
