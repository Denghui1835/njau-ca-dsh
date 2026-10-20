# office / 办公柱

一句话：**不装 WPS、不装 Office，直接在 DSH 里打开 .docx / .xlsx / .pptx，改完存回真正的文件。**

## 三类文件，一套引擎

| 类型 | 引擎 | 编辑方式 |
| --- | --- | --- |
| `.docx` | `docx-read.js` / `docx-write.js` | 纸页渲染，直接在字上改（contenteditable） |
| `.xlsx` | `xlsx-read.js` / `xlsx-write.js` | 网格编辑器，直接在格子里改 |
| `.pptx` | `pptx-read.js` / `pptx-write.js` | 幻灯片编辑器：页列表 + 标题 + 要点 |

三者共用同一套底层：`zip.js`（零依赖 ZIP 读写，node:zlib + 自写 CRC32）与 `xml.js`（极简 XML 树）。

## 为什么自己做文档引擎

协会的日常产出全是 Office 文件：报名表、会议纪要、立项书、报销单、年审材料。
调 WPS 要装软件、要弹窗、要处理 COM，换台电脑就废；而 .docx / .xlsx 本质都是「ZIP + 一堆 XML」。
自己拆包能保证三件事：**离线可用、换机器能用、改完还是标准格式。**

## 引擎边界（很重要，别高估它）

| 能读到 / 能写 | 不建模（但原样留在包里） |
| --- | --- |
| 段落 + 段落语义类型（标题 1-6 / 正文 / 引用 / 列表） | 图片、形状、图表 |
| 文字片段的格式（粗体 / 斜体 / 下划线 / 删除线 / 字号 / 颜色 / 字体） | 脚注、尾注、批注、修订痕迹 |
| 表格（行 / 列 / 合并列、单元格文字） | 域代码、目录（TOC）、页码域 |
| 页面尺寸与页边距（原样带回） | 页眉页脚（原样带回但不显示） |
| **单元格值 / 公式 / 样式下标**、行、列宽、合并单元格、冻结窗格 | 条件格式、数据校验、切片器、透视表 |
| **幻灯片文字**（每页标题、正文段落的文字与缩进层级） | 动画、切换、备注、母版排版调整 |

**保真的关键设计**：每段、每个文字片段、每张表的列宽与合并、每张幻灯片里没动过的形状，
都带着读取时的原始 XML，写回时以它为底、只覆盖模型里明确给出的字段。
所以「只改了一个字 / 一个格子 / 一行要点」不会顺手把缩进、编号、行距、列宽、合并单元格、图片清空。

### 表格这边的三条现实约束

1. **上限 5000 行 × 64 列**（读的时候截断并标记 `truncated`）——这是「人能看」的边界，不是技术极限。
2. **手改一格会覆盖该格原有的公式**（公式原文仍在 tooltip 里），因为「在这个格子里输入的值」就是用户的意图。
3. **不能新增工作表**（能改名、能读写每个格、能加删行）——加工作表要同步改 workbook.xml、rels 与
   content types，属于下一版；现在的做法是明确报错而不是写出坏文件。

### 幻灯片这边的三条约束

1. **只改文字**：标题与正文要点（含缩进层级）。位置、尺寸、配色、动画不动。
2. **不能增删页**（理由同上：要同步改 presentation.xml / rels / content types）。
3. **图片、表格、图表原样保留**：写回时整棵形状树重新序列化，没动过的形状一个字节都不变。

## 一次保存发生了什么

```
面板改字/改格 → DOM/state → 模型
        → POST /njau/api/office/doc 或 /sheet {path, model, baseHash}
        → service.save() / saveSheet()
        → writeDocx() 只替换 word/document.xml
          writeXlsx() 只替换各 sheetN.xml（其余部件原样搬）
        → 原子写（临时文件 + rename）
```

`baseHash` 是并发保护：你打开时的文件被改过（比如 agent 刚写过），保存直接 409，
不会静默覆盖别人的修改。

## 接口与工具

| 类型 | 名字 |
| --- | --- |
| HTTP（文档） | `GET /njau/api/office/{health,scan,files,doc,stat,raw}`、`POST /njau/api/office/{doc,new}` |
| HTTP（表格） | `GET /njau/api/office/sheet`、`POST /njau/api/office/{sheet,new-sheet}` |
| HTTP（幻灯片） | `GET /njau/api/office/deck`、`POST /njau/api/office/{deck,new-deck}` |
| 工具（文档） | `njau_office_list`、`njau_office_read`、`njau_office_edit`、`njau_office_create` |
| 工具（表格） | `njau_office_sheet_read`、`njau_office_sheet_edit`、`njau_office_sheet_create` |
| 工具（幻灯片） | `njau_office_deck_read`、`njau_office_deck_edit`、`njau_office_deck_create` |

面板点保存和模型调工具走的是**同一个** `service.js`，不存在两套逻辑。

## 编辑操作

**文档**（`njau_office_edit` 的 ops）：
`set_text` / `set_runs` / `set_kind` / `set_align` / `insert` / `delete` / `set_cell` / `replace_text` / `append_table`

**表格**（`njau_office_sheet_edit` 的 ops）：
`set_cell` / `clear_cell` / `insert_row` / `delete_row` / `set_row` / `set_sheet_name`
（单元格用 A1 记法 `ref:"B3"`，或 `row`+`col` 从 0 开始；公式直接给 `formula:"SUM(B2:B3)"`）

**幻灯片**（`njau_office_deck_edit` 的 ops）：
`set_title{slide,text}` / `set_text{slide,shape,index,text}` / `add_paragraph{slide,shape?,text,level?}`
/ `delete_paragraph{slide,shape,index}` / `set_level{slide,shape,index,level}`
（slide 是页下标，shape 是该页文字形状序号，都从 0 开始）

定位一律用下标 / 引用，不要让模型重写整篇 —— 既费 token 又容易改坏别处。

## 测试

```powershell
node tests/smoke-sheet.mjs                    # 表格：新建/改格/公式/冲突/往返
node tests/smoke-pptx.mjs                     # 幻灯片：新建/改标题段落/删段落/冲突
node tests/smoke-workshop.mjs                 # 文档 + 工作坊：真 HTTP + 真 .docx 往返
node packages/office/scripts/test-docx.mjs <某个.docx>  # 拿真实文档体检
```

`scripts/test-docx.mjs` 会读一遍、写一遍、再读一遍，逐行比对文字是否零丢失。
幻灯片与表格的产出另外用 **python-pptx / python-docx 独立验证过**（完全不同的实现能打开，说明格式是对的）。
