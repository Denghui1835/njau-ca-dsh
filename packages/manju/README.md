# manju / 漫剧柱

一句话：**一条漫剧 = 一个目录 + 两个文件。这个包管前两个工序：写剧本、拆分镜。**

## 一条漫剧长什么样

```
<数据目录>/media/manju/<项目名>/
  剧本.md           人看的故事（Markdown），随便怎么排版
  storyboard.json   机器读的分镜表 —— 所有工序都挂在它上面
  assets/           出图、音频、合成产物
```

`storyboard.json` 的每一格（`panels[]`）：

| 字段 | 用途 |
| --- | --- |
| `id` | 稳定标识（`p1`、`p2`…），**改顺序也不变** —— agent 靠它定位 |
| `shot` | 镜号，永远等于位置（改顺序会自动重排） |
| `desc` | 画面描述：谁、在哪、在干什么、镜头怎么给 |
| `dialogue[]` | 台词：`{ who, line, emotion }` |
| `duration` | 这一格多少秒（配音与合成要用） |
| `characters[]` | 出场角色 id |
| `asset` | 出图产物路径（`assets/p1.png`），没出图就是 `null` |
| `status` | `todo` / `drawn` / `voiced` / `done` |

**为什么要一个文件当中枢**：出图、配音、合成可能是三届人、三个插件、甚至隔半年才接上做的。
一个能 `git diff` 的 JSON，比任何数据库 schema 都耐用。

## 这一版做到哪

| 工序 | 状态 |
| --- | --- |
| 写剧本（`剧本.md`） | ✅ 面板里直接编辑 + agent 整篇写入 |
| 拆分镜（`storyboard.json`） | ✅ 面板卡片式编辑：增删、上下移、台词、时长、状态 |
| 窗口期修复 | ✅ 坏 JSON / 手写脏数据会被 `normalize()` 救回来，不丢内容 |
| 出图 | ⬜ 待建（产物写进 `assets/`，把路径登记到 `panel.asset`） |
| 配音字幕 | ⬜ 待建 |
| 合成 | ⬜ 待建 |

面板会明确显示「未出图」，**不假装有图**。后面三步各自是独立插件，
通过读写同一个 `storyboard.json` 与 `assets/` 协作 —— 谁坏了都不影响前面。

## 接口与工具

| 类型 | 名字 |
| --- | --- |
| HTTP | `GET /njau/api/manju/{health,projects,project,asset}`、`POST /njau/api/manju/{new,board,script}` |
| 工具 | `njau_manju_list`、`njau_manju_read`、`njau_manju_edit`、`njau_manju_script_write`、`njau_manju_new`、`njau_manju_status` |

`njau_manju_edit` 的操作：`set_field` / `add_panel` / `set_panel` / `delete_panel` / `move_panel` / `clear_panels`。
**永远按 `id` 定位，不要按镜号猜** —— 镜号会随排序变，`id` 不会。

## 冲突保护

`board` 与 `script` 两个接口都带 `baseHash`：你打开时的文件被别人（比如 agent）改过，
保存直接 409（`board/conflict` / `script/conflict`），不会静默覆盖。

## 测试

```powershell
node tests/smoke-manju.mjs
```

覆盖：插件契约 → 项目生命周期 → 分镜增删改排序 → 坏数据修复 → 素材直出（含穿越防护）→ 真 HTTP。
