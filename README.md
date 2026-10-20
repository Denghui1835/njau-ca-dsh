# 南农计协 · DSH

[![license: MIT](https://img.shields.io/badge/license-MIT-0B5FFF)](LICENSE)
[![node](https://img.shields.io/badge/node-22%20%7C%2024-3C873A)](.github/workflows/ci.yml)
[![runtime deps: 0](https://img.shields.io/badge/runtime%20deps-0-brightgreen)](docs/adr/0005-zero-runtime-dependencies.md)
[![for DSH](https://img.shields.io/badge/runs%20on-DeepSeek%20Harness-4D6BFE)](https://github.com/deepseek-ai)

> 南京农业大学计算机爱好者协会的**协会操作系统**。
> 不是官网，是一整套接手协会大小事务的工具，跑在 DeepSeek Harness 上。

---

## 这是什么

一句话：**把协会的活儿，做成一套能一代一代传下去的工具。**

DSH 的立场是「一切皆插件」。我们顺着这个立场，把协会的事务拆成一批插件：
纳新、活动、经费、宣传、周报、竞赛、知识库、年审材料、共享资源库、PPT……
每一块都是独立插件，装上去就能用，不想要就摘掉，互不牵连。

**它取代官网的位置。** 官网只能"看"，这套东西能"干活"。

### 现在长成了一间「工作坊」

三条产线收在同一个界面里，共用协会身份与数据目录：

| 产线 | 干什么 | 状态 |
| --- | --- | --- |
| **办公** | 表格、纪要、立项书、报销单、年审材料 —— **自带 OOXML 引擎，不装 WPS/Office 也能直接改 .docx** | ✅ 可用 |
| **漫剧** | 剧本 → 分镜 → 出图 → 配音字幕 → 合成 | 骨架已通，产线待建 |
| **开发** | 协会网站、工具、脚本 | 只有导航，产线待建 |

## 别的社团能用吗

能。这套东西里**没有一个字节依赖南农计协**：协会名、学年、业务域都从
数据目录里的 `identity.json` 和 `packages/workshop/lib/lines.js` 的产线表读出来。

复刻一份自己的：

1. fork 本仓库；
2. 改 `identity.json`（协会名、简称、motto、学年）—— 这个文件在数据目录，不在仓库里；
3. 改 `lib/lines.js` 的 `LINES`（你们的产线与业务域目录）；
4. 跑 `scripts/install.ps1`，装进你们自己的 profile。

三条架构铁律（插件互不调用 / 零运行时依赖 / 数据纯文本）是这套东西最值得抄的部分，
见 [`docs/architecture.md`](docs/architecture.md) 与 [`docs/adr/`](docs/adr/)。

## 为什么不做网站

网站是死的：做完就定型，改一次求一次人，换届就烂尾，还容易被当成"门面工程"。

而协会真正的痛点是**事务**：纳新的表格、活动的立项书、年审的材料、报销的单据。
这些活儿每年重复、每年靠人肉、每年换届就断档。

所以我们不做网站，做**一套能继承的工作台**。

## 现在有什么

| 包 | 作用 | 状态 |
| --- | --- | --- |
| [`packages/core`](packages/core) | 协会底座：数据目录、6 个工具、技能发现、斜杠命令、人设段 | 已验证 |
| [`packages/brand`](packages/brand) | 品牌与人设：侧栏标识、标题、主题色、协会人设 | 已验证 |
| [`packages/workshop`](packages/workshop) | **工作坊外壳**：三条产线（办公 / 漫剧 / 开发）的统一入口与现状总览 | 外壳已通（三柱待填） |
| [`packages/office`](packages/office) | **办公柱**：自带 OOXML 引擎，在 DSH 里直接打开、改、存 .docx，不依赖 WPS/Office | 已通（docx 读写 + 可视化编辑） |

工作坊的三条产线里，办公柱已经能干活；漫剧柱目前只有「起项目骨架」，
开发柱目前只做导航（文件树 / 终端用 DSH 自带的）。
路线与边界见 [`docs/workshop.md`](docs/workshop.md)。

## 快速开始

**双击 `scripts\install.cmd`** —— 装完再双击 `scripts\doctor.cmd` 确认没问题。

命令行等价写法：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\doctor.ps1
dsh njau --port 0 --no-open
```

装对了的话，`doctor` 最后一行是 `doctor: 28 ok, 0 warn, 0 fail`。

> 直接跑 `.ps1` 可能被 Windows 执行策略拦住，这不是仓库的毛病。
> 三种解法见 [`docs/install.md`](docs/install.md) 第 1 节。

详见 [`docs/install.md`](docs/install.md)。

## 接班的人从这里开始

1. 读 [`HANDOVER.md`](HANDOVER.md) —— 交接清单，照着打勾。
2. 读 [`docs/vision.md`](docs/vision.md) —— 为什么这么做、要往哪走。
3. 读 [`docs/architecture.md`](docs/architecture.md) —— 三条架构铁律。
4. 每个包里的 `OWNER.md` —— 那个包谁负责、交接要交代什么。
5. 想动手改？先读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 三条铁律

这三条是这个仓库能活过换届的原因，改代码前先读 [`docs/architecture.md`](docs/architecture.md)。

1. **插件之间不互相调用。** 跨域协作由**人（和 agent）**编排多个插件的工具完成，
   而不是插件 A 依赖插件 B。所以任何一个插件都能被单独删掉。
2. **零运行时依赖。** 只用 Node 内置模块，不 import 任何 `@deepseek-ai/*` 运行时包。
   DSH 升级不会因为版本声明不匹配而把我们拒载。
3. **数据是纯文本。** Markdown / YAML / JSON，永不引入数据库。
   这样能进 git、能 diff、能回滚、能被子孙读懂。

## 红线

学生社团不是公司。这个仓库里**不允许**出现：

- 商业合同、收款、开票、代理销售相关的内容；
- 冒充学校官方、或让外界误认为是学校官方的表述；
- 学校系统的自动登录、刷接口、模拟点击（**绝不**）；
- 内部敏感材料（整改、关联方、举报、内部汇报）。

排版、宣传材料、对外文案一律遵守学校对社团的现行规定。
完整红线表见 [`GOVERNANCE.md`](GOVERNANCE.md) 第五节。

## 目录

```
packages/     各插件，一个域一个包
  core/         协会底座：数据目录、工具、技能、斜杠命令、人设段
  brand/        品牌：侧栏标识、窗口标题、主题色
  deck/         PPT 大纲与模板
  workshop/     ★ 工作坊外壳：三条产线的统一入口与现状总览
  office/       ★ 办公柱：自带 OOXML 引擎，直接读写 .docx
docs/         愿景、架构、安装、工作坊、ADR、年度归档
  workshop.md   工作坊的分层、边界与三柱路线
  adr/          架构决策记录（为什么是现在这样）
  archive/      每学年一份只读快照
scripts/      安装 / 卸载 / 体检 / 自检（.ps1 本体 + .cmd 双击包装）
tests/        冒烟测试，改完代码跑一遍
```

仓库**只有代码和文档**。协会的业务数据在
`%USERPROFILE%\.dsh\njau-ca\`，不进 git。

## 本地自检（不需要装 DSH）

```bash
node scripts/check.mjs          # 包结构与语法
node tests/smoke-core.mjs       # 底座：工具 / 命令 / 技能契约
node tests/smoke-deck.mjs       # PPT：模板解析 / 大纲写入 / 路径穿越防护
node tests/smoke-workshop.mjs   # 工作坊 + 办公柱：真 HTTP + 真 .docx 往返
```

这些测试**不依赖 DSH、不依赖 pnpm、不联网**：假 ctx 把插件真跑起来，
再把注册到的 HTTP 路由挂到真 http 服务上，用 fetch 走一遍面板会走的请求。
文档引擎还会真的落一份 .docx 到临时目录、读回来逐字比对。

## 许可

MIT。见 [`LICENSE`](LICENSE)。

代码开放，**数据不开放** —— 数据归协会所有，单独交接。

欢迎 fork、抄架构、抄那三条铁律。如果这套东西对你们社团有用，开个 issue 说一声就行。