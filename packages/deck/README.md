# 南农计协 · deck（演示文稿）

给 DSH 装上**计协自己的 PPT 知识**，目标是取代 WPS。

## 它解决什么问题

用 WPS 做 PPT 的问题是：**每年从零开始。**
纳新宣讲该讲哪几页、年审汇报必须带哪些数据、立项答辩怎么排 ——
这些知识在会长脑子里，换届就丢了。

`deck` 把它们变成**插件里的模板文件**：装到哪台机器上都有，
换届时随仓库传下去，谁都能改（改 Markdown 就行，不用写代码）。

## 它做什么、不做什么

| | |
| --- | --- |
| **做** | 计协标准演示模板、大纲存取、交给 office-pptx 的渲染简报 |
| **不做** | 自己生成 `.pptx` 文件、自己拼 PPTX 的 XML |

生成 `.pptx` 的活儿交给 DSH 自带的 **`office-pptx` 技能**（Python + python-pptx + LibreOffice）。
这是铁律 1 的体现：**插件之间不互相调用，由 agent 编排**。

## 内置模板

| id | 名称 | 用途 |
| --- | --- | --- |
| `recruit` | 纳新宣讲 | 招新季宣讲会，目标是当场有人报名 |
| `annual-review` | 年审汇报 | 学年社团年审，原则是"能对上账" |
| `event-proposal` | 活动立项答辩 | 活动申报审批，回答"安全吗/多少钱/谁负责" |

## 5 个工具

| 工具 | 作用 |
| --- | --- |
| `njau_deck_templates` | 列出所有模板 |
| `njau_deck_template` | 读某个模板全文 |
| `njau_deck_outline_write` | 存一份大纲到数据目录 |
| `njau_deck_outline_list` | 列出已存的大纲 |
| `njau_deck_brief` | 把大纲翻成渲染简报，交给 office-pptx |

## 1 个技能

`njau-deck` —— 三步流程（挑模板 → 写大纲 → 出文件）+ 常见事故 + 红线。

## 典型用法

```
你：帮我准备这学期的纳新宣讲 PPT
DSH：→ njau_deck_templates          （看有哪些模板）
     → njau_deck_template recruit   （读纳新宣讲该讲哪几页）
     → njau_data_read ...           （翻往届的活动照片和获奖记录）
     → njau_deck_outline_write      （按模板页序把内容填进去）
     → njau_deck_brief              （拿渲染简报）
     → office-pptx 技能             （生成真正的 .pptx）
```

## 数据放哪

```
~/.dsh/njau-ca/deck/
  └─ <slug>.json      演示大纲（纯文本，能进 git、能 diff、能传下去）
```

模板**不进数据目录** —— 模板是制度，随插件走；
大纲是今年的情况，放数据目录。

`dataDir` 和 `templatesDir` 都可以在 `cordis.patch.yml` 里覆盖。

## 装 / 卸

```powershell
.\scripts\install.cmd njau      # 装
.\scripts\uninstall.cmd njau    # 卸
```

## 怎么加一个新模板

在 `templates/` 里新建 `<id>.md`，写 frontmatter 和 `## N. 标题` 页序。
**不用写代码、不用改 JS。** 格式见 `templates/README.md`。

## 红线

- 学校系统（社团管理系统）的表单：**只准备文字，人登录、人提交**。
  `deck` 绝不代填、绝不自动提交。
- 年审/立项材料里的数字必须能对上原始记录。
- 不加入商业合作、赞助、收费内容（`GOVERNANCE.md` 第五节）。

## 边界

- 本包**零运行时依赖**，只用 `node:` 内置模块，不 import 任何 `@deepseek-ai/*`。
- 本包**不依赖 `core`**（铁律 1）。`core` 被摘掉，`deck` 照样能跑。
- 本包**没有浏览器侧**，纯宿主侧插件。

## 谁负责

见 `OWNER.md`。