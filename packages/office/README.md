# office / 办公柱

一句话：**不装 WPS、不装 Office，直接在 DSH 里打开 .docx、在字上改、存回真正的 .docx。**

## 为什么自己做文档引擎

协会的日常产出全是 Word：报名表、会议纪要、立项书、报销单、年审材料。
调 WPS 要装软件、要弹窗、要处理 COM，换台电脑就废；而 .docx 本质是「ZIP + 一堆 XML」。
自己拆包能保证三件事：**离线可用、换机器能用、改完还是 Word 能正常打开的文件。**

## 引擎边界（很重要，别高估它）

| 能读到 / 能写 | 不建模（但原样留在包里） |
| --- | --- |
| 段落 + 段落语义类型（标题 1-6 / 正文 / 引用 / 列表） | 图片、形状、图表 |
| 文字片段的格式（粗体 / 斜体 / 下划线 / 删除线 / 字号 / 颜色 / 字体） | 脚注、尾注、批注、修订痕迹 |
| 表格（行 / 列 / 合并列、单元格文字） | 域代码、目录（TOC）、页码域 |
| 页面尺寸与页边距（原样带回） | 页眉页脚（原样带回但不显示） |

**保真的关键设计**：每段、每个文字片段都带着读取时抓下来的 `w:pPr` / `w:RPr` 原文。
写回时以它为底、只覆盖模型里明确给出的字段。所以「只改了一个字」不会顺手把
缩进、行距、编号、项目符号清空。

## 一次保存发生了什么

```
面板改字 → contenteditable DOM → runsFromDom() 还原成 runs
        → POST /njau/api/office/doc {path, model, baseHash}
        → service.save() → writeDocx() → 原包里只替换 word/document.xml
        → 原子写（临时文件 + rename）
```

`baseHash` 是并发保护：你打开时的文件被改过（比如 agent 刚写过），保存直接 409，
不会静默覆盖别人的修改。

## 接口与工具

| 类型 | 名字 |
| --- | --- |
| HTTP | `GET /njau/api/office/{health,scan,files,doc,stat,raw}`、`POST /njau/api/office/{doc,new}` |
| 工具 | `njau_office_list`、`njau_office_read`、`njau_office_edit`、`njau_office_create`、`njau_office_status` |

面板点保存和模型调 `njau_office_edit` 走的是**同一个** `service.js`，不存在两套逻辑。

## 编辑操作（`njau_office_edit` 的 ops）

`set_text` / `set_runs` / `set_kind` / `set_align` / `insert` / `delete` / `set_cell` / `replace_text` / `append_table`

定位一律用**顶层块下标**（段落和表格一起编号，从 0 开始），改表格用 `index + row + col`。
先 `njau_office_read` 拿下标，再改 —— 不要让模型重写整篇，既费 token 又容易改坏别处。

## 测试

```powershell
node tests/smoke-workshop.mjs                 # 契约 + HTTP + 真 .docx 往返（含办公柱）
node packages/office/scripts/test-docx.mjs <某个.docx>  # 拿真实文档体检
```

`scripts/test-docx.mjs` 会读一遍、写一遍、再读一遍，逐行比对文字是否零丢失。
