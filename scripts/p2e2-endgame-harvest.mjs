// M2.0-P2-E3 跨矿点采集（真实键鼠，唯一 GameRead mechanical）。
//
// 背景（Lead 通报的真实平衡改动）：铁矿单点储量已从旧假设的 20/点 调整为 **60/点**，
// 4 个矿点共 240；单点按 F 挖空后进入 depleted，继续按 F 不再产出。
// 终局验收需要 ~160 矿石（156 铁锭 + 4 块碎矿），因此必须跨点采集：
//   A(-6,4) 60 → B(3,-4) 60 → C(-13,-7) 60，合计 180 press；不足时补 D(12,10)。
// 路线沿用 p2f 脚本已验收的绕行路径（绕开中央固定平台/楼梯）。

export const ORE_REQUIRED = 175;

export const ORE_NODES = [
  { label: 'A', view: { gx: -6, gz: 4 }, presses: 60 },
  { label: 'B', view: { gx: 3, gz: -4 }, presses: 60 },
  { label: 'C', view: { gx: -13, gz: -7 }, presses: 60 },
];
export const ORE_NODE_D = { label: 'D', view: { gx: 12, gz: 10 }, presses: 40 };

const ORE_PATH_A_TO_B = [{ gx: -8, gz: 4 }, { gx: -8, gz: -4 }, { gx: 0, gz: -4 }];
const ORE_PATH_B_TO_C = [{ gx: 0, gz: -4 }, { gx: -8, gz: -4 }, { gx: -13, gz: -7 }];
const ORE_PATH_C_TO_D = [
  { gx: -8, gz: -4 }, { gx: 9, gz: -6 }, { gx: 12, gz: -6 }, { gx: 12, gz: 0 }, { gx: 12, gz: 6 },
];
const ORE_PATH_C_TO_BUILD = [{ gx: -8, gz: -7 }, { gx: -8, gz: 4 }];
const ORE_PATH_D_TO_BUILD = [
  { gx: 12, gz: 0 }, { gx: 9, gz: -6 }, { gx: -8, gz: -4 }, { gx: -8, gz: 4 },
];

export function createHarvest({ play, h, state, invOf, logStep, assert }) {
  /** 沿已验收路线走到矿点；逐段断言避免走丢（被平台/楼梯挡住时能定位）。 */
  const walkPath = async (waypoints, finalCell, label) => {
    for (const waypoint of waypoints) {
      assert(await h.gotoCell(waypoint, 20000, false), label + ': must reach waypoint '
        + JSON.stringify(waypoint) + ', now at ' + JSON.stringify((await state()).player.cell));
    }
    assert(await h.gotoCell(finalCell, 24000, true), label + ': must reach target '
      + JSON.stringify(finalCell));
  };

  /** 在矿点真实按 F 采集；每点最多挖其储量上限（挖空后 depleted 不再产出）。 */
  const harvestAt = async (node) => {
    assert(await h.gotoCell(node.view, 24000, true), 'must reach ore node ' + node.label);
    const before = invOf(await state(), 'iron_ore');
    for (let index = 0; index < node.presses; index += 1) {
      await play.keyboard.press('KeyF');
      await play.advance(3.4);
      await play.wait(50);
    }
    const total = invOf(await state(), 'iron_ore');
    const gained = total - before;
    assert(gained >= node.presses - 3, 'ore node ' + node.label + ' must yield ~' + node.presses
      + ' ore, got ' + gained);
    logStep('ORE-NODE', { node: node.label, gained, total });
    return total;
  };

  /** A → B → C（必要时 D），最后走回建造点；返回背包里的矿石总数。 */
  const harvestAll = async (buildSpot) => {
    let ore = await harvestAt(ORE_NODES[0]);
    await walkPath(ORE_PATH_A_TO_B, ORE_NODES[1].view, 'A->B');
    ore = await harvestAt(ORE_NODES[1]);
    await walkPath(ORE_PATH_B_TO_C, ORE_NODES[2].view, 'B->C');
    ore = await harvestAt(ORE_NODES[2]);
    if (ore < ORE_REQUIRED) {
      // 备用矿点：正常 180 press 足够，只有异常损耗时才会走到这里。
      await walkPath(ORE_PATH_C_TO_D, ORE_NODE_D.view, 'C->D');
      ore = await harvestAt(ORE_NODE_D);
      await walkPath(ORE_PATH_D_TO_BUILD, buildSpot, 'D->build');
    } else {
      await walkPath(ORE_PATH_C_TO_BUILD, buildSpot, 'C->build');
    }
    return ore;
  };

  return { harvestAll, harvestAt, walkPath };
}
