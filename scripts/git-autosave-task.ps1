# 安装 / 卸载 / 查看 ISLAND INDUSTRIA 自动存档计划任务（登录时启动，无窗口）。
#   powershell -NoProfile -File scripts/git-autosave-task.ps1 -Action install
#   powershell -NoProfile -File scripts/git-autosave-task.ps1 -Action status
#   powershell -NoProfile -File scripts/git-autosave-task.ps1 -Action start | stop | uninstall
[CmdletBinding()]
param([ValidateSet('install', 'uninstall', 'status', 'start', 'stop')][string]$Action = 'status')

$ErrorActionPreference = 'Stop'
$taskName = 'ISLAND INDUSTRIA Git Autosave'
$scriptDir = $PSScriptRoot
$repo = Split-Path -Parent $scriptDir
$vbs = Join-Path $scriptDir 'git-autosave.vbs'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$user = "$env:USERDOMAIN\$env:USERNAME"

function Get-AutosaveProcess {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*git-autosave.ps1*' -and $_.CommandLine -like '*-Loop*' }
}

function Show-Status {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  $info = if ($task) { Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue } else { $null }
  Write-Host "任务名：$taskName"
  Write-Host ("已注册：{0}" -f $(if ($task) { "是（状态 $($task.State)）" } else { '否' }))
  if ($info -and $info.LastRunTime) { Write-Host "上次运行：$($info.LastRunTime)  上次结果：$($info.LastTaskResult)" }
  $procs = @(Get-AutosaveProcess)
  Write-Host ("运行中：{0}" -f $(if ($procs.Count) { ($procs | ForEach-Object { "pid=$($_.ProcessId)" }) -join ', ' } else { '否' }))
}

switch ($Action) {
  'install' {
    if (-not (Test-Path -LiteralPath $wscript)) { throw "找不到 wscript.exe：$wscript" }
    $act = New-ScheduledTaskAction -Execute $wscript -Argument "`"$vbs`"" -WorkingDirectory $repo
    $trg = New-ScheduledTaskTrigger -AtLogOn -User $user
    $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
      -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $prn = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $act -Trigger $trg -Settings $set -Principal $prn `
      -Description 'ISLAND INDUSTRIA：登录后常驻，改动停下约 1 分钟自动 git commit。' -Force | Out-Null
    Write-Host "已注册计划任务：$taskName"
    Show-Status
  }
  'uninstall' {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    foreach ($p in @(Get-AutosaveProcess)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Host "已卸载计划任务并停止自动存档进程：$taskName"
  }
  'start' {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if (-not $task) { throw '计划任务还没安装，先跑 -Action install' }
    Start-ScheduledTask -TaskName $taskName
    Start-Sleep -Seconds 3
    Show-Status
  }
  'stop' {
    foreach ($p in @(Get-AutosaveProcess)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Write-Host '已停止自动存档进程（计划任务会在下次登录时重新启动）。'
    Show-Status
  }
  default { Show-Status }
}
