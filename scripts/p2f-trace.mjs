// Play 脚本内的实时追踪：写文件（CLI 不转发脚本 stdout/stderr，文件最可靠）。
import { appendFileSync } from 'node:fs';

const FILE = '.verify/p2f-live.log';
let seq = 0;

export function trace(label, payload) {
  seq += 1;
  const line = '[' + new Date().toISOString() + '] #' + seq + ' ' + label
    + (payload === undefined ? '' : ' ' + JSON.stringify(payload));
  try { appendFileSync(FILE, line + '\n'); } catch { /* 忽略追踪失败 */ }
}
export function resetTrace() {
  try { appendFileSync(FILE, '--- run start ' + new Date().toISOString() + ' ---\n'); } catch { /* ignore */ }
}
