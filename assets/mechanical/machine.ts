/**
 * M1.7-B 冲压机曲柄滑块纯运动学。
 * 不做完整物理：冲头位置完全由曲柄角 θ 决定，没有定时器、速度或独立积分。
 */

export interface MachineGeometry {
  /** 曲柄半径（米）。 */
  readonly crankRadius: number;
  /** 连杆长度（米），必须大于曲柄半径。 */
  readonly rodLength: number;
  /** 曲柄中心 Y（机器本地坐标）。 */
  readonly crankCenterY: number;
  /** 曲柄中心 Z（机器本地坐标）。 */
  readonly crankCenterZ: number;
  /** 曲柄/连杆/冲头所在本地 X。 */
  readonly crankX: number;
}

export const DEFAULT_MACHINE_GEOMETRY: MachineGeometry = Object.freeze({
  crankRadius: 0.12,
  rodLength: 0.28,
  crankCenterY: 0.5,
  crankCenterZ: 0,
  crankX: -0.3,
});

export interface MachinePose {
  readonly angle: number;
  readonly pinY: number;
  readonly pinZ: number;
  /** 冲头中心本地 Y。 */
  readonly ramY: number;
  /** 连杆中心 [x,y,z]。 */
  readonly rodCenter: readonly [number, number, number];
  /** 连杆绕本地 X 的角度；连杆本地 +Y 指向滑块。 */
  readonly rodAngle: number;
  readonly rodLength: number;
}

export function validateMachineGeometry(geometry: MachineGeometry): void {
  const { crankRadius, rodLength, crankCenterY, crankCenterZ, crankX } = geometry;
  if (![crankRadius, rodLength, crankCenterY, crankCenterZ, crankX].every(Number.isFinite)) {
    throw new RangeError('machine geometry must be finite');
  }
  if (!(crankRadius > 0)) throw new RangeError('crankRadius must be > 0');
  if (!(rodLength > crankRadius)) throw new RangeError('rodLength must be > crankRadius');
}

export function machineStroke(geometry: MachineGeometry = DEFAULT_MACHINE_GEOMETRY): number {
  validateMachineGeometry(geometry);
  return geometry.crankRadius * 2;
}

/**
 * 给定曲柄角 θ 返回唯一姿态。
 * pin 在 YZ 平面旋转；连杆连接 pin 与位于 z=crankCenterZ 的滑块。
 */
export function machinePose(
  angleRadians: number,
  geometry: MachineGeometry = DEFAULT_MACHINE_GEOMETRY,
): MachinePose {
  validateMachineGeometry(geometry);
  if (!Number.isFinite(angleRadians)) throw new RangeError('machine angle must be finite');
  const { crankRadius, rodLength, crankCenterY, crankCenterZ, crankX } = geometry;
  const pinY = crankCenterY + crankRadius * Math.cos(angleRadians);
  const pinZ = crankCenterZ + crankRadius * Math.sin(angleRadians);
  const dz = pinZ - crankCenterZ;
  const root = rodLength * rodLength - dz * dz;
  if (root < 0) throw new RangeError('rod length cannot span crank pin');
  const rodVertical = Math.sqrt(root);
  const ramY = pinY + rodVertical;
  const rodCenter: [number, number, number] = [
    crankX,
    (pinY + ramY) / 2,
    (pinZ + crankCenterZ) / 2,
  ];
  const rodAngle = Math.atan2(-(pinZ - crankCenterZ), rodVertical);
  return { angle: angleRadians, pinY, pinZ, ramY, rodCenter, rodAngle, rodLength };
}
