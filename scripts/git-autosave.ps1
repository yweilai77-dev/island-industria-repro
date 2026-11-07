# ISLAND INDUSTRIA 自动存档：工作区改动停下后自动 git commit。
#   powershell -NoProfile -File scripts/git-autosave.ps1          常驻循环（计划任务用）
#   powershell -NoProfile -File scripts/git-autosave.ps1 -Once    只跑一轮
#   powershell -NoProfile -File scripts/git-autosave.ps1 -Status  查看状态
[CmdletBinding()]
param(
  [string]$Repo = '',
  [int]$IdleSeconds = 60,
  [int]$PollSeconds = 20,
  [switch]$Once,
  [switch]$Status,
  [switch]$Loop
)

$ErrorActionPreference = 'Stop'
$script:TaskName = 'ISLAND INDUSTRIA Git Autosave'
$script:LastLogLine = ''

function Resolve-Git {
  foreach ($p in @("$env:ProgramFiles\Git\cmd\git.exe", "${env:ProgramFiles(x86)}\Git\cmd\git.exe")) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  $c = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  throw '找不到 git.exe'
}

$script:RepoRoot = if ($Repo) { (Resolve-Path -LiteralPath $Repo).Path } else { Split-Path -Parent $PSScriptRoot }
$script:GitDir = Join-Path $script:RepoRoot '.git'
$script:Git = Resolve-Git
$script:LogFile = Join-Path $script:GitDir 'autosave.log'
if (-not (Test-Path -LiteralPath $script:GitDir)) { throw "不是 Git 仓库：$($script:RepoRoot)" }

function Write-AutosaveLog {
  param([string]$Message, [string]$Level = 'INFO')
  # 同一条消息连续重复只记一次，避免钩子反复拒绝时刷爆日志。
  if ($Message -eq $script:LastLogLine) { return }
  $script:LastLogLine = $Message
  try {
    if ((Test-Path -LiteralPath $script:LogFile) -and ((Get-Item -LiteralPath $script:LogFile).Length -gt 1MB)) {
      Move-Item -LiteralPath $script:LogFile -Destination "$($script:LogFile).1" -Force
    }
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8
  } catch { }
}

function Invoke-Git {
  param([string[]]$Arguments)
  $out = & $script:Git -C $script:RepoRoot @Arguments 2>&1
  return [pscustomobject]@{ Code = $LASTEXITCODE; Output = (($out | Out-String).Trim()) }
}

function Get-ChangedPaths {
  $paths = New-Object System.Collections.Generic.List[string]
  foreach ($argSet in @(
      @('diff', '--name-only'),
      @('diff', '--cached', '--name-only'),
      @('ls-files', '--others', '--exclude-standard'))) {
    $r = Invoke-Git -Arguments (@('--no-optional-locks') + $argSet)
    if ($r.Code -ne 0) { continue }
    foreach ($line in ($r.Output -split "`r?`n")) {
      $t = $line.Trim()
      if ($t) { $paths.Add($t) }
    }
  }
  return @($paths | Sort-Object -Unique)
}

function Test-GitBusy {
  foreach ($m in @('index.lock', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply')) {
    if (Test-Path -LiteralPath (Join-Path $script:GitDir $m)) { return $true }
  }
  return $false
}

function Invoke-AutosaveOnce {
  if (Test-GitBusy) { return 'busy' }
  if ((Invoke-Git -Arguments @('symbolic-ref', '--quiet', '--short', 'HEAD')).Code -ne 0) {
    Write-AutosaveLog 'HEAD 处于分离状态，跳过自动存档' 'WARN'
    return 'detached'
  }
  $paths = Get-ChangedPaths
  if ($paths.Count -eq 0) { return 'clean' }

  # 防抖：改动刚发生（文件 mtime 太新）就先不提交，避免存到写了一半的文件。
  $newest = $null
  foreach ($rel in $paths) {
    $full = Join-Path $script:RepoRoot $rel
    if (Test-Path -LiteralPath $full -PathType Leaf) {
      $t = (Get-Item -LiteralPath $full -Force).LastWriteTime
      if (-not $newest -or $t -gt $newest) { $newest = $t }
    }
  }
  if ($newest -and ((Get-Date) - $newest).TotalSeconds -lt $IdleSeconds) { return 'waiting' }

  $add = Invoke-Git -Arguments @('add', '-A', '--', '.')
  if ($add.Code -ne 0) { Write-AutosaveLog "git add 失败：$($add.Output)" 'ERROR'; return 'failed' }
  if ((Invoke-Git -Arguments @('diff', '--cached', '--quiet')).Code -eq 0) { return 'clean' }

  $staged = Invoke-Git -Arguments @('diff', '--cached', '--name-only')
  $count = @($staged.Output -split "`r?`n" | Where-Object { $_.Trim() }).Count
  $subject = 'autosave: {0}（{1} 个文件）' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $count
  $commit = Invoke-Git -Arguments @('commit', '-m', $subject)
  if ($commit.Code -ne 0) {
    Write-AutosaveLog "自动存档被拒绝（多半是代码文件超过 20 KB）：$($commit.Output)" 'ERROR'
    return 'failed'
  }
  $hash = (Invoke-Git -Arguments @('rev-parse', '--short', 'HEAD')).Output
  Write-AutosaveLog "已存档 $hash $subject" 'OK'
  return 'committed'
}

function Get-AutosaveProcess {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*git-autosave.ps1*' -and $_.CommandLine -like '*-Loop*' }
}

if ($Status) {
  Write-Host "仓库：$($script:RepoRoot)"
  $task = Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue
  Write-Host ("计划任务：{0}" -f $(if ($task) { "$($task.State)（$($script:TaskName)）" } else { '未注册' }))
  $procs = @(Get-AutosaveProcess)
  Write-Host ("运行进程：{0}" -f $(if ($procs.Count) { ($procs | ForEach-Object { "pid=$($_.ProcessId)" }) -join ', ' } else { '无' }))
  $dirty = @(Get-ChangedPaths).Count
  Write-Host ("工作区：{0}" -f $(if ($dirty) { "$dirty 个文件待存档" } else { '干净' }))
  $last = Invoke-Git -Arguments @('log', '-1', '--format=%h %ad %s', '--date=format:%Y-%m-%d %H:%M:%S')
  Write-Host ("最近提交：{0}" -f $(if ($last.Code -eq 0) { $last.Output } else { '（还没有提交）' }))
  if (Test-Path -LiteralPath $script:LogFile) {
    Write-Host '最近日志：'
    Get-Content -LiteralPath $script:LogFile -Tail 8 | ForEach-Object { "  $_" }
  }
  return
}

if ($Once) {
  $result = Invoke-AutosaveOnce
  Write-Host $result
  return
}

$lockPath = Join-Path $script:GitDir 'autosave.lock'
try {
  $lock = New-Object System.IO.FileStream($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch {
  Write-Host '已有自动存档实例在运行，本次退出。'
  return
}

try {
  Write-AutosaveLog "自动存档已启动（pid=$PID，空闲 ${IdleSeconds}s 后提交，每 ${PollSeconds}s 检查一次）" 'OK'
  while ($true) {
    try { $null = Invoke-AutosaveOnce } catch { Write-AutosaveLog "运行异常：$($_.Exception.Message)" 'ERROR' }
    Start-Sleep -Seconds $PollSeconds
  }
} finally {
  $lock.Dispose()
}
