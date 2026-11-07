// 背包 / 快捷栏 UI 的样式表。单独成文件：样式改动频繁但风险低，和交互逻辑分开更好读。
export const FRONTEND_UI_CSS = `
.ii-ui { position: fixed; inset: 0; pointer-events: none; z-index: 1000;
  /* 槽宽按格数自适应：12 格整条总能塞进视口（32px 左右安全边距 + 11 个间隙），不换行、不溢出。 */
  --ii-slot-size: clamp(30px, min(4.2vw, calc((100vw - 152px) / 12)), 46px);
  --ii-slot-gap: 8px;
  font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; color: #dbe7f3; }
.ii-ui * { box-sizing: border-box; }
.ii-hotbar { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
  display: flex; gap: var(--ii-slot-gap); padding: 8px; max-width: calc(100vw - 32px);
  background: rgba(8, 13, 19, 0.86);
  border: 1px solid #2c3c4c; border-radius: 14px; pointer-events: auto; z-index: 30;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.5); }
.ii-slot { position: relative; flex: 0 0 auto; width: var(--ii-slot-size); height: var(--ii-slot-size); border-radius: 9px;
  border: 1px solid #33475a; background: linear-gradient(180deg, #16222e, #0e1720);
  cursor: pointer; display: flex; align-items: center; justify-content: center; user-select: none; }
.ii-slot:hover { border-color: #5b7e9c; background: linear-gradient(180deg, #1b2b3a, #101b26); }
.ii-slot.selected { border-color: #57d4ff; box-shadow: 0 0 0 1px #57d4ff, 0 0 16px rgba(87, 212, 255, 0.55); }
.ii-slot.drop-target { border-color: #7dff9b; box-shadow: 0 0 12px rgba(125, 255, 155, 0.6); }
.ii-slot-key { position: absolute; left: 5px; top: 3px; font-size: 10px; color: #6f8aa3; }
.ii-slot-icon { width: 65%; height: 65%; }
.ii-slot-count { position: absolute; right: 5px; bottom: 3px; font-size: 12px; font-weight: 600;
  color: #eaf4ff; text-shadow: 0 1px 2px #000; }
.ii-slot.empty .ii-slot-icon { display: none; }
.ii-backpack { position: absolute; inset: 0; background: rgba(4, 8, 12, 0.86);
  display: flex; align-items: center; justify-content: center; pointer-events: auto; z-index: 20; }
.ii-backpack[hidden] { display: none; }
.ii-frame { width: min(1040px, 94vw); height: min(660px, 84vh); background: #0c141d;
  border: 1px solid #2c3c4c; border-radius: 14px; display: flex; flex-direction: column;
  overflow: hidden; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.65); }
.ii-head { display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid #22303d; background: #0f1a25; }
.ii-title { font-size: 17px; font-weight: 700; letter-spacing: 1px; color: #e8f3ff; }
.ii-sub { font-size: 12px; color: #7f97ad; margin-left: 10px; font-weight: 400; }
.ii-close { pointer-events: auto; background: #1b2b3a; color: #cfddec; border: 1px solid #33475a;
  border-radius: 7px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.ii-close:hover { background: #24384a; }
.ii-body { display: flex; flex: 1; min-height: 0; }
.ii-list-panel { flex: 1.35; display: flex; flex-direction: column; min-width: 0; }
.ii-list { flex: 1; overflow-y: auto; padding: 10px; }
.ii-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 9px;
  cursor: pointer; border: 1px solid transparent; margin-bottom: 4px; }
.ii-row:hover { background: #16222e; }
.ii-row.selected { background: #16293a; border-color: #3c617e; }
.ii-row-icon { width: 34px; height: 34px; flex: none; }
.ii-row-main { flex: 1; min-width: 0; }
.ii-row-name { font-size: 14px; color: #e6f1fb; }
.ii-row-count { font-size: 13px; color: #9fb3c8; margin-left: 8px; }
.ii-bound { font-size: 11px; color: #57d4ff; border: 1px solid #2f6d8a; border-radius: 5px;
  padding: 1px 6px; margin-left: 8px; }
.ii-empty { color: #7f97ad; font-size: 13px; padding: 16px; }
.ii-detail { flex: 1; border-left: 1px solid #22303d; background: #0b1219; padding: 18px;
  display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
.ii-detail-icon { width: 84px; height: 84px; }
.ii-detail-name { font-size: 20px; font-weight: 700; color: #eef7ff; }
.ii-detail-count { font-size: 14px; color: #9fb3c8; }
.ii-detail-desc { font-size: 13px; line-height: 1.7; color: #b9c9d9; }
.ii-detail-binding { font-size: 13px; color: #57d4ff; }
.ii-detail-empty { color: #6f8aa3; font-size: 13px; margin: auto; text-align: center; }
.ii-error { font-size: 12px; color: #ff9a8a; margin-left: 10px; }
.ii-drag-ghost { position: fixed; width: 42px; height: 42px; pointer-events: none; z-index: 100;
  transform: translate(-50%, -50%); opacity: 0.9; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.6)); }
/* 落在快捷栏正上方 6px：快捷栏总高 = 槽高 + 上下内边距 16 + 边框 2，距底 18。 */
.ii-hint { position: absolute; left: 50%; bottom: calc(var(--ii-slot-size) + 42px); transform: translateX(-50%);
  font-size: 12px; color: #8aa3bb; background: rgba(8,13,19,0.8); border: 1px solid #22303d;
  border-radius: 6px; padding: 4px 10px; pointer-events: none; z-index: 25; }
`;
