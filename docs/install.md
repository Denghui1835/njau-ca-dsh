# 安装与验证

> 这份文件是**给下一届的**。照着做，不需要问任何人。

## 0. 前提

- 装好了 DeepSeek Harness（DSH）桌面版。
- 本仓库放在一个**不会被清掉**的位置，例如 `D:\njau-ca-dsh`。
  注意：下面的命令里凡是出现路径的地方，都要换成你自己的实际路径。

DSH 的 profile 目录是 `%USERPROFILE%\.dsh\profiles\`。
协会版会装在**独立的 profile `njau`** 里，**不动**你自己平时用的 `desktop` profile。

---

## 1. 安装

### 推荐：双击 `scripts\install.cmd`

在资源管理器里进 `scripts` 文件夹，**双击 `install.cmd`**。
窗口会自己跑完，然后停在「Press any key to close」，看一眼有没有报错就行。

想装到别的 profile 名字，用命令行传参：

```cmd
scripts\install.cmd myprofile
```

### 或者：PowerShell 里跑

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

### ⚠️ 如果你直接跑 `install.ps1` 报错

报这种错：

```
无法加载文件 ...\install.ps1。未对文件 ... 进行数字签名。
无法在当前系统上运行该脚本。
```

**这不是仓库的问题，是 Windows 的默认安全策略**（执行策略 `Restricted`，
不许跑没签名的脚本）。三种解法，任选一种：

| 办法 | 命令 | 说明 |
| --- | --- | --- |
| 用 `.cmd` 包装器 | 双击 `install.cmd` | **最省事**，推荐 |
| 单次绕过 | `powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1` | 只对这一次生效，不改系统设置 |
| 改当前用户策略 | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` | 一次设置长期生效 |

> 本仓库**故意**不让你去改机器的全局策略 —— 那是你自己电脑的设置，
> 该不该改由你决定，不该由社团的脚本替你做主。

### 安装脚本做了三件事

1. 从官方 `web` 模板新建 profile `njau`（已存在就跳过）。
2. 把本仓库的插件包装进 `njau`。
3. 打印合成后的 profile 树，让你确认插件行确实在里面。

### 改了插件代码之后（重要）

`file:` 依赖是被**拷贝**进 profile 的，**不是软链**。所以**改完插件源码，
光重启是不生效的** —— `add` 和 `install --force` 都不会重新拷贝
（pnpm 只看 spec，不看文件内容）。必须**先移除再装**：

```powershell
dsh plugin --profile njau remove "@njau-ca/dsh-njau-deck"
dsh plugin --profile njau add "file:D:/.../njau-ca-dsh/packages/deck"
```

> 忘了这一步的症状：改了代码、重启了、行为却没变。
> 判断方法：比一下源码和
> `%USERPROFILE%\.dsh\profiles\njau\node_modules\@njau-ca\<包>\` 里同名文件的大小。

### 启动

```powershell
dsh njau --port 0 --no-open
```

`--port 0` 让系统随便挑一个空闲端口，`--no-open` 不自动开浏览器。
终端会打印形如 `dsh web: http://127.0.0.1:51905/?token=...` 的地址，点开就是协会版界面。

---

## 2. 怎么确认装对了

### 先跑自检（一条命令）

双击 `scripts\doctor.cmd`，或在 PowerShell 里：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\doctor.ps1
```

它检查七件事：仓库文件齐不齐、DSH 找不找得到、profile 在不在、
插件行有没有进合成树、数据目录在哪、浏览器面接线对不对、测试过不过。

**看到这一行才算好：**

```
 doctor: 28 ok, 0 warn, 0 fail
 Installation looks healthy.
```

只要 `fail` 不是 0，就先别往下走 —— 把 FAIL 那几行读一遍，
对照本节下面的排查顺序。

### 再看启动日志

启动日志里**必须**出现这三行（少了任何一行就是没装对）：

```
[njau-ca] core 已加载｜南农计协｜<学年>｜数据 <数据目录>｜工具 6 · 技能 1 · 命令 3 · 提示词段 1
[njau-ca] brand 已接管 Web 品牌：窗口标题 + 主题色（侧栏标识由浏览器侧占 slot 完成）
[njau-ca] deck 已加载｜模板 3 个｜大纲 <N> 个｜目录 <数据目录>\deck｜工具 5 · 技能 1
```

### 最后看界面

- 窗口标题是「南农计协 · DSH」
- 侧栏顶部是协会标识 + 「南农计协」，不是官方的鱼形图标
- 主色是协会蓝（`#0B5FFF`）

在对话里试一句：`/njau-doctor` —— 应当返回一份自检报告。

---

## 3. 数据放在哪

默认 `%USERPROFILE%\.dsh\njau-ca\`。

想换地方，二选一：

- 环境变量 `NJAU_CA_DATA=D:\njau-ca-data`
- 在 profile 的 `cordis.patch.yml` 里给 `njau-ca-core` 那行加
  `config: { dataDir: 'D:\njau-ca-data' }`

数据全是 Markdown / YAML / JSON 纯文本，**不是数据库**。
这样它能进 git、能 diff、能回滚、能被子孙后代读懂。

> **数据不在仓库里。** 仓库可以随便 clone、随便公开；
> 数据归协会所有，单独交接（见 [`../GOVERNANCE.md`](../GOVERNANCE.md) 第六节）。

---

## 4. 卸载

双击 `scripts\uninstall.cmd`，或：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

只摘掉插件，并把 profile 改名成 `njau.removed-<时间戳>` 留底，
**不删你的数据**。

想彻底清干净：确认数据已经另行备份之后，手动删掉那个改名后的 profile 目录
和数据目录。

---

## 5. 升级 DSH 之后

DSH 升级可能改掉内部接口。升级后请重跑第 2 节的 `doctor.cmd`。

已知最容易被升级打破的地方（按风险排序）：

1. **品牌 slot 名**。`sidebar.brand.mark` / `sidebar.brand.name` 若被改名，
   界面会**静默**退回官方鱼形图标 —— 不报错，只是品牌没了。
   这是最危险的一种：`doctor` 会检查，但只有你真的去看了才知道它检查得对不对。
2. **`webserver/index-inject` 的行格式**。若 `kind` 取值变了，标题和主题色会失效。
3. **工具 / 技能 / 命令的注册签名**。这会直接报错，反而好排查。

排查手段：

```powershell
dsh njau --dump-config > tree.txt     # 看插件行还在不在
```

浏览器里直接访问 `/plugins/??@njau-ca/dsh-njau-brand/client.js&rev=<rev>`，
返回 JS 说明浏览器面挂上了，返回 404 说明没挂上。

> `&rev=` 这一段**不能省**。省了必定 404 —— 这是设计如此，不是你装错了。
> 完整的 URL 从界面 HTML 里的模块线抄，别手打。

---

## 6. 从零重建一台机器

1. 装 DSH。
2. `git clone <本仓库>`。
3. 双击 `scripts\install.cmd`。
4. 把上一届的数据目录拷回来（`~/.dsh/njau-ca`）。

四步，不需要问任何人。**这就是"能传下去"的定义。**

---

## 7. 已验证的环境

本仓库的插件在下面这个环境里**实测跑通**（不是"应该能跑"）：

| 项 | 值 |
| --- | --- |
| DSH 版本 | `0.2.0-rc.2` |
| Node | `v24.21.0` |
| pnpm | `11.7.0` |
| profile | `njau`（从 `web` 模板生成） |
| 验证方式 | 真实安装 + 真实启动 + 抓取 HTTP 响应 |
| doctor 结果 | `28 ok, 0 warn, 0 fail` |

验证时观测到的证据：

- 启动日志出现 core 与 brand 两行加载信息。
- `GET /` 返回 200，HTML 里含注入的 `--njau-ca-brand-primary` 与标题脚本。
- index 的模块线里出现
  `{"id":"@njau-ca/dsh-njau-brand","url":"plugins/??@njau-ca/dsh-njau-brand/client.js&rev=...","inject":[...]}`。
- `GET /plugins/??@njau-ca/dsh-njau-brand/client.js&rev=...` 返回 200 且内容与仓库里的
  `packages/brand/lib/client.js` 一致。
- `tests/smoke-core.mjs` 退出码 0。
- `tests/smoke-deck.mjs` 退出码 0（5 个工具 + 1 个技能 + 3 个模板 + 大纲读写 +
  路径穿越防护 + 渲染简报，共 33 项检查）。
- `dsh njau --dump-config` 里三行插件行都在：
  `njau-ca-core` / `njau-ca-brand` / `njau-ca-deck`。
- 直接加载 profile 里**装好的**那份 `deck`，读回模板页数：
  `annual-review -> 10`、`event-proposal -> 9`、`recruit -> 10`。

### 还没验证的

诚实起见列在这里，**别当成已验证**：

- `priority: -1` 到底有没有在界面上真的盖住官方标识（服务端接线已证实，
  视觉效果**没人亲眼看过**）。
- `webserver/index-inject` 在别的 DSH 版本上是否稳定。
- 第三方 `webServer` 路由和 DSH 的 `api-request-trust` 边界怎么交互。

完整清单见 [`architecture.md`](architecture.md) 第 12 节。