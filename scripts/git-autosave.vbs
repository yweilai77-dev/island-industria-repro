' Launch the ISLAND INDUSTRIA git autosave loop with no console window (called by Task Scheduler).
Option Explicit
Dim fso, sh, scriptDir, repoRoot, ps1
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fso.GetParentFolderName(scriptDir)
ps1 = scriptDir & "\git-autosave.ps1"
sh.CurrentDirectory = repoRoot
sh.Run "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & ps1 & """ -Loop", 0, False
