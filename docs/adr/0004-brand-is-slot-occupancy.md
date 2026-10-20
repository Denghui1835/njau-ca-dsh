# ADR 0004 —— 品牌靠「占 slot」，不靠配置

- 状态：**已采纳**
- 日期：2026-10
- 决策者：2026–2027 届

## 背景

协会版 DSH 要长得像协会自己的东西：侧栏是协会标识和名称，
窗口标题是「南农计协 · DSH」，主色是协会蓝。

直觉做法是找 DSH 的**品牌配置项**：某个 `config` 里改个 `brandName`、
换个 `logoUrl`。

## 问题

**DSH 根本没有品牌配置面。**

翻遍 289 个 `@deepseek-ai/dsh-*` 包，没有任何"设置品牌"的接口。
官方界面上的鱼形图标和产品名，是一个叫 `dsh-client-ui-brand-official`
的插件**占用 slot** 得到的 —— 它和第三方插件用的是**同一套机制**。

所以"配置品牌"这件事在 DSH 里不存在。要么占 slot，要么就没有品牌。

## 决策

**用占 slot 的方式做品牌。**

1. `dsh-client-ui-sidebar` 声明了两个**单值 slot**：
   `sidebar.brand.mark`（图标）、`sidebar.brand.name`（名称）。

2. 官方占位者以**默认 `priority: 0`** 注册。

3. 我们以 **`priority: -1`** 注册 —— `entriesOfSlot` 按 priority **升序**取第一个，
   所以本插件胜出。单值 slot **只在 priority 相同时才抛错**，所以 `-1` 安全。

4. 窗口标题与主题色走另外两条通道：
   - `webserver/index-inject` 注入 `<style>` / `<script>`（标题 + 首屏主色）
   - `theme.overrideTokens` 覆盖令牌 `--dsw-alias-brand-primary`

## 理由

1. **这是唯一可行的路径。** 没有配置面，就只能占 slot。

2. **不 fork 界面。** 另一个想法是把 DSH 的前端复制出来改成协会版 ——
   **明确否决**：DSH 升级一次就要重做一次，维护不起，
   而且会失去所有上游改进。占 slot 只有二十几行代码。

3. **和官方用同一套机制，所以升级时一起升级。** 官方改 slot 名我们跟着改，
   这是"跟随"而不是"对抗"。

## 代价

- ⚠️ **静默失效风险（最大的代价）。**
  如果 DSH 升级改了 slot 名字，界面会**悄悄**变回官方鱼形图标，
  **不报任何错**。这是本仓库最脆的地方。
  → 缓解：`scripts/doctor.ps1` 第 6 节专门检查客户端格式与 slot 名；
    升级 DSH 后必须跑一次并**肉眼看界面**。

- **依赖未公开的内部结构。** slot 名、`__ModuleLoader__` 格式、
  `dsh.client` 清单字段都不是公开 API。
  → 接受。这是使用 DSH 的代价；正因为没有文档，这些结论已写进
    [`../architecture.md`](../architecture.md) §5，避免下届重新逆向一遍。

- **浏览器侧代码要遵守模块工厂格式**（`factory(require)` 直接 return 导出对象），
  不是普通 ESM。
  → 已在 `packages/brand/README.md` 里写明。

## 相关

- 机制细节见 [`../architecture.md`](../architecture.md) §5。
- 品牌红线（不画校徽、不写学校全称）见同节 §5.6 —— 这是**合规要求**。