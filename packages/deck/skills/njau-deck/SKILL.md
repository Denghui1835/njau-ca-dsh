---
name: njau-deck
description: 做南农计协的演示文稿（PPT）时用。包含计协标准演示模板（纳新宣讲、年审汇报、活动立项答辩）的使用方法、大纲写法，以及如何把大纲交给 office-pptx 生成真正的 .pptx 文件。当任务是"做 PPT""改 PPT""准备宣讲""准备年审材料""做答辩"时使用。
---

# 南农计协 · 演示文稿

## 你要做的事

计协的 PPT 不是"随便做个好看的"，而是**有固定业务结构**的：
纳新宣讲要让人想报名，年审汇报要能对上账，立项答辩要能过审批。

流程永远是三步，**不要跳步**：

1. **挑模板** → `njau_deck_templates` 看有哪些，`njau_deck_template` 读全文
2. **写大纲** → 按模板页序填内容，`njau_deck_outline_write` 存下来
3. **出文件** → `njau_deck_brief` 拿渲染简报，再用 `office-pptx` 技能生成 .pptx

**永远先挑模板。** 不要凭自己的想法发明结构 —— 结构是这个插件存在的理由。
模板里「页面元素 / 怎么讲 / 素材来源」三项都要认真读，
「素材来源」告诉你该去协会数据目录里找什么。

## 第 1 步：挑模板

```
njau_deck_templates          → 列出所有模板（id / 名称 / 用途 / 页序）
njau_deck_template {id}      → 读某个模板全文
```

| id | 什么时候用 |
| --- | --- |
| `recruit` | 招新季宣讲会 |
| `annual-review` | 学年社团年审汇报 |
| `event-proposal` | 活动申报、立项答辩 |

都不合适时，可以在 `packages/deck/templates/` 里加一个新的 ——
写 Markdown 就行，不用写代码。

## 第 2 步：写大纲

大纲是一个 JSON 数组：

```json
[
  { "title": "封面", "bullets": ["南农计协 2026 秋季招新"], "notes": "开场问：在座有多少人装过 Python？" },
  { "title": "我们是谁", "bullets": ["成立于 …"], "notes": "别念章程" }
]
```

用 `njau_deck_outline_write` 存（slides 传上面那个数组的字符串）。

**写内容时的规矩：**

- **不要编数据。** 获奖、人数、金额必须来自协会数据目录里的真实记录。
  没记录的地方写占位符 `【待补：xxx】` 让人去填，**不要自己填一个像真的数**。
- **每页 bullets 控制在 3-5 条。** PPT 是提纲，不是文档。
- **讲者备注写"怎么讲"**，不是重复 bullets。
- 需要翻数据时先用 `njau_data_list` / `njau_data_read`；
  `core` 不在就直接读 `~/.dsh/njau-ca/`。

## 第 3 步：出文件

```
njau_deck_brief { slug }     → 拿到「渲染简报」
```

简报每页有 `layout` / `title` / `bullets` / `notes`。
**然后调用 `office-pptx` 技能**生成 .pptx。

分工：**deck 负责"计协要讲什么"，office-pptx 负责"怎么变成 pptx 文件"。**
不要自己拼 PPTX 的 XML。

## 改已有的 PPT

1. 用 `office-pptx` 把文字读出来
2. 整理成大纲 JSON 存下来
3. 改大纲，再重新 `njau_deck_brief` + 生成

绕这一圈的理由：直接改 pptx，改完就丢了 —— 明年没人知道那页为什么这么写。
存成大纲之后，改动是文本、能 diff、能传给下一届。

## 常见事故

| 现象 | 原因 |
| --- | --- |
| 模板列表是空的 | `templates/` 丢了，或 `templatesDir` 配错 |
| 找不到大纲 | slug 写错，先 `njau_deck_outline_list` |
| 换电脑字体就乱 | 用了非常见字体，改用微软雅黑 / 思源黑体 |
| 二维码扫不出来 | 用的是往届旧图 —— **每年必须换新的** |

## 红线

- 年审、立项材料里的数字**必须能对上原始记录**，对不上就不要写。
- 不加入商业合作、赞助、收费内容（`GOVERNANCE.md` 第五节）。
- 学校系统的表单填报 —— **只准备文字，由人登录、人提交**。绝不代填、绝不自动提交。