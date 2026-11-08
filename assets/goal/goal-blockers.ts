import {
  GOAL_REQUIREMENTS,
  INPUT_HINTS,
  MACHINE_KINDS,
  MACHINE_LABELS,
  NO_POWER_MESSAGE,
  ORDER_RECIPE_BY_KIND,
  type GoalMachineKind,
  type GoalStepId,
} from './order.ts';
import type { GoalObservation } from './observation.ts';
import type { GoalBlocker } from './goal.ts';
import {
  hasAllMachines,
  hasStalledOrderMachine,
  isKindPowered,
  networkOfMachine,
  type GoalContext,
} from './goal-context.ts';

/**
 * 订单阻塞原因判定：只把 GoalContext 映射成 HUD 文案，不修改任何运行时状态。
 * 从 goal.ts 拆出以守住 20 KB 单文件上限；判定条件与文案是 D 阶段验收的一部分。
 *
 * 文案原则：不假设玩家已经做过什么。例如飞轮离合可能已经挂上（储能耗尽时 engaged=false），
 * 所以补能提示必须先说「按住 C 摇柄补能」，再补一句「若离合未挂上，再右键接合离合」。
 */

export function missingMachineBlocker(context: GoalContext): GoalBlocker | null {
  const missing = MACHINE_KINDS.filter((kind) => !context.builtMachineKinds.has(kind));
  if (missing.length === 0) return null;
  return {
    code: 'missing-machine',
    message: `生产机器尚未建造：还缺${missing.map((kind) => MACHINE_LABELS[kind]).join('、')}。`,
  };
}

function connectionBlocker(context: GoalContext): GoalBlocker | null {
  const missingMachine = missingMachineBlocker(context);
  if (missingMachine) return missingMachine;
  if (!context.hasPowerSource) {
    return { code: 'missing-power-source', message: '还没有动力源：先建造一台手摇飞轮储能机。' };
  }
  if (context.orderNetwork === undefined) {
    const unsupported = context.unsupportedOrderNetwork;
    if (unsupported?.reason === 'cyclic-network') {
      return {
        code: 'no-connection',
        message: '传动网络存在闭环，动力系统拒绝解算：拆掉形成回路的一个齿轮或传动轴。',
      };
    }
    if (unsupported?.reason === 'multiple-sources') {
      return {
        code: 'no-connection',
        message: '一套动力网络只能接一个动力源：拆掉多余的动力源，只保留一台。',
      };
    }
    return {
      code: 'no-connection',
      message: '动力连接尚未完成：把破碎机、熔炼炉、锻压机和动力源接进同一套传动网络。',
    };
  }
  return null;
}

function startPowerBlocker(context: GoalContext): GoalBlocker | null {
  const connection = connectionBlocker(context);
  if (connection) return connection;
  const network = context.orderNetwork;
  if (network === undefined) return null;
  if (network.status === 'stalled') {
    return { code: 'network-overload', message: '动力网络过载：先停掉一部分机器，再重新启动飞轮。' };
  }
  // 局部支路过载：整网仍有转速，但订单机器所在的支路扭矩超限被停转。
  if (hasStalledOrderMachine(context, network)) {
    return {
      code: 'network-overload',
      message: '传动支路过载：部分传动件扭矩超限，拆掉一部分机器或改接支路后再启动。',
    };
  }
  const source = context.orderSource;
  if (source === undefined) {
    return { code: 'missing-power-source', message: '当前网络没有可用的动力源：接一台手摇飞轮储能机。' };
  }
  if (!source.engaged) return { code: 'no-power', message: NO_POWER_MESSAGE };
  const unpowered = MACHINE_KINDS.filter((kind) => !isKindPowered(context, kind, network));
  if (unpowered.length > 0) {
    return {
      code: 'no-power',
      message: `${unpowered.map((kind) => MACHINE_LABELS[kind]).join('、')}没有获得动力：检查传动连接，按住 C 摇柄补能；离合未挂上时再右键接合离合。`,
    };
  }
  return null;
}

function productionBlocker(kind: GoalMachineKind, context: GoalContext): GoalBlocker | null {
  const label = MACHINE_LABELS[kind];
  if (!context.builtMachineKinds.has(kind)) {
    return { code: 'missing-machine', message: `缺少${label}：请先建造或重新放回生产线上。` };
  }
  const machine = context.machinesByKind.get(kind)?.[0];
  if (machine === undefined) {
    return { code: 'missing-machine', message: `缺少${label}：请先建造或重新放回生产线上。` };
  }
  const expected = ORDER_RECIPE_BY_KIND[kind];
  if (machine.recipeId !== expected.id) {
    return {
      code: 'wrong-recipe',
      message: `${label}当前配方不是「${expected.label}」：悬停按 R 切换配方。`,
    };
  }
  const network = networkOfMachine(context, machine.partId);
  if (network?.status === 'stalled') {
    return { code: 'network-overload', message: `动力网络过载：${label}停转了，先关掉一部分机器。` };
  }
  const part = context.partById.get(machine.partId);
  // 局部支路过载：机器本身没有扭矩，但整网还在转 → 不能报成「检查接线/离合」。
  if (part?.stalled || (network !== undefined && hasStalledOrderMachine(context, network))) {
    return { code: 'network-overload', message: `传动支路过载：${label}所在支路扭矩超限停转，拆掉一部分机器或改接支路。` };
  }
  const poweredPart = part !== undefined && part.powered && !part.stalled;
  const noPowerMessage = `${label}没有动力：检查传动连接，按住 C 摇柄补能；离合未挂上时再右键接合离合。`;
  switch (machine.block) {
    case 'no-input':
      return { code: 'no-input', message: `${label}缺少原料：${INPUT_HINTS[kind]}` };
    case 'output-full':
      return { code: 'output-full', message: `输出堵塞，请取出成品：${label}的输出缓冲已满。` };
    case 'no-recipe':
      return { code: 'no-recipe', message: `${label}没有可用配方。` };
    case 'no-power':
      return { code: 'no-power', message: noPowerMessage };
    case 'ok':
      if (poweredPart) return null;
      return { code: 'no-power', message: noPowerMessage };
  }
}

function oreBlocker(observation: GoalObservation): GoalBlocker | null {
  const ore = Math.max(0, Math.floor(observation.ironOre));
  if (ore >= GOAL_REQUIREMENTS.ironOre) return null;
  return {
    code: 'missing-ore',
    message: `去矿点采集铁矿石：还需要 ${GOAL_REQUIREMENTS.ironOre - ore} 个。`,
  };
}

export function resolveBlocker(stepId: GoalStepId, observation: GoalObservation, context: GoalContext): GoalBlocker | null {
  switch (stepId) {
    case 'gather-ore':
      return oreBlocker(observation);
    case 'build-machines':
      return missingMachineBlocker(context);
    case 'connect-power':
      return connectionBlocker(context);
    case 'start-power':
      return startPowerBlocker(context);
    case 'crush-ore':
      return productionBlocker('crusher', context);
    case 'smelt-ingot':
      return productionBlocker('smelter', context);
    case 'forge-shaft':
      return productionBlocker('forge', context);
    case 'complete':
      return null;
  }
}
