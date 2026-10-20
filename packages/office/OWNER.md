# office 包负责人

> 换届时这份文件必须更新。办公柱碰的是协会真正的文件，坏了会丢数据。

## 现在谁负责

| 角色 | 姓名 | 联系方式 | 从什么时候 |
| --- | --- | --- | --- |
| 负责人 | 【待填】 | 【待填】 | 2026–2027 学年 |
| 备份 | 【待填】 | 【待填】 | 2026–2027 学年 |

## 交接时必须口头交代的三件事

1. **`service.js` 是唯一的真相层。**
   面板（HTTP）和 agent（工具）都只调它。谁要加功能就加在 service 里，
   别在 http.js 或 tools.js 里自己实现一遍 —— 一旦分叉，两条路会给出不同结果。

2. **写回只替换 `word/document.xml`，其余部件原样搬。**
   这就是为什么图片、页眉、样式表在我们改完文档之后还在。
   如果哪天要做到「图片也能编辑」，那是新功能，不是把这条规矩改掉。

3. **没建模的排版靠 `rawPPr` / `raw` 带回来。**
   段落和文字片段都存着读取时的原始 XML，写回时以它为底。
   删除这两个字段 = 每次保存都在悄悄清空别人的缩进和编号。

## 表格（.xlsx）这边额外要小心的两件事

1. **写回时只替换各个 `xl/worksheets/sheetN.xml`，其余部件原样搬。**
   所以样式表、主题、sharedStrings、图片图表都还在。同理：如果把
   `readXlsx()` 里抓的 `rawCols` / `rawSheetViews` / `merges` 弄丢，
   下次保存就会把列宽、冻结窗格、合并单元格清掉 —— 那是最容易被抱怨的「我什么都没改，格式就乱了」。
2. **不能新增工作表，只能改名。**
   加工作表要同时改 `workbook.xml`、`_rels/workbook.xml.rels`、`[Content_Types].xml` 三处，
   漏一处 Word 就会说文件损坏。现在明确报错，比写出坏文件好。

## 幻灯片（.pptx）这边额外要知道的一件事

`<p:sldId id="256" r:id="rId2"/>` 里 **`id` 是页标识，`r:id` 才是关系引用**。
写代码时先取 `id` 会让所有页都「消失」——踩过一次，症状是「打开演示文稿显示 0 页，
但启动日志一切正常」。同一个坑在 `.xlsx` 的 `<sheet name=… sheetId=… r:id=…/>` 上也有。

写回时同理：幻灯片是**整棵形状树重新序列化**，所以图片、表格、图表都还在；
但文字只重建我们模型里管的形状的 `a:p`，模板取自该形状原来的第一个 `a:p` / `a:r`
（段落属性与文字属性），否则每改一行字就会丢字号和配色。

## 改代码之后怎么让它生效（踩过的坑）

`file:` 依赖是**拷贝**进 profile 的，不是软链。改完必须 remove + add：

```powershell
# 把 <repo> 换成本机 clone 的位置
dsh plugin --profile njau remove "@njau-ca/dsh-njau-office"
dsh plugin --profile njau add "file:<repo>/packages/office"
```

改完跑一遍冒烟：

```powershell
node tests/smoke-workshop.mjs
node packages/office/scripts/test-docx.mjs "C:/path/to/某个真实.docx"
```

## 这个包最容易在什么时候坏

按可能性排序：

1. **写入逻辑改坏了，导致打不开** —— 症状：Word/WPS 提示文件损坏。
   先把可疑文件重命名备份，再用 `test-docx.mjs` 对原始文件跑一遍。
   冒烟测试里 `raw 返回的是 ZIP（PK 头）` 这条就是防这个的。
2. **编码/换行被别处改写** —— 症状：中文变乱码。
   注意：**不要用 PowerShell 的 `Get-Content` / `Set-Content` 往返改这个包的 .js 文件**
   （5.1 会按 ANSI 解码，把中文写坏）。只用编辑器或 write/edit 工具。
3. **DSH 升级后工具注册契约变了** —— 症状：插件加载了但工具没出现。
   看启动日志的 `[njau-office] 已加载 ... 工具 N`，N 应该是 5。
4. **并发覆盖** —— 已经在 `save()` 里用 `baseHash` 挡住了（409 doc/conflict）。
   如果看到「文件已被改动」，别手动绕过，先刷新。

排查顺序：启动日志 → `/njau/api/office/health` → `test-docx.mjs`。

## 怎么彻底删掉这个包

```powershell
dsh plugin --profile njau remove "@njau-ca/dsh-njau-office"
```

数据目录（`~/.dsh/njau-ca` 下的 .docx）**不要删** —— 那是协会的资料，不属于这个插件。
