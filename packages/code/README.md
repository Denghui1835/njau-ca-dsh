# code / 开发柱

一句话：**项目列表 + 文件树 + 代码编辑器 + 白名单运行**。不是 IDE —— 终端和工作区文件树用 DSH 自带的。

## 它管什么

协会的代码项目放在数据目录的 `site/` 与 `learning/` 下（可用 config `projectDirs` 改）。
项目 id 是相对数据根的路径，例如 `site/portal`、`learning/ts-demo`。

| 能力 | 说明 |
| --- | --- |
| 项目发现 | 目录下有 `package.json` / `index.html` / `.git` 就算一个项目 |
| 文件树 | 自动跳过 `node_modules` / `dist` / `build` / `.next` / `__pycache__` 等噪音目录 |
| 读文件 | 文本文件上限 1MB；二进制（有 `\0`）直接拒绝，不往面板里塞乱码 |
| 写文件 | 原子写，必要时建目录；带 `baseHash` 时做并发保护（`file/conflict`） |
| 运行 | 只能跑 **项目 `package.json` 里声明的 scripts**，以及 **只读 git 命令** |

## 为什么「运行」要白名单

面板不是终端。终端可以跑任何东西，那是 DSH 自带的能力，也是用户明确要的；
而一个按钮如果能跑任意 shell，就等于把「面板」变成了「后门」——
`npm install` 的 postinstall、`node -e` 的一行代码，都能在这儿悄悄执行。
所以这里只允许两件事，都是可预期的：

- `npm:run:<script>` / `pnpm:run:<script>` / `yarn:run:<script>` —— script 名必须在
  该项目的 `package.json` 里声明过，名字还要过 `^[A-Za-z0-9:_-]{1,64}$`；
- `git:status` / `git:log` / `git:diff-stat` —— 只读，不能提交、不能改历史。

超时 60 秒，超时整棵进程树被杀；输出截断在 200KB。

## 接口与工具

| 类型 | 名字 |
| --- | --- |
| HTTP | `GET /njau/api/code/{health,projects,tree,file}`、`POST /njau/api/code/{file,run}` |
| 工具 | `njau_code_projects`、`njau_code_tree`、`njau_code_read`、`njau_code_write`、`njau_code_run`、`njau_code_status` |

面板点保存 / 跑脚本和模型调工具走的是**同一个** `service.js`。

## 编辑器是怎么做的

没有 Monaco、没有 CodeMirror —— 生态铁律是零运行时依赖，也没有 CDN 可依赖。所以是：

```
行号栏  +  <pre>（高亮后的一层 HTML，只负责显示）
        +  <textarea>（透明文字、显示光标、负责输入）
```

两层字体重叠、滚动同步。高亮是自己写的分词器：注释 / 字符串 / 关键字 / 数字四类，
覆盖 js / ts / python / json / yaml / css / shell。够用，不追求完备。

`Tab` 缩进两格，`Ctrl+S` 保存。

## 测试

```powershell
node tests/smoke-code.mjs
```

覆盖：契约 → 项目发现 → 文件树（跳过 node_modules）→ 读写/冲突/越界/二进制
→ **真跑一次 `npm run`** → 任意命令被拒 → 只读 git → 真 HTTP。

装进 DSH 之后：

```powershell
node scripts/verify-live.mjs http://127.0.0.1:<port>
```
