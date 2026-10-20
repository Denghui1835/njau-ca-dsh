# 如何贡献

> 不需要会写代码。真的。

---

## 一、你是哪种贡献者

### A. 完全不会写代码 —— 写文档就行

**制度、SOP、模板、FAQ 全都是 Markdown 文件**，放在各个包的 `skills/` 目录里。

例子：
- 「纳新面试怎么打分」→ `packages/recruit/skills/interview-scoring/SKILL.md`
- 「报销要交哪些材料」→ `packages/finance/skills/reimbursement/SKILL.md`
- 「海报尺寸和字体规范」→ `packages/media/skills/poster-spec/SKILL.md`

**写这些就是在给系统加能力** —— 因为 DSH 的 agent 会读这些技能文件来做事。
会长可以直接改，改完下次对话就生效。

写法见 §三。

### B. 会一点命令 —— 帮着维护数据

协会台账在数据目录里（默认 `%USERPROFILE%\.dsh\njau-ca`），
全是 Markdown / YAML / JSON 纯文本。用记事本就能改。

改之前建议先 `git commit`（如果数据目录也在版本控制里），
或者至少复制一份备份。

### C. 会写代码 —— 加一个域插件或改进工具

见 §四。

---

## 二、第一个贡献：改一个错别字

**最省事的入门方式。** 找个文档里的错别字，改掉，提交。

目的不是那个错别字，而是让你走通一遍流程：改文件 → 提交 → 看到效果。
之后做什么都顺了。

---

## 三、写技能文件（`SKILL.md`）

技能文件是**给 agent 读的流程说明**，不是给人读的宣传稿。

### 结构建议

```markdown
---
name: poster-spec
description: 计协海报的尺寸、字体、配色与出图规范
---

# 海报规范

## 什么时候用
要做宣传海报、推文配图、活动展板时。

## 输出规格
- 尺寸：...
- 字体：...
- 主色：协会蓝 #0B5FFF

## 步骤
1. 先确认用途（线上推文 / 线下展板），尺寸不同。
2. ...
3. ...

## 红线
- 不画校徽、不写学校全称。
- 不用学校标准色。
```

### 写作要点

1. **写"怎么做"，不写"是什么"。** agent 需要的是步骤，不是背景介绍。
2. **给具体的值。** 「尺寸 1080×1440」比「合适的尺寸」有用一百倍。
3. **写清楚什么时候**用这个技能（"什么时候用"一节）。否则 agent 不知道该不该读。
4. **红线单独一节。** 合规要求要显眼（见 [`GOVERNANCE.md`](GOVERNANCE.md) §5）。
5. **别写内部敏感信息。** 整改材料、关联方、举报内容绝对不进仓库。

---

## 四、写代码（加一个域插件）

### 4.1 先读这些

1. [`docs/architecture.md`](docs/architecture.md) —— **三条铁律**，必读。
2. [`docs/vision.md`](docs/vision.md) —— 为什么这么做、什么不做。
3. [`docs/adr/`](docs/adr/) —— 已经有过的决策，别重新提已经被否决的方案。
4. 已有的包：`packages/core`、`packages/brand` —— 照着抄结构。

### 4.2 一个插件包要有的文件

```
packages/<domain>/
├── package.json          ← 没有 dependencies，没有 peerDependencies
├── cordis.patch.yml      ← insert 一行
├── README.md             ← 这个域管什么、怎么改、坑在哪
├── OWNER.md              ← **必需**，doctor 会检查
├── skills/<name>/SKILL.md
└── lib/
    ├── index.js          ← name / inject / apply，不导出 Config
    ├── tools.js
    └── commands.js
```

### 4.3 五条硬要求（违反就是 bug）

1. **不 import 别的计协插件**，也不 import 任何 `@deepseek-ai/*` 运行时包。
   → [ADR 0002](docs/adr/0002-plugins-do-not-call-each-other.md)、
     [ADR 0005](docs/adr/0005-zero-runtime-dependencies.md)

2. **`package.json` 里不写 `dependencies` / `peerDependencies`。**
   → 声明了反而更容易被 DSH 升级拒载。

3. **数据写纯文本**，且必须走 `resolveInside()` 做路径安全校验。
   → [ADR 0003](docs/adr/0003-files-not-database.md)

4. **命令名不含中文**（DSH 的正则是 `/^[a-z][a-z0-9_-]*$/u`）。
   一律用 `njau-` 前缀。

5. **不导出 schemastery `Config`。** 默认值与校验都放自己的
   `createEnv()` 里。

### 4.4 工具的写法

```js
ctx.tools.register({
  name: 'njau_example',
  description: '...',
  parameters: {                    // 裸 JSON Schema
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],            // ← 必须在对象级！属性级 required:true 无效
  },
  output: {
    schema: { type: 'object' },
    render(args, value) { return [{ type: 'text', text: JSON.stringify(value) }]; },
  },
  async execute(args, ctx) {
    // 出错就 throw，不要返回错误对象
    if (!ok) throw new Error('...');
    return { ok: true };
  },
});
```

**`output.schema` 和 `output.render` 是必需的**，漏了会报错。

### 4.5 加一个测试

照着 `tests/smoke-core.mjs` 写。它**不启动 DSH**，
而是 mock 一个 `ctx`（tools / skills / commands / systemPrompt / effect / logger），
动态 import 插件，检查：

- 注册了几个工具、技能、命令、提示词段
- 每个工具跑一遍，看返回结构对不对
- 每个命令 handler 跑一遍

这是**契约测试** —— 它保证插件遵守 DSH 的接口约定。

### 4.6 提交前跑一遍

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\doctor.ps1
```

全绿再提交。doctor 会检查 `OWNER.md`、包结构、合成树、客户端格式、
以及跑所有 `tests/smoke-*.mjs`。

---

## 五、给 Windows 用户的提醒

写 `.ps1` 脚本时：**只用 ASCII，不要写中文。**

Windows PowerShell 5.1 会把**无 BOM 的 UTF-8 中文** `.ps1` 读成乱码，
在新机器上直接语法错误。中文一律放 `.md` 文件。

这条是用血换来的 —— 见 [`scripts/install.ps1`](scripts/install.ps1) 开头的注释。

---

## 六、提交信息怎么写

不强制格式，但请写清楚**为什么**改，不只是改了什么。

好：
```
纳新：面试评分表加"技术基础"维度

原来的四个维度偏向表达能力，招进来的人代码基础参差。
加一个维度并给出权重，让面试官有据可依。
```

不好：
```
update
```

---

## 七、遇到不懂的

1. 先搜 `docs/` —— 大部分"为什么这么做"都写了。
2. 再看 `docs/adr/` —— 已经做过的决策都在里面。
3. 还不行就在技术组例会上问。

**不要因为怕改错就不改。** 这个仓库是为换届设计的 ——
它假设下一届会改它。改坏了 git 能回滚。