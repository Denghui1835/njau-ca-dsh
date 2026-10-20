# code 包负责人

> 换届时这份文件必须更新。开发柱能写文件、能跑命令，坏了可能改坏别人的项目。

## 现在谁负责

| 角色 | 姓名 | 联系方式 | 从什么时候 |
| --- | --- | --- | --- |
| 负责人 | 【校内渠道】 | 【校内渠道】 | 2026–2027 学年 |
| 备份 | 【校内渠道】 | 【校内渠道】 | 2026–2027 学年 |

> 本仓库是公开的：姓名与联系方式写进**校内**渠道，别写在这里。

## 交接时必须口头交代的三件事

1. **「运行」的白名单不能放宽。**
   想跑任意命令的人应该去用 DSH 的终端，那是明确的、用户知情的执行面。
   把 `service.run()` 里的 `GIT_ACTIONS` / `:run:<script>` 两道校验放开，
   等于给一个 UI 按钮装上后门。要加命令，就加在白名单里并写清楚为什么。

2. **路径必须在项目内。**
   `resolveProject()` 限定在 `site/` 与 `learning/`，`resolveInside()` 拒绝 `..`。
   这两道是「面板不会去改别的地方」的唯一保证，删了就没边界了。

3. **大文件与二进制明确拒绝，不要「尽力而为」。**
   `file/too-large`（>1MB）与 `file/binary`（含 `\0`）是有意的：
   让面板把 200MB 的日志塞进 textarea，用户看到的就是「卡死」，而不是「不支持」。

## 改代码之后怎么让它生效（踩过的坑）

`file:` 依赖是**拷贝**进 profile 的，不是软链。改完必须 remove + add：

```powershell
# 把 <repo> 换成本机 clone 的位置
dsh plugin --profile njau remove "@njau-ca/dsh-njau-code"
dsh plugin --profile njau add "file:<repo>/packages/code"
```

判断有没有生效：比对源文件与
`%USERPROFILE%\.dsh\profiles\njau\node_modules\@njau-ca\dsh-njau-code\` 下同名文件的字节数。

> 实际踩过的一次：高亮类名写成了 `nc-t-*`，CSS 里定义的是 `nk-t-*`。
> 语法检查、接口测试、端到端全部通过，**只有颜色不生效**。
> 所以「bundle 里有没有那个字符串」这种检查也要做 —— 见 `verify-live` 之后的手工比对。

## 这个包最容易在什么时候坏

按可能性排序：

1. **Windows 上跑不动命令** —— 症状：运行按钮返回 exit code 1、输出为空。
   实现里是 `cmd.exe /d /s /c` 起子进程；如果哪天改成直接 `spawn('npm')`，
   Windows 会找不到 `.cmd`。冒烟测试里那条「npm:run:build 退出码 0」就是防这个的。
2. **项目发现不到** —— 症状：面板里项目列表为空。
   判定条件是「有 package.json / index.html / .git 之一」，并且必须在 `site/` 或 `learning/` 下。
3. **文件树太慢** —— 症状：大项目里点开很卡。
   `walk()` 有 `MAX_TREE_ENTRIES`（1500）与深度 4 两道闸；改大之前先想清楚。
4. **DSH 升级后工具注册契约变了** —— 症状：插件加载了但工具没出现。
   看启动日志 `[njau-code] 已加载 … 工具 N`，N 应该是 6。

排查顺序：启动日志 → `/njau/api/code/health` → `node tests/smoke-code.mjs`。

## 怎么彻底删掉这个包

```powershell
dsh plugin --profile njau remove "@njau-ca/dsh-njau-code"
```

`site/` 与 `learning/` 下的项目**不要删** —— 那是协会的代码，不属于这个插件。
