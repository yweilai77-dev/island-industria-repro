// P2-E2 新增界面（页签 / 科技页 / 诊断页 / 联合工厂页 / 追踪卡 / 存档页脚）的样式。
// 沿用 docs/design/UI-SPEC.md 的 token 与字号体系，不引入第二套颜色。
// 单独成文件：frontend-ui-styles.ts 保持既有背包/快捷栏样式不动，降低回归风险。
export const FRONTEND_TECH_CSS = `
/* ---- 页签与面板容器 ---- */
.ii-hud { position: absolute; inset: 0; pointer-events: none; z-index: 12; }
.ii-goal[hidden], .ii-tracker[hidden], .ii-pane[hidden] { display: none !important; }
.ii-tabs { display: flex; gap: 4px; align-items: flex-end; margin-left: 16px; margin-right: auto; pointer-events: auto; }
.ii-tab { background: transparent; color: #9fb3c8; border: 1px solid transparent; border-bottom: 2px solid transparent;
  border-radius: 7px 7px 0 0; padding: 5px 14px; cursor: pointer; font-size: 13px; font-family: inherit; }
.ii-tab:hover { color: #e8f3ff; background: #16222e; }
.ii-tab.active { color: #e8f3ff; background: #16222e; border-color: #33475a; border-bottom-color: #e8873a; }
.ii-pane { display: flex; flex: 1; min-width: 0; min-height: 0; }

/* ---- 科技页 ---- */
.ii-tech { display: flex; flex: 1; min-width: 0; min-height: 0; }
.ii-tech-list { flex: 1.15; min-width: 0; overflow-y: auto; padding: 10px 10px 14px; }
.ii-tech-detail { flex: 1; min-width: 0; overflow-y: auto; padding: 12px 14px; background: #0b1219;
  border-left: 1px solid #22303d; display: flex; flex-direction: column; gap: 6px; }
.ii-tech-empty { color: #6f8aa3; font-size: 13px; padding: 16px; }
.ii-tech-stage { margin-bottom: 8px; }
.ii-tech-stage-head { display: flex; align-items: baseline; justify-content: space-between; padding: 4px 2px; }
.ii-tech-stage-label { font-size: 12px; font-weight: 700; color: #e8f3ff; letter-spacing: 0.4px; }
.ii-tech-stage-count { font-size: 11px; color: #6f8aa3; font-variant-numeric: tabular-nums; }
.ii-tech-node { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
  background: #0f1a25; border: 1px solid #22303d; border-left: 3px solid #33475a; border-radius: 8px;
  padding: 7px 9px; margin-bottom: 5px; cursor: pointer; color: inherit; font-family: inherit; }
.ii-tech-node:hover { background: #16222e; border-color: #33475a; }
.ii-tech-node.selected { background: #16293a; border-color: #3c617e; }
.ii-tech-node[data-status="available"] { border-left-color: #e8873a; }
.ii-tech-node[data-status="researching"] { border-left-color: #ffc857; }
.ii-tech-node[data-status="completed"] { border-left-color: #7dff9b; }
.ii-tech-node[data-status="locked"] { opacity: 0.78; }
.ii-tech-node-head { display: flex; align-items: baseline; gap: 6px; }
.ii-tech-node-name { font-size: 13px; font-weight: 700; color: #eaf4ff; }
.ii-tech-node-route { font-size: 10.5px; color: #6f8aa3; }
.ii-tech-badge, .ii-tech-detail-badge { margin-left: auto; font-size: 10.5px; padding: 1px 6px; border-radius: 5px;
  border: 1px solid #33475a; color: #9fb3c8; white-space: nowrap; }
.ii-tech-badge[data-tone="info"], .ii-tech-detail-badge[data-tone="info"] { color: #57d4ff; border-color: #2f6d8a; }
.ii-tech-badge[data-tone="accent"], .ii-tech-detail-badge[data-tone="accent"] { color: #ffc857; border-color: #7a6233; }
.ii-tech-badge[data-tone="ok"], .ii-tech-detail-badge[data-tone="ok"] { color: #7dff9b; border-color: #3d6b4d; }
.ii-tech-node-desc { font-size: 11px; line-height: 1.45; color: #9fb3c8; }
.ii-tech-prereq { font-size: 10.5px; line-height: 1.4; color: #7f97ad; }
.ii-tech-node-mats, .ii-tech-node-unlocks { font-size: 10.5px; line-height: 1.4; color: #8aa3bb; }
.ii-tech-node-awaiting { font-size: 10.5px; color: #ffc857; }
.ii-tech-node-bar, .ii-tech-detail-bar { display: block; height: 4px; border-radius: 2px; background: #16222e; overflow: hidden; margin-top: 2px; }
.ii-tech-node-bar > i, .ii-tech-detail-bar > i { display: block; height: 100%; width: 0; background: #e8873a; transition: width 160ms ease-out; }
.ii-tech-node[data-status="completed"] .ii-tech-node-bar > i { background: #7dff9b; }
.ii-tech-detail-empty { color: #6f8aa3; font-size: 13px; margin: auto; text-align: center; }
.ii-tech-detail-head { display: flex; align-items: baseline; gap: 8px; }
.ii-tech-detail-name { font-size: 17px; font-weight: 700; color: #eaf4ff; }
.ii-tech-detail-sub { font-size: 11.5px; color: #6f8aa3; }
.ii-tech-detail-desc { font-size: 12.5px; line-height: 1.55; color: #b9c9d9; }
.ii-tech-detail-purpose { font-size: 11.5px; line-height: 1.5; color: #9fb3c8; }
.ii-tech-detail-status { font-size: 12px; color: #9fb3c8; }
.ii-tech-detail-status[data-tone="ok"] { color: #7dff9b; }
.ii-tech-detail-status[data-tone="accent"] { color: #ffc857; }
.ii-tech-detail-status[data-tone="info"] { color: #57d4ff; }
.ii-tech-section { margin-top: 2px; font-size: 10px; letter-spacing: 1px; color: #6f8aa3; border-top: 1px solid #22303d; padding-top: 6px; }
.ii-tech-prereq-line { font-size: 11.5px; line-height: 1.5; color: #9fb3c8; }
.ii-tech-prereq-line.ok { color: #7dff9b; }
.ii-tech-prereq-line.off { color: #ff9a8a; }
.ii-tech-material { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 3px 0; border-bottom: 1px dashed #1b2733; }
.ii-tech-material-name { min-width: 52px; color: #e6f1fb; }
.ii-tech-material-count { color: #9fb3c8; font-variant-numeric: tabular-nums; }
.ii-tech-material-have { color: #6f8aa3; font-size: 11px; }
.ii-tech-material-actions { margin-left: auto; display: flex; gap: 6px; }
.ii-tech-btn { background: #1b2b3a; color: #cfddec; border: 1px solid #33475a; border-radius: 6px;
  padding: 3px 9px; cursor: pointer; font-size: 11.5px; font-family: inherit; }
.ii-tech-btn:hover:not(:disabled) { background: #24384a; color: #eaf4ff; }
.ii-tech-btn.primary { border-color: #8a5a2c; color: #f2c79a; }
.ii-tech-btn.active { border-color: #2f6d8a; color: #57d4ff; }
.ii-tech-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.ii-tech-awaiting { border: 1px solid #7a6233; border-radius: 8px; background: rgba(232, 135, 58, 0.12);
  color: #ffc857; font-size: 11.5px; padding: 6px 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ii-tech-unlock-line { font-size: 11.5px; line-height: 1.5; color: #9fb3c8; }
.ii-tech-error { margin-top: 4px; font-size: 11.5px; line-height: 1.45; color: #ff9a8a; border-left: 2px solid #ff6b5a; padding-left: 6px; }

/* ---- HUD 科技追踪卡（与订单 HUD 同一位置，互斥显示） ---- */
.ii-tracker { position: absolute; left: 16px; top: 146px; width: 302px; z-index: 12; pointer-events: none;
  display: flex; flex-direction: column; gap: 3px; padding: 9px 10px 8px;
  background: rgba(8, 14, 20, 0.86); border: 1px solid #2b3d4f; border-left: 3px solid #57d4ff;
  border-radius: 12px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55); }
.ii-tracker[data-mode="hint"] { border-left-color: #4a5d70; }
.ii-tracker[data-status="completed"] { border-left-color: #7dff9b; }
.ii-tracker[data-status="researching"] { border-left-color: #ffc857; }
.ii-tracker-head { display: flex; align-items: baseline; gap: 8px; }
.ii-tracker-title { font-size: 13px; font-weight: 700; color: #f2e7dc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ii-tracker-badge { margin-left: auto; font-size: 10.5px; padding: 1px 6px; border-radius: 5px;
  border: 1px solid #33475a; color: #9fb3c8; white-space: nowrap; }
.ii-tracker-badge[data-tone="info"] { color: #57d4ff; border-color: #2f6d8a; }
.ii-tracker-badge[data-tone="accent"] { color: #ffc857; border-color: #7a6233; }
.ii-tracker-badge[data-tone="ok"] { color: #7dff9b; border-color: #3d6b4d; }
.ii-tracker-sub { font-size: 11px; color: #9fb3c8; }
.ii-tracker-bar { height: 4px; border-radius: 2px; background: #16222e; overflow: hidden; }
.ii-tracker-bar > i { display: block; height: 100%; width: 0; border-radius: 2px; background: #57d4ff; transition: width 160ms ease-out; }
.ii-tracker[data-status="completed"] .ii-tracker-bar > i { background: #7dff9b; }
.ii-tracker-mats { display: flex; flex-direction: column; gap: 1px; }
.ii-tracker-mat { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 11px; color: #9fb3c8; }
.ii-tracker-mat.complete { color: #9fd9b4; }
.ii-tracker-mat-count { font-variant-numeric: tabular-nums; color: #57d4ff; }
.ii-tracker-mat.complete .ii-tracker-mat-count { color: #6f8aa3; }
.ii-tracker-blocked { font-size: 11px; line-height: 1.4; color: #ffc857; }
.ii-tracker-note { font-size: 11px; color: #57d4ff; }
.ii-tracker-hint { font-size: 11.5px; color: #9fb3c8; }

/* ---- 产线诊断页 ---- */
.ii-diag { flex: 1; min-width: 0; overflow-y: auto; padding: 12px 16px 18px; display: flex; flex-direction: column; gap: 6px; }
.ii-diag-locked { margin: auto; text-align: center; display: flex; flex-direction: column; gap: 6px; color: #9fb3c8; }
.ii-diag-locked-title { font-size: 15px; font-weight: 700; color: #e8f3ff; }
.ii-diag-locked-hint { font-size: 12px; color: #7f97ad; }
.ii-diag-summary { display: flex; gap: 8px; flex-wrap: wrap; }
.ii-diag-summary-cell { min-width: 78px; background: #0f1a25; border: 1px solid #22303d; border-radius: 8px; padding: 6px 10px; display: flex; flex-direction: column; }
.ii-diag-summary-value { font-size: 20px; font-weight: 700; color: #e8f3ff; font-variant-numeric: tabular-nums; }
.ii-diag-summary-label { font-size: 11px; color: #7f97ad; }
.ii-diag-summary[data-error="1"] .ii-diag-summary-cell[data-metric="blocked"] .ii-diag-summary-value { color: #ff9a8a; }
.ii-diag-bottleneck { border: 1px solid #7a6233; background: rgba(232, 135, 58, 0.12); border-radius: 8px; padding: 6px 10px; display: flex; flex-direction: column; gap: 2px; }
.ii-diag-bottleneck-label { font-size: 12px; font-weight: 700; color: #ffc857; }
.ii-diag-bottleneck-detail { font-size: 11.5px; color: #d6c3a5; }
.ii-diag-section { margin-top: 6px; font-size: 11px; letter-spacing: 1px; color: #6f8aa3; border-top: 1px solid #22303d; padding-top: 6px; }
.ii-diag-empty { font-size: 12px; color: #6f8aa3; }
.ii-diag-machine { border: 1px solid #22303d; border-left: 3px solid #33475a; border-radius: 8px; background: #0f1a25; padding: 7px 10px; display: flex; flex-direction: column; gap: 2px; }
.ii-diag-machine[data-severity="warn"] { border-left-color: #ffc857; }
.ii-diag-machine[data-severity="error"] { border-left-color: #ff6b5a; }
.ii-diag-machine[data-severity="ok"] { border-left-color: #7dff9b; }
.ii-diag-machine-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.ii-diag-machine-name { font-size: 12.5px; font-weight: 700; color: #eaf4ff; }
.ii-diag-machine-state { font-size: 11px; padding: 0 6px; border-radius: 5px; border: 1px solid #33475a; color: #9fb3c8; }
.ii-diag-machine-state[data-severity="warn"] { color: #ffc857; border-color: #7a6233; }
.ii-diag-machine-state[data-severity="error"] { color: #ff9a8a; border-color: #7a3a33; }
.ii-diag-machine-state[data-severity="ok"] { color: #7dff9b; border-color: #3d6b4d; }
.ii-diag-machine-line { font-size: 11px; line-height: 1.45; color: #9fb3c8; }
.ii-diag-conditions { display: flex; flex-wrap: wrap; gap: 2px 12px; margin-top: 1px; }
.ii-diag-condition { font-size: 10.5px; line-height: 1.4; color: #9fb3c8; }
.ii-diag-condition.ok { color: #9fd9b4; }
.ii-diag-condition.off { color: #ffc857; }
.ii-diag-machine-message { font-size: 11px; color: #ffc857; }
.ii-diag-link { display: flex; flex-direction: column; gap: 1px; border-bottom: 1px dashed #1b2733; padding: 4px 2px; }
.ii-diag-link-route { font-size: 11.5px; color: #e6f1fb; }
.ii-diag-link-state { font-size: 11px; color: #9fb3c8; }
.ii-diag-link[data-blocked="1"] .ii-diag-link-state { color: #ff9a8a; }
.ii-diag-link-message { font-size: 10.5px; color: #ffc857; }

/* ---- 联合工厂页 ---- */
.ii-project { flex: 1; min-width: 0; overflow-y: auto; padding: 12px 16px 18px; display: flex; flex-direction: column; gap: 6px; }
.ii-project-empty { color: #6f8aa3; font-size: 13px; margin: auto; }
.ii-project-banner { border: 1px solid #3d6b4d; background: rgba(125, 255, 155, 0.1); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
.ii-project-banner-title { font-size: 17px; font-weight: 700; color: #7dff9b; }
.ii-project-banner-text { font-size: 12px; color: #c8e8d2; }
.ii-project-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.ii-project-title { font-size: 17px; font-weight: 700; color: #eaf4ff; }
.ii-project-status { font-size: 11.5px; padding: 1px 8px; border-radius: 5px; border: 1px solid #33475a; color: #9fb3c8; }
.ii-project-status[data-tone="ok"] { color: #7dff9b; border-color: #3d6b4d; }
.ii-project-status[data-tone="accent"] { color: #ffc857; border-color: #7a6233; }
.ii-project-section { margin-top: 4px; display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  font-size: 11px; letter-spacing: 1px; color: #6f8aa3; border-top: 1px solid #22303d; padding-top: 6px; }
.ii-project-section-title { letter-spacing: 1px; }
.ii-project-section-count { font-size: 11.5px; color: #9fb3c8; font-variant-numeric: tabular-nums; }
.ii-project-delivery { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 14px; }
.ii-project-item { display: flex; align-items: baseline; gap: 8px; font-size: 11.5px; color: #9fb3c8; border-bottom: 1px dashed #1b2733; padding: 2px 0; }
.ii-project-item-name { min-width: 84px; color: #e6f1fb; }
.ii-project-item-count { font-variant-numeric: tabular-nums; color: #57d4ff; }
.ii-project-item-have { color: #6f8aa3; font-size: 10.5px; }
.ii-project-item-ok { margin-left: auto; font-size: 10.5px; color: #7dff9b; white-space: nowrap; }
.ii-project-item[data-complete="0"] .ii-project-item-ok { color: #7f97ad; }
.ii-project-proof { display: flex; flex-direction: column; gap: 4px; }
.ii-project-proof-window, .ii-project-proof-produced { font-size: 11.5px; color: #9fb3c8; }
.ii-project-proof-bar { height: 6px; border-radius: 3px; background: #16222e; overflow: hidden; }
.ii-project-proof-bar > i { display: block; height: 100%; width: 0; background: #e8873a; transition: width 160ms ease-out; }
.ii-project-proof[data-state="passed"] .ii-project-proof-bar > i { background: #7dff9b; }
.ii-project-proof[data-state="failed"] .ii-project-proof-bar > i { background: #ff6b5a; }
.ii-project-condition { display: flex; align-items: baseline; gap: 8px; font-size: 11.5px; color: #9fb3c8; padding: 1px 0; }
.ii-project-condition-icon { width: 12px; text-align: center; color: #7dff9b; }
.ii-project-condition[data-ok="0"] .ii-project-condition-icon { color: #ff9a8a; }
.ii-project-condition-label { flex: 1; min-width: 0; }
.ii-project-condition-value { font-variant-numeric: tabular-nums; color: #6f8aa3; }
.ii-project-failure { font-size: 11.5px; color: #ff9a8a; }
.ii-project-actions { display: flex; gap: 8px; margin-top: 4px; }
.ii-project-btn { background: #1b2b3a; color: #cfddec; border: 1px solid #33475a; border-radius: 6px;
  padding: 5px 12px; cursor: pointer; font-size: 12px; font-family: inherit; }
.ii-project-btn.primary { border-color: #8a5a2c; color: #f2c79a; }
.ii-project-btn:hover:not(:disabled) { background: #24384a; }
.ii-project-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.ii-project-blocks { display: flex; flex-direction: column; gap: 2px; }
.ii-project-block { font-size: 11.5px; line-height: 1.5; color: #ffc857; }
.ii-project-block.ok { color: #7dff9b; }

/* ---- 存档页脚（模态框底部，1280×600 下也不溢出） ---- */
.ii-save { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 36px;
  padding: 5px 14px; border-top: 1px solid #22303d; background: #0c141d; }
.ii-save-status { font-size: 11px; color: #9fb3c8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.ii-save-status[data-tone="ok"] { color: #7dff9b; }
.ii-save-status[data-tone="info"] { color: #57d4ff; }
.ii-save-status[data-tone="danger"] { color: #ff9a8a; }
.ii-save-status[data-tone="muted"] { color: #7f97ad; }
.ii-save-actions { display: flex; gap: 6px; flex: none; }
.ii-save-btn { background: #1b2b3a; color: #cfddec; border: 1px solid #33475a; border-radius: 6px;
  padding: 3px 9px; cursor: pointer; font-size: 11px; font-family: inherit; white-space: nowrap; }
.ii-save-btn:hover { background: #24384a; }
.ii-save-btn[data-ii-action="save-new"] { color: #ffc857; border-color: #7a6233; }
`;
