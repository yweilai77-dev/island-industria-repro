/**
 * 八方向俯视相机的纯数学部分（不依赖引擎，可单独单测）。
 * 约定：世界为右手系，+Y 朝上；yaw = 0 时相机位于目标 +Z 一侧，朝 -Z 看。
 */

/** 每个观察方向间隔 45°。 */
export const YAW_STEP = Math.PI / 4;
/** 固定俯仰角：水平面以上 50°，玩家不能改变。 */
export const CAMERA_PITCH = (50 * Math.PI) / 180;
/** 镜头距离范围（米）。 */
export const MIN_DISTANCE = 7;
export const MAX_DISTANCE = 26;
export const DEFAULT_DISTANCE = 14;
/** 初始朝向索引：1 = 45°，斜看立方体。 */
export const INITIAL_YAW_INDEX = 1;
/** 观察中心高度（立方体中心附近）。 */
export const FOCUS_HEIGHT = 0.6;
/** 观察中心可移动范围（米）。 */
export const PAN_LIMIT = 10;
/** 平移速度（米/秒）。 */
export const PAN_SPEED = 5;
/** 每一档滚轮的缩放倍率。 */
export const ZOOM_STEP = 1.1;

export type Vec3 = readonly [number, number, number];

/** 与帧率无关的指数阻尼：数值越大，追随目标越快。 */
export function damp(current: number, target: number, rate: number, deltaSeconds: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * deltaSeconds));
}

export function dampVec3(
  current: Vec3,
  target: Vec3,
  rate: number,
  deltaSeconds: number,
): [number, number, number] {
  const t = 1 - Math.exp(-rate * deltaSeconds);
  return [
    current[0] + (target[0] - current[0]) * t,
    current[1] + (target[1] - current[1]) * t,
    current[2] + (target[2] - current[2]) * t,
  ];
}

/** 相机相对观察中心的偏移：水平半径由俯仰角压缩，垂直分量保证不会贴地。 */
export function cameraOffset(yaw: number, distance: number): Vec3 {
  const horizontal = Math.cos(CAMERA_PITCH) * distance;
  return [
    Math.sin(yaw) * horizontal,
    Math.sin(CAMERA_PITCH) * distance,
    Math.cos(yaw) * horizontal,
  ];
}

/** 相机水平朝向：forward 为视线方向的水平投影，right 为屏幕右侧。 */
export function horizontalAxes(yaw: number): {
  forwardX: number;
  forwardZ: number;
  rightX: number;
  rightZ: number;
} {
  return {
    forwardX: -Math.sin(yaw),
    forwardZ: -Math.cos(yaw),
    rightX: Math.cos(yaw),
    rightZ: -Math.sin(yaw),
  };
}

export function clampDistance(distance: number): number {
  return Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, distance));
}

export function clampPan(value: number): number {
  return Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, value));
}

/** 滚轮：正数 = 向下滚 = 拉远；负数 = 拉近。 */
export function zoomDistance(distance: number, wheelDelta: number): number {
  return clampDistance(distance * Math.pow(ZOOM_STEP, wheelDelta));
}
/** 相机插件对外提供的最小控制信息（玩家移动按当前相机 yaw 计算方向）。 */
export interface CameraRigService {
  /** 当前（带阻尼的）水平朝向角，单位弧度。 */
  getYaw(): number;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    cameraRig: CameraRigService;
  }
}
/** 相机系统名（供其它系统声明执行顺序）。 */
export const CAMERA_SYSTEM_NAME = 'island-industria/top-down-camera';
