# @njau-ca/dsh-njau-core

南农计协 DSH 生态的**内核**。它不干业务，只定义「协会的一切怎么办」——
身份、术语、数据落盘约定、交接规则、合规红线。

> 生态全貌见仓库根目录的 [`docs/architecture.md`](../../docs/architecture.md)。

## 它提供什么

| 类型 | 名称 | 作用 |
|---|---|---|
| 技能 | `njau-handbook` | 协会总纲：学年节奏、四步流程、落盘约定、交接规则、四条红线 |
| 工具 | `njau_overview` | 协会身份卡 + 生态域清单 |
| 工具 | `njau_data_list` | 列出协会数据文件（可按域过滤） |
| 工具 | `njau_data_read` | 读协会数据文件 |
| 工具 | `njau_data_write` | 原子写协会数据文件 |
| 工具 | `njau_data_append` | 向 JSON 数组追加一条记录 |
| 工具 | `njau_doctor` | 生态自检 |
| 命令 | `/njau` | 协会概览 |
| 命令 | `/njau-domains` | 列出全部业务域 |
| 命令 | `/njau-doctor` | 自检 |

## 配置

写在 profile 的 `cordis.patch.yml` 里，**全部可省略**：

```yaml
- id: njau-ca-core
  name: '@njau-ca/dsh-njau-core'
  config:
    dataDir: D:/njau-ca-data        # 默认 <用户主目录>/.dsh/njau-ca
    clubName: 南京农业大学计算机爱好者协会
    shortName: 南农计协
    schoolYear: 2026-2027           # 默认按系统时间推算（9 月起算新学年）
```

## 数据放在哪

默认 `~/.dsh/njau-ca/`。第一次运行会写出 `identity.json`。

**改协会名字不需要改代码**：编辑 `identity.json` 即可，插件每次启动会读它。

## 设计约束（改这个插件前请先读）

1. **零运行时依赖**：只用 Node 内置模块，不 `import` 任何 `@deepseek-ai/*` 运行时代码。
   这样 DSH 升级不会让内核失效。工具注册用规范 JSON Schema + 纯对象，
   不依赖 `defineTool`。
2. **不导出 schemastery `Config`**：不导出时 cordis 会把 YAML config 原样传入，
   于是配置校验与默认值都在 `lib/store.js` 的 `createEnv()` 里做，少一个上游依赖。
3. **内核不含业务**：想加「报销」就写 `finance` 插件，不要往内核里塞。
   内核一膨胀，整个生态就被它锁死了。

## 排错

启动后看不到 `[njau-ca] core 已加载` 这行日志，说明插件没装上或没进 bundle。
依次检查：

1. profile 的 `package.json` 里有没有这个包（`dependencies` + `dsh.profile.bundles`）；
2. 包目录里有没有 `lib/index.js` 和 `cordis.patch.yml`；
3. profile 的 `cordis.patch.yml` 里有没有那条 `insert`（正常由 bundle 自动带进来）。

详细步骤见 [`docs/install.md`](../../docs/install.md)。