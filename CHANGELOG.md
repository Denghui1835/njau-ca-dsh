# 改动记录

> 每届交接时在这里追加。这是「一代一代传下去」的**证据链**。
> 格式：`## <学年> —— <一句话概括>`，下面列具体改动。

---

## 2026–2027 学年（第一届）

### 立项与方向

- 最初的念头是"给计协做个官网"，反复讨论后**否掉**。
  理由：网站做完就定型、只能看不能干活、换届即烂尾、容易变成门面工程。
- 确定新方向：不是做网站，而是基于 DSH 做**协会操作系统** ——
  一切皆插件，一套系统处理协会大小事务，并**取代官网的位置**。
- 明确验收标准（负责人原话）：
  > 「下一届的人能不能在**不问你任何问题**的情况下，把一次纳新完整跑一遍。」

### 新增 `packages/core`

协会底座。数据目录、6 个工具、技能发现、3 个斜杠命令、1 段系统提示词。

- **6 个工具**：`njau_overview`、`njau_data_list`、`njau_data_read`、
  `njau_data_write`、`njau_data_append`、`njau_doctor`。
- **3 个命令**：`/njau`、`/njau-doctor`、`/njau-domains`。
- **技能**：`njau-handbook`（协会章程，讲清楚每个域干什么）。
- **数据根**：默认 `~/.dsh/njau-ca`，可被 `dataDir` 配置或 `NJAU_CA_DATA` 覆盖。
- 11 个业务域定义（org / recruit / events / finance / media / report /
  learning / kb / site / school / compliance）。

### 新增 `packages/brand`

品牌与人设。**双面包**（宿主侧 + 浏览器侧）。

- 宿主侧：协会人设段；注入窗口标题与主题色 CSS。
- 浏览器侧：占 `sidebar.brand.mark` / `sidebar.brand.name` 两个 slot。
- 主色 `#0B5FFF` / 深色 `#4D93F8`，覆盖令牌 `--dsw-alias-brand-primary`。

### 新增 `packages/deck`（替代 WPS）

演示文稿插件，**纯宿主侧**，离开 `core` 也能跑（铁律 1）。

- **3 个内置模板**：`recruit`（纳新宣讲，10 页）、`annual-review`（年审汇报，10 页）、
  `event-proposal`（活动立项答辩，9 页）。
- **5 个工具**：`njau_deck_templates`、`njau_deck_template`、
  `njau_deck_outline_write`、`njau_deck_outline_list`、`njau_deck_brief`。
- **1 个技能**：`njau-deck`（三步流程 + 常见事故 + 红线）。
- **数据**：`~/.dsh/njau-ca/deck/<slug>.json`，纯文本，可 diff、可进 git。

**关键分工 —— `deck` 不生成 `.pptx`。**

生成 PPTX 需要 Python + python-pptx + LibreOffice，那是 DSH 自带
`office-pptx` 技能的活儿。`deck` 只负责"计协该讲什么"，
产出一份「渲染简报」交给 agent 编排。不自己拼 PPTX 的 XML。

**模板与大纲的分界**：模板是**制度**（随插件走，装到哪台机器上都有）；
大纲是**今年的情况**（放数据目录，不进 git）。
模板用 Markdown 写，**加一个新模板不用写代码**。

### 技术发现（本项目的核心知识）

这几条是逆向 DSH 源码得出的，**没有官方文档**，是本仓库最值钱的部分：

1. **DSH 没有品牌配置面。** 品牌 = 占 slot。官方鱼形图标是
   `dsh-client-ui-brand-official` 占 slot 占出来的。要品牌化就得以
   `priority: -1` 占同一个 slot（`entriesOfSlot` 按 priority 升序取第一个）。
2. **浏览器插件是模块工厂格式**：`window.__ModuleLoader__.load({ id, factory })`，
   `factory(require)` **直接 return** 导出对象。
3. **双面包必须同时声明** `exports["./client"]` 与 `dsh.client.platform`，
   否则浏览器侧**静默**不加载。
4. **一个 profile 里的 `@deepseek-ai/*` 包是 junction**，指向
   `resources\dsh\node_modules\@deepseek-ai\*`，**不是从 npm 装的**。
   所以新 profile 必须由启动器自己创建，不能手工拷目录。
5. **`dsh --dump-config` 会合成 profile 树然后直接退出，不启动服务** ——
   这是安全的验证手段，可以在另一个 DSH 开着的时候跑。
6. **命令名不能含中文**（正则 `/^[a-z][a-z0-9_-]*$/u`），所以命令一律叫 `njau-*`。
7. **`@deepseek-ai/dsh-persona` 不能全局挂载**（第二次注册 `deployment:persona-*`
   段名会抛错），所以人设要自己起一个唯一段名。
8. **第三方插件的 `ctx.tools.register` 契约**（源码 `core/lib/tools.js` 抄出来的，
   不是猜的）：`parameters` **必须是规范 JSON Schema**，必填写在**对象级**
   `required: ["x"]`；属性级 `required: true` 不合法。
   `output.render(args, value)` 返回 `[{type:'text', text}]`。
   `execute` 抛异常会被转成 Error 结果，**不会**中断整轮对话。
9. **技能注册**：`ctx.skills.register({...})` 返回 disposer，要交给
   `ctx.effect(() => disposer, label)`；`SKILL.md` 的 frontmatter
   **只解析 `name:` 和 `description:`** 两个键（故意不引 YAML 依赖）。
   `name` 必须匹配 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`。
10. **不声明 `@deepseek-ai/*` peerDependencies 反而最安全**：
    运行时的兼容性检查**只查已声明的 peer**，不声明就不查。
11. **`file:` 依赖是被拷进 profile 的，不是软链。** 所以改完插件源码，
    重启**不生效**；`add` 和 `install --force` 也都不会重新拷贝
    （pnpm 只看 spec、不看文件内容）。**必须 `remove` 再 `add`。**
    这条坑过一次：改了 `deck.js` 的正则、重启、行为却没变。
    判断方法：比一下源码和
    `%USERPROFILE%\.dsh\profiles\njau\node_modules\@njau-ca\<包>\` 里同名文件的大小。

### 架构决定

确立**三条铁律**（详见 `docs/architecture.md`）：

1. 插件之间**不互相调用**，`core` 不提供任何 Cordis 服务；
   跨域协作由**人（和 agent）编排多个插件的工具**完成。
2. **零运行时依赖**：只用 Node 内置模块，不 import 任何 `@deepseek-ai/*` 运行时包。
3. **数据是纯文本**：Markdown / YAML / JSON，**永不引入数据库**。

补充决定：

- 不导出 schemastery `Config`（cordis 原样传 YAML `config`，默认值与校验都放 `createEnv()`）。
- **不 fork DSH 界面**。官网位置用 `{kind:'exact', path:'/'}` 影子路由 + 占品牌 slot 实现。
- profile 用**独立的 `njau`**，不动用户自己的 `desktop`。
- 铁律 1 的直接代价：`deck` **自己复制了一份** `env` / `skills` 辅助代码，
  而不是 import `core` 的。这是刻意的 —— 换来的是每个包都能单独摘掉。

### 实测验证（不是"应该能跑"）

环境：DSH `0.2.0-rc.2`、Node `v24.21.0`、pnpm `11.7.0`、profile `njau`。

**真实安装 → 真实启动 → 抓取 HTTP 响应**，观测到：

- 启动日志：
  `[njau-ca] core 已加载｜南农计协｜2026-2027｜数据 %USERPROFILE%\.dsh\njau-ca｜工具 6 · 技能 1 · 命令 3 · 提示词段 1`
- 启动日志：`[njau-ca] brand 已接管 Web 品牌：窗口标题 + 主题色（侧栏标识由浏览器侧占 slot 完成）`
- 启动日志：`[njau-ca] deck 已加载｜模板 3 个｜大纲 0 个｜目录 %USERPROFILE%\.dsh\njau-ca\deck｜工具 5 · 技能 1`
- `dsh njau --dump-config` 确认三个插件行都在合成树里：
  `njau-ca-core` / `njau-ca-brand` / `njau-ca-deck`。
- `GET /` 返回 200，HTML 内含注入的 `--njau-ca-brand-primary: #0B5FFF`、暗色变体、标题脚本。
- 模块线中出现
  `{"id":"@njau-ca/dsh-njau-brand","url":"plugins/??@njau-ca/dsh-njau-brand/client.js&rev=...","rev":"...","inject":["@deepseek-ai/dsh-client-ui-renderer","@deepseek-ai/dsh-client-ui-sidebar","@deepseek-ai/dsh-client-ui-theme"]}`。
- `GET /plugins/??@njau-ca/dsh-njau-brand/client.js&rev=...` 返回 **200**，
  内容与仓库里的 `lib/client.js` 一致（含两个 slot 注册、`priority: -1`、品牌令牌、中文正常）。
  > 注意：`&rev=` 的值**必须从 index HTML 里抓**，它不是源码的 sha1；
  > 漏掉 `&rev=` 会直接 404。
- `tests/smoke-core.mjs` 通过（假 ctx 跑真实工具 + 全部命令处理器）。
- `tests/smoke-deck.mjs` 通过，退出码 0，共 33 项检查（5 个工具契约 / 1 个技能 /
  3 个模板 / 大纲写入与读回 / 路径穿越防护 / 渲染简报 / 错误码）。
- 直接加载 **profile 里装好的那份** `deck`，读回页数：
  `annual-review -> 10`、`event-proposal -> 9`、`recruit -> 10`。

### 冒烟测试抓到的一个真 bug（值得记下来）

`deck` 的模板解析原本用 `### N. 标题` 当页标题，但模板文件里写的是 `## N. 标题`
（`#` 是文档标题，`##` 才是页）。结果 **`slideCount` 一直是 0、页序完全读不出来**，
而插件启动日志照样打印「模板 3 个」—— **表面上一切正常**。

被发现，是因为冒烟测试断言了 `slideCount === 10`，而不是只断言「加载成功」。

修正：正则放宽成 `/^#{2,3}\s+/`，两种写法都认；并把
`packages/deck/templates/README.md` 里那句**把 bug 当成规范写进去**的
「`###` 不行」一并改掉。

> 教训：**只断言"没报错"的测试等于没测。** 要断言具体的值。

### 文档与交接

- `README.md`（总入口）、`HANDOVER.md`（换届清单）、`docs/vision.md`（愿景与路线图）、
  `docs/architecture.md`（架构与铁律）、`docs/install.md`（安装与验证）。
- `docs/collaboration.md`（多人协作工作区的三种走法 —— 共享数据目录 / Git 工作区 / 协作中枢插件）。
- `GOVERNANCE.md`（含红线表）、`CONTRIBUTING.md`、`docs/adr/`（架构决定记录）、
  `docs/archive/`（年度归档规范）。
- `scripts/install.ps1` / `uninstall.ps1` / `doctor.ps1`，外层各套一个 `.cmd` 包装。
  > 脚本**刻意只用 ASCII**：Windows PowerShell 5.1 会把无 BOM 的 UTF-8 中文 .ps1
  > 读成乱码，在新机器上直接语法错误。中文一律放 `.md`。
  > 外层 `.cmd` 用 `powershell -NoProfile -ExecutionPolicy Bypass -File` 调它，
  > 绕开默认执行策略（否则会报「未对文件进行数字签名」）。
- 每个包配 `README.md` + `OWNER.md`；`doctor` **强制检查**这两个文件存在。

### 当时还没做（后续届继续）

按 `docs/vision.md` 的路线图：`workflow`（防跑飞）、`compliance`（红线内建）、
`recruit`（验收闭环）、`school`（年审材料 + 表单填充，**最高价值**）、
`events` / `finance` / `media` / `report`、`library`（共享资源库）、
`growth`（创业/就业/科研/升学/学习）、`kb`、`site`、
`hub`（多人协作工作区，方案见 `docs/collaboration.md`）。

> `deck`（替代 WPS）原本也在这个清单里，**已在本届完成**，见上文。

### 已知问题

- 在这台 Windows 机器上，**写文件会间歇性失败**（同一命令有时成功、有时整个不执行，
  且失败的调用连输出都没有）。已排除权限因素：`tests/` 与能正常写入的目录
  **ACL 完全相同**，写入窗口是**全局按时间开合**的，与路径、工具、
  文件大小都无关。对策：**重试**，并且每次写完都用独立的一次往返去**验证文件真的在磁盘上**。
  > 教训：不要相信"写入成功"的返回值，包括本文档提到的 `edit` 工具
  > 会**假报成功**。一律复查。

---

### 新增 `packages/workshop` + `packages/office`（工作坊外壳与办公柱）

方向调整：从「一组域插件」升级成「一间工作坊」。三条产线 —— 办公、漫剧、开发 ——
收进同一个面板，共用协会身份与数据目录。

- **`packages/workshop`（外壳）**：右侧栏「工作坊」面板（首页 / 办公 / 漫剧 / 开发），
  会话头部一个入口按钮，`/njau/api/workshop/*` 接口，2 个工具
  （`njau_workshop_state`、`njau_workshop_new_manju`），1 段系统提示词。
  产线定义集中在 `lib/lines.js` 的 `LINES`，加产线只改这一处。
- **`packages/office`（办公柱）**：**自带 OOXML 引擎，不依赖 WPS / Office**。
  - 零运行时依赖的 ZIP 读写（`node:zlib` + 自写 CRC32）与极简 XML 树。
  - `.docx` 读写：段落 / 文字片段格式 / 表格 / 标题层级 / 页面设置。
  - 没建模的排版用 `rawPPr` / `rPr` 原文带回，**改一个字不会清空缩进、编号、行距**。
  - 浏览器侧直接在字上改（contenteditable），保存回真正的 .docx。
  - 5 个工具（`njau_office_list/read/edit/create/status`）+ `/njau/api/office/*` 接口。
  - 并发保护：`baseHash` 不匹配即 409 `doc/conflict`，不静默覆盖。

#### 架构决定

- **外壳不许长胖**：只做「看现状 + 导航」，不出图、不配音、不剪片、不编译。
- **跨插件只走导航**：外壳开办公面板用 `openTab('njau-office')` 与
  `window.__NJAU_OPEN_OFFICE__(path)`，不 import 办公柱的服务。
- **每个插件自带一份 env**：`office/lib/env.js`、`workshop/lib/env.js` 各自十几行，
  读同一个 `identity.json` —— 事实一份，代码解耦（铁律 1 的又一次代价）。

#### 实测验证

- `tests/smoke-workshop.mjs` **70+ 项全绿**：假 ctx 跑真插件 → 挂真 HTTP 服务 →
  真落 .docx → 再读回；含 409 冲突、路径穿越清洗、错误码、ZIP 头校验。
- **真实文档往返**：`学习通_学生帮助文档.docx` 读到 353 段 / 12 表格 / 标题 1-4 层级，
  写回再读**文字零丢失**。
- **独立解析器交叉验证**：python-docx（完全不同的实现）能打开我们写出的文件，
  正确识别 `Title` / `Heading 2` / `Normal` 与表格单元格 —— 产出是标准 OOXML，不是自说自话。
- 真 DSH 里加载：`[njau-workshop] 已加载 … 工具 2`、`[njau-office] 已加载 … 工具 5`；
  `GET /njau/api/workshop/state` 返回三条产线 + 身份卡；
  客户端 bundle 随启动载荷下发并含我们的 slot 注册。

#### 还没做

- 漫剧柱：出图队列、配音字幕、时间轴合成（前两步已完成，见下）。
- 开发柱：代码编辑器面板、项目脚手架、发布流程。
- 办公柱：xlsx / pptx。

### 新增 `packages/manju`（漫剧柱）

漫剧产线的前两个工序落地：**写剧本、拆分镜**。

- **一个文件当中枢**：`<项目>/storyboard.json` 的 `panels[]` 挂着每一格的
  画面描述、台词、时长、素材路径、状态。出图 / 配音 / 合成将来各自是独立插件，
  只读写这一个文件与 `assets/` —— 谁坏了都不影响前面的工序。
- **`normalize()` 是兼容层**：手写过的、老版本的、agent 写坏的 JSON 都能救回来
  （补 id、补镜号、消重、坏时长兜默认值），**只做加法，几乎不丢东西**。
- **`renumber()` 保证镜号等于位置**：增删改排序之后镜号自动重排；
  `panel.id` 则永不改变 —— agent 靠 id 定位，镜号会随排序变。
- 面板：剧本视图（textarea）+ 分镜视图（卡片式，每格可改描述/台词/时长/状态，
  缺什么直接标出来）。**没出图就明确写「未出图」，不假装有图。**
- 6 个工具（`njau_manju_list/read/edit/script_write/new/status`）+
  `/njau/api/manju/*` 接口；`board` 与 `script` 两个保存接口都带 `baseHash` 并发保护。
- 素材直出：`GET /njau/api/manju/asset` 返回图片字节（面板要能看见图），
  路径锁在项目目录内，`..` 越界与非法扩展名分别 400 / 415。

#### 实测验证

- `tests/smoke-manju.mjs` 全部通过：插件契约 → 项目生命周期 → 分镜增删改排序
  （含「删中间一格后新格不撞号」）→ 坏 JSON 与脏数据修复 → 素材字节一致 →
  越界防护 → 真 HTTP。
- 与工作坊外壳的联动：外壳「漫剧」视图按项目调
  `window.__NJAU_OPEN_MANJU__(name)` 打开面板并带上项目名。

#### 架构决定

- **漫剧柱只做前两步**。在这个包里加生成逻辑 = 把产线焊死，下次换模型就得推倒重来。
- **项目骨架模板有两份**（外壳的 `njau_workshop_new_manju` 与漫剧柱的 `njau_manju_new`），
  这是刻意的：外壳在漫剧柱没装时也要能起项目。两份都写同一个格式标记，
  差异由 `normalize()` 抹平 —— 兼容层才是它们不出分歧的原因。

### 新增 `packages/code`（开发柱）

三条产线的最后一根：**项目发现 + 文件树 + 代码编辑器 + 白名单运行**。

- **不是 IDE**：终端与工作区文件树用 DSH 自带的，这里只补「看项目、改文件、跑构建」。
- **编辑器自带**：没有 Monaco/CodeMirror —— 零运行时依赖是铁律，也没有 CDN。
  实现是「行号栏 + `<pre>` 高亮层 + 透明文字的 `<textarea>`」两层重叠、滚动同步；
  高亮是自己写的四类分词（注释 / 字符串 / 关键字 / 数字），覆盖 js/ts/py/json/yaml/css/shell。
- **白名单运行**（这条是安全设计，别放宽）：
  只跑项目 `package.json` 里**声明过**的 scripts，以及 `git status/log/diff --stat` 三个只读命令。
  任意 shell 一律拒绝 —— 面板不是终端，一个按钮能跑任意命令就等于后门。
  超时 60 秒整棵进程树被杀，输出截断 200KB。
- 文件读写：1MB 上限、二进制（含 `\0`）拒绝、`baseHash` 并发保护（`file/conflict`）。
- 路径边界：项目必须在 `site/` 或 `learning/` 之下，文件必须在项目目录内，`..` 一律拒。
- 6 个工具 + `/njau/api/code/*`；面板点保存/跑脚本与模型调工具共用同一个 `service.js`。

#### 实测验证

- `tests/smoke-code.mjs` 全绿：契约 → 项目发现（含无 package.json 的静态页项目）
  → 文件树跳过 `node_modules` → 读写/冲突/越界/二进制 → **真跑一次 `npm run build` 并捕获输出**
  → `rm -rf /` 被拒 → 非 git 项目跑 git 被拒 → 只读 git 在真仓库上跑通 → 真 HTTP。
- `scripts/verify-live.mjs` 扩到三柱：对运行中的实例建临时开发项目
  → 被发现 → 文件树 → 读 → 写 → 跑 script → 越界被拒 → **最后自动删掉临时项目**。
- **自己抓到并修掉的一个真 bug**：高亮类名写成 `nc-t-*`，CSS 里是 `nk-t-*`。
  语法检查、接口测试、端到端全过，只有颜色不生效 —— 靠比对下发 bundle 里的字符串才发现。
  教训写进了 `packages/code/OWNER.md`。

### 办公柱新增 `.xlsx`（表格读写 + 网格编辑器）

协会最高频的表格活儿（报名表、报销单、年审台账）现在也能在面板里直接改。

- **引擎**：`xlsx-read.js` / `xlsx-write.js`，与 docx 共用 `zip.js` + `xml.js`。
  读：workbook → 各 sheet → 单元格（共享字符串 / 内联字符串 / 数字 / 布尔 / 公式 / 样式下标）；
  写：只替换各个 `xl/worksheets/sheetN.xml`，其余部件原样搬。
- **保真**：列宽（`rawCols`）、冻结窗格（`rawSheetViews`）、合并单元格（`merges`）、
  单元格样式下标（`s`）都原样带回 —— 只改一个格子不会把别人的格式清掉。
- **面板**：同一个「办公」面板按扩展名分流 —— `.docx` 进纸页编辑器，`.xlsx` 进网格编辑器
  （工作表切换、加删行列、更多行/列分页，避免 200×200 的表一次性渲染成 4 万个输入框）。
- **agent**：`njau_office_sheet_read` / `njau_office_sheet_edit` / `njau_office_sheet_create`，
  操作 `set_cell` / `clear_cell` / `insert_row` / `delete_row` / `set_row` / `set_sheet_name`，
  单元格用 A1 记法定位，公式直接给 `formula`。
- 并发保护与其他文件一致：`baseHash` 不匹配即 409（`sheet/conflict`）。

#### 实测验证

- **真实文件往返**（工作区里的三份真表格）：
  `计协招新汇总表.xlsx`（1 表）、`计协招新_需求与意向汇总.xlsx`（5 表）、
  `志愿者案例采集模板_v1.xlsx`（9 表 × 206 行）——读一遍、写一遍、再读一遍，
  **逐格比对内容完全一致**（含公式文本），表数与尺寸不变。
- `tests/smoke-sheet.mjs` 全绿：新建 → 6 个操作（含 `set_row`、`set_cell`、公式、改名）
  → 落盘回读 → 409 冲突 → 非法 ref → 不存在的表 → 文本视图 → 整表保存 → scan 带 `kind`。
- `scripts/verify-live.mjs` 加了一段表格端到端：对运行中的实例建临时 .xlsx
  → 读回 → 整表保存 → 单元格落盘校验 → **自动删掉临时文件**。

#### 已知边界（写进 README 与 OWNER）

- 上限 5000 行 × 64 列（读时截断并标 `truncated`）；
- 手改一格会覆盖该格原有公式（公式原文仍在 tooltip）；
- 不能新增工作表（能改名）；加表要同步改 workbook.xml / rels / content types，漏一处就「文件损坏」。

### 办公柱补齐 `.pptx`（幻灯片读写 + 文字编辑）

办公柱按目标收口成 **docx / xlsx / pptx 三件套**。

- **引擎**：`pptx-read.js` / `pptx-write.js`，与前两者共用 `zip.js` + `xml.js`。
  读：presentation.xml → 各 slide → 形状树里的文字形状 → 段落（含 `a:pPr lvl` 缩进层级）；
  写：每张幻灯片**整棵形状树重新序列化** —— 图片、表格、图表、SmartArt 都还在；
  文字只重建模型里管的形状的 `a:p`，模板取自该形状原来的第一个 `a:p` / `a:r`，
  所以字号、颜色、对齐不会因为改了一行字而丢。
- **面板**：同一个「办公」面板按扩展名分流到三种编辑器 —— 纸页（docx）/ 网格（xlsx）/
  幻灯片（页列表 + 标题 + 要点，带缩进层级、加减要点、上下页）。
- **agent**：`njau_office_deck_read` / `deck_edit` / `deck_create`，操作
  `set_title` / `set_text` / `add_paragraph` / `delete_paragraph` / `set_level`，
  按「页下标 + 形状序号 + 段落下标」定位。办公柱工具数 8 → **11**。
- 并发保护与其他一致：`baseHash` 不匹配即 409（`deck/conflict`）。

#### 实测验证

- **独立解析器交叉验证**：新建 → 改标题与要点 → 写回，用 **python-pptx** 打开两份产物，
  都能正确读出页数与 `12192000×6858000 EMU` 画布，改后的文字也确实在里面。
- `tests/smoke-pptx.mjs` 全绿：新建 → 读（页/形状/段落/部件路径）→ 5 个操作 → 落盘回读
  → 删段落 → 409 冲突 → 页/形状下标越界 → 扩展名防呆 → scan 带 `kind`。
- `scripts/verify-live.mjs` 加幻灯片端到端：建临时 .pptx → 读回 → 整稿保存 → 标题落盘 → 自动清理。

#### 踩到并修掉的一个真 bug

`<p:sldId id="256" r:id="rId2"/>` 里 **`id` 是页标识、`r:id` 才是关系引用**。
第一版取了 `id`，结果新建的演示文稿「0 页」——但没有任何报错。
`.xlsx` 的 `<sheet name=… sheetId=… r:id=…/>` 有同一个坑，一并改成优先取 `r:id`。
教训写进了 `packages/office/OWNER.md`。

### 开源

- 仓库以 **MIT** 公开：https://github.com/Denghui1835/njau-ca-dsh
  （首个 tag `v0.1.0`，对应「工作坊外壳 + 办公柱」这一版。）
- 开源前做的三件事，都不是形式主义：
  1. **按仓库自己的规矩清掉个人信息** —— `HANDOVER.md` 早就写了「联系方式别写进公开仓库」，
     所以 `packages/brand/OWNER.md` 的姓名列改成「校内渠道」，改用 GitHub noreply 邮箱提交。
  2. **去掉写死的本机路径** —— `tests/smoke-*.mjs` 的仓库根目录改成从 `import.meta.url` 推导，
     谁 clone 下来都能直接跑。
  3. **让许可证可被机器识别** —— MIT 正文后面原本追加了中文说明，GitHub 的 licensee
     因此把它识别成 "Other"；说明挪到 `NOTICE.md` 后正确识别为 MIT。
- 新增 `scripts/check.mjs`（不装 DSH 也能跑的结构与语法自检）与
  `.github/workflows/ci.yml`（ubuntu + windows × node 22/24 跑三套冒烟测试）。

---

<!-- 下一届从这里开始追加：

## 2027–2028 学年 —— <一句话概括>

### 新增
### 修改
### 技术发现
### 架构决定
### 实测验证
### 还没做

-->