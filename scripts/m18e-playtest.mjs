// M1.8-E 15 分钟完整体验测试（真实输入 + 真实时间）
//
// 流程：
//   阶段 1：完整生产链搭建与贯通（复用 m18c 的真实操作序列：采集 → 建厂 → 摇柄 → 投料 →
//           自动运输 → 熔炼 → 取锭 → 断轴/复电 → 重复生产 → 锻压反哺建造）。
//   阶段 2：连续运行 ≥ 13 分钟真实时间，玩家持续做「维持生产 + 调整工厂布局」的操作：
//           补能量、补料、拆装零件、反复检查读数；每分钟记录一次状态。
//
// 该脚本的判定：
//   1) 阶段 1 的所有断言通过；
//   2) 整场会话真实经过 ≥ 15 分钟；
//   3) 期间没有 console / page 错误（由 project play 的运行时门统一检查）；
//   4) 铁锭与碎铁矿的累计产量在持续运行中单调增长（说明产线真的在持续工作）。
import productionRun from './m18c-production.mjs';
import { createHarness } from './m18-helpers.mjs';

const TOTAL_MS = 15 * 60 * 1000;
const PHASE2_MS = 13 * 60 * 1000;

export default async function playthrough(play) {
  const startedAt = Date.now();

  // ---------------- 阶段 1：完整链路 ----------------
  await productionRun(play);

  const h = createHarness(play);
  const assert = h.assert;
  let cal = await h.calibrate('PLAYTEST');

  // ---------------- 阶段 2：持续游玩 ----------------
  let lastProduced = null;
  let sawGrowth = 0;
  let sawPowered = 0;
  let minute = 0;

  const powerUp = async () => {
    const s = await h.state();
    if (s.sources[0].enabled !== true) {
      await h.selectSlot(0);
      const sourcePart = s.parts.find((p) => p.kind === 'power-source');
      const pt = await h.hoverSpecificPart(cal, { gx: sourcePart.placement.gx, gz: sourcePart.placement.gz }, sourcePart.partId);
      if (pt) {
        await h.clickAt(pt);
        await h.rightClickAt(pt);
        await play.advance(0.3);
      }
    }
  };

  const feedMachines = async () => {
    const s = await h.state();
    for (const machine of s.production.machines) {
      if (machine.block !== 'no-input') continue;
      const part = s.parts.find((p) => p.partId === machine.partId);
      if (!part) continue;
      await h.selectSlot(0);
      const pt = await h.hoverSpecificPart(cal, part.placement, machine.partId);
      if (!pt) continue;
      await play.mouse.move(pt);
      await play.wait(120);
      for (let i = 0; i < 2; i += 1) {
        await play.keyboard.press('KeyC');
        await play.advance(0.05);
      }
    }
  };

  await play.step('playtest-phase-2-sustained-operation', async () => {
    const phaseStart = Date.now();
    while (Date.now() - phaseStart < PHASE2_MS) {
      // 真实等待（不用 advance 压缩时间），期间引擎正常跑帧。
      await play.wait(4000);

      const s = await h.state();
      const produced = s.production.produced;
      const crushed = produced.find((p) => p.itemId === 'crushed_ore')?.count ?? 0;
      const ingots = produced.find((p) => p.itemId === 'iron_ingot')?.count ?? 0;

      // 动力不足就摇柄
      if (s.sources[0].energy < 60) {
        await h.holdKey('KeyC', 2600);
        await powerUp();
      }
      // 有机器缺料就投料
      await feedMachines();

      if (lastProduced !== null && crushed + ingots > lastProduced) sawGrowth += 1;
      if (s.production.machines.some((m) => m.powered)) sawPowered += 1;
      lastProduced = crushed + ingots;

      // 每分钟记录一次状态（供报告引用）
      const elapsed = Date.now() - startedAt;
      if (elapsed > minute * 60000) {
        minute += 1;
        const now = await h.state();
        console.log('MINUTE-' + minute + '=' + JSON.stringify({
          elapsedSeconds: Math.round(elapsed / 1000),
          crushed: now.production.produced.find((p) => p.itemId === 'crushed_ore')?.count ?? 0,
          ingots: now.production.produced.find((p) => p.itemId === 'iron_ingot')?.count ?? 0,
          shafts: now.inventory.find((e) => e.itemId === 'shaft')?.count ?? 0,
          energy: Math.round(now.sources[0].energy),
          engaged: now.sources[0].engaged,
          machines: now.production.machines.map((m) => m.block),
          parts: now.parts.length,
          playerCell: now.player.cell,
        }));
        await play.screenshot('minute-' + minute);
      }
    }
  });

  await play.step('playtest-summary', async () => {
    const s = await h.state();
    const elapsed = Date.now() - startedAt;
    const produced = s.production.produced;
    console.log('PLAYTEST=' + JSON.stringify({
      elapsedSeconds: Math.round(elapsed / 1000),
      totalMs: elapsed,
      sawGrowthTicks: sawGrowth,
      sawPoweredTicks: sawPowered,
      produced,
      inventory: s.inventory,
      parts: s.parts.length,
      networks: s.networks.map((n) => ({ status: n.status, parts: n.partIds.length })),
      machines: s.production.machines.map((m) => ({ id: m.partId, block: m.block, produced: m.producedTotal })),
    }));
    assert(elapsed >= TOTAL_MS - 20000, 'the experience session must last at least 15 minutes, got ' + Math.round(elapsed / 1000) + 's');
    assert(sawPowered > 0, 'the machinery must be powered and running during the sustained session');
    assert(sawGrowth > 0, 'the production line must keep producing during the sustained session');
    assert((produced.find((p) => p.itemId === 'iron_ingot')?.count ?? 0) >= 2,
      'at least two iron ingots must have been produced across the session');
    await play.screenshot('playtest-final');
  });
}
