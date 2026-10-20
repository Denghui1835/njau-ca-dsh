# manju 包负责人

> 换届时这份文件必须更新。漫剧柱碰的是「一条内容作品的全部工序」，坏了会丢创作。

## 现在谁负责

| 角色 | 姓名 | 联系方式 | 从什么时候 |
| --- | --- | --- | --- |
| 负责人 | 【校内渠道】 | 【校内渠道】 | 2026–2027 学年 |
| 备份 | 【校内渠道】 | 【校内渠道】 | 2026–2027 学年 |

> 本仓库是公开的：姓名与联系方式写进**校内**渠道，别写在这里。

## 交接时必须口头交代的三件事

1. **`storyboard.json` 是唯一真相，`剧本.md` 是给人看的。**
   别把台词写进剧本就以为分镜有了 —— 配音和合成读的是 `storyboard.json` 的 `dialogue`。
   两边要改就一起改，面板里两个视图就是干这个的。

2. **`panel.id` 一旦发出去就不能改。**
   `shot`（镜号）跟着位置走，`id` 不跟。agent 和你都按 `id` 定位，
   改了 `id` 等于让所有引用失效。删格可以，改号不行。

3. **这一步只做前两个工序。**
   出图 / 配音 / 合成是另外的插件，靠读写同一个文件和 `assets/` 协作。
   在这个包里加生成逻辑 = 把产线焊死，下次换模型就得推倒重来。

## 改代码之后怎么让它生效（踩过的坑）

`file:` 依赖是**拷贝**进 profile 的，不是软链。改完必须 remove + add：

```powershell
# 把 <repo> 换成本机 clone 的位置
dsh plugin --profile njau remove "@njau-ca/dsh-njau-manju"
dsh plugin --profile njau add "file:<repo>/packages/manju"
```

改完跑一遍冒烟：

```powershell
node tests/smoke-manju.mjs
```

## 这个包最容易在什么时候坏

按可能性排序：

1. **`normalize()` 被改窄了** —— 症状：老项目打开后少了分镜。
   这个函数只做加法（补默认值）、几乎不丢东西，是给「手写过的 / 隔了半年的 JSON」准备的。
   改它之前先想清楚：删掉的那条判断，会不会让某个人的旧项目打不开。
2. **镜号 renumber 漏了** —— 症状：删一格之后台词全错位。
   所有改动数组位置的操作（add / delete / move）都必须调 `renumber()`。
   冒烟测试里「镜号按位置重排」就是防这个的。
3. **素材接口越界** —— 症状：能读到项目目录外的文件。
   `assetPath()` 里的 `..` 检查与 `relative()` 兜底两条都不能删。
4. **DSH 升级后工具注册契约变了** —— 症状：插件加载了但工具没出现。
   看启动日志的 `[njau-manju] 已加载 … 工具 N`，N 应该是 6。

排查顺序：启动日志 → `/njau/api/manju/health` → `node tests/smoke-manju.mjs`。

## 怎么彻底删掉这个包

```powershell
dsh plugin --profile njau remove "@njau-ca/dsh-njau-manju"
```

`media/manju/` 下的项目**不要删** —— 那是协会的创作，不属于这个插件。
