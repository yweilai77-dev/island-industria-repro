# Git 自动存档

本工程已启用 Git 仓库，并装了一个后台自动存档：**工作区改动停下约 1 分钟后，自动提交一条
`autosave: <时间>（N 个文件）`**。它不替代有意义的提交，只负责保证任何时刻都能回到几分钟前。

## 组成

| 文件 | 作用 |
|:--|:--|
| `scripts/git-autosave.ps1` | 存档本体：检查改动、防抖、提交、写日志 |
| `scripts/git-autosave.vbs` | 无窗口启动器（计划任务调它，不会闪黑框） |
| `scripts/git-autosave-task.ps1` | 计划任务的安装 / 卸载 / 启停 / 状态 |
| `.git/autosave.log` | 运行日志（不在代码库里） |

计划任务名：`ISLAND INDUSTRIA Git Autosave`，触发条件为「当前用户登录时」，常驻一个隐藏的
PowerShell 进程，每 20 秒检查一次。

## 日常命令

```powershell
# 看状态：计划任务、进程、待提交文件、最近一次提交、最近日志
powershell -NoProfile -File scripts/git-autosave-task.ps1 -Action status
powershell -NoProfile -File scripts/git-autosave.ps1 -Status

# 手动立刻存一次（不等防抖）
powershell -NoProfile -File scripts/git-autosave.ps1 -Once -IdleSeconds 0

# 暂停 / 恢复（恢复 = 重新拉起隐藏进程，不改计划任务）
powershell -NoProfile -File scripts/git-autosave-task.ps1 -Action stop
powershell -NoProfile -File scripts/git-autosave-task.ps1 -Action start

# 彻底卸载（删计划任务并停进程；存档历史保留）
powershell -NoProfile -File scripts/git-autosave-task.ps1 -Action uninstall
```

## 行为细节

- 防抖 60 秒：只要还有文件在最近 60 秒内被改过就不提交，避免存到写了一半的文件。
- 提交范围：`git add -A` 能看到的全部改动，`.gitignore` 里的（`node_modules/`、`dist/`、
  `.forgeax/`、`.assetlib/`、`.game-builder/state|artifacts|...`、助手工具目录）不会进库。
- 遇到 Git 正在操作（`index.lock`、merge/rebase 标记）会跳过这一轮。
- 提交会走全局 `pre-commit` 钩子（代码文件 20 KB 上限）。被拒时日志记一条 ERROR，
  **改动不会丢**，把它拆小后下一轮会自己提交成功。
- `skills/` 在 `.gitattributes` 里标成 `linguist-generated`：这是 SDK 安装的内容，
  不该被 20 KB 规则卡住。
- 换行：仓库级 `core.autocrlf=false`，磁盘上是什么字节就存什么，不自动转换。
- 提交身份：`Admin <admin@localhost>`（仓库级，只影响本工程）。以后要推到 GitHub/Gitee，
  先改成自己的：

  ```powershell
  git config user.name "你的名字"
  git config user.email "you@example.com"
  ```

## 调参数

`scripts/git-autosave.ps1` 顶部参数：`-IdleSeconds`（防抖秒数，默认 60）、
`-PollSeconds`（轮询间隔，默认 20）。改完 `git-autosave-task.ps1 -Action stop` 再 `-Action start`。

## 注意事项

- **这两个 `.ps1` 必须保存成 UTF-8 with BOM**。Windows PowerShell 5.1 不带 BOM 时会按 GBK
  读取，中文注释会让整个脚本语法报错。用 VS Code 时右下角确认是 `UTF-8 with BOM`。
- 自动存档会把你手动 `git add` 过的暂存内容一起提交；如果要做精细的多次提交，先
  `git-autosave.ps1 -Action stop` 停一会儿。
- 回滚优先用 `git checkout <commit> -- <path>`；`git reset --hard` 会丢掉还没提交的改动，
  谨慎使用。
- 现在只有本地存档，没有远程备份。要真正防丢，加个远程仓库并定期 `git push`：

  ```powershell
  git remote add origin <仓库地址>
  git push -u origin main
  ```
