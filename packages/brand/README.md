# @njau-ca/dsh-njau-brand

南农计协的品牌与人设插件。**双面包**：宿主侧（Node）+ 浏览器侧（Web）。

## 它做什么

| 面 | 作用 |
| --- | --- |
| 宿主侧 | 加一段协会人设到系统提示词；向 Web 页面注入标题与主题色样式 |
| 浏览器侧 | 占住 `sidebar.brand.mark` 与 `sidebar.brand.name` 两个 slot，显示协会标识与名称 |

## 核心认识：DSH 没有「品牌配置面」

这是本项目最重要的技术发现，理解它才能改对这个包。

**DSH 不提供任何"设置品牌"的接口。** 官方界面上的鱼形图标和产品名，
是一个叫 `dsh-client-ui-brand-official` 的插件**占用 slot** 得到的。

所以品牌化的唯一路径是：**自己也去占同一个 slot，并且排到它前面。**

### 机制细节

1. `dsh-client-ui-sidebar` 声明了两个单值 slot：
   `sidebar.brand.mark`（图标）、`sidebar.brand.name`（名称）。
   —— slot 必须先由父级声明，往未声明的 slot 注册会抛错。

2. 官方占位者以**默认 priority `0`** 注册。

3. 本包以 **`priority: -1`** 注册。`entriesOfSlot` 按 priority **升序**取第一个，
   所以本包胜出。

4. 单值 slot **只在 priority 相同时才抛错**，所以 `-1` 是安全的，不会冲突。

> ⚠️ 这个机制是**静默**的：如果 DSH 升级改了 slot 名字，界面会**悄悄**变回官方鱼形图标，
> **不报错**。这是本包最脆的地方，升级后必须用 `../../scripts/doctor.ps1` 检查。

## 双面包的包格式

浏览器侧不是普通的 ESM，而是 DSH 规定的模块工厂格式：

```js
window.__ModuleLoader__.load({
  id: '@njau-ca/dsh-njau-brand',
  factory(require) {
    // factory 直接 return 模块导出对象，不要写 module.exports
    return { inject: ['slots'], apply(ctx) { /* ... */ } };
  },
});
```

`package.json` 必须**同时**声明两件事，缺浏览器侧就不加载（且只是静默不加载）：

```json
{
  "exports": { "./client": { "default": "./lib/client.js" } },
  "dsh": { "client": { "platform": "web", "inject": ["..."] } }
}
```

- `exports["./client"]` —— 让 `dsh-client-modules` 找得到这个文件。
- `dsh.client.platform` —— 必填字符串；缺了会直接抛错。
- `dsh.client.inject` —— 本包用到的 slot 属于哪些包，用于排序与告知，**不影响加载**。

## 可用的静态模块

浏览器侧可以直接 `require` 这些，无需声明：
`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、
`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、
`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、
`@deepseek-ai/dsh-client-ui-dockkit`。

本包只用 `react`。

## 主题色

浏览器侧通过 `theme.overrideTokens(source, tokens)` 覆盖：

```js
{ '--dsw-alias-brand-primary': { light: '#0B5FFF', dark: '#4D93F8' } }
```

`--dsw-alias-brand-primary` 是 DSH 的品牌主色令牌。
每个令牌要给 `{ light, dark }` 两个值；给裸字符串会抛错。

宿主侧还会注入一份同色值的 CSS，保证首屏（浏览器侧 JS 加载前）就是协会蓝。

## 改什么、别改什么

**可以改**（放心改）：
- `lib/index.js` 里的 `PERSONA` —— 人设文本，这是协会性格所在。
- `BRAND_PRIMARY_LIGHT` / `BRAND_PRIMARY_DARK` —— 主色。
- 标识图形 —— 换 SVG 路径即可，但要遵守下面的红线。

**别乱改**（改了会静默失效）：
- `sidebar.brand.mark` / `sidebar.brand.name` 两个 slot 名 —— 必须和 DSH 一致。
- `priority: -1` —— 改成 `0` 会和官方撞（抛错），改成更大值会被官方盖住。
- `window.__ModuleLoader__.load` 的格式与 `factory` 的返回方式。
- `package.json` 里的 `exports["./client"]` 和 `dsh.client`。

## 品牌红线

- ❌ 不画校徽、不写学校全称、不用学校标准色。
- ❌ 不使用任何让外界误认为"这是南京农业大学官方系统"的视觉或文案。
- ✅ 协会是学生社团，视觉上必须能和学校官方区分开。

## 排查

启动后看日志有没有这一行：

```
[njau-ca] brand 已接管 Web 品牌：窗口标题 + 主题色（侧栏标识由浏览器侧占 slot 完成）
```

没有 → 宿主侧没加载。有但界面还是官方图标 → 浏览器侧没加载，检查：

1. 页面 HTML 的模块线里有没有 `{"id":"@njau-ca/dsh-njau-brand","url":"plugins/??..."}`。
2. 直接访问那个 `url`，返回 JS = 挂上了；404 = 没挂上。

完整排查流程见 [`../../docs/install.md`](../../docs/install.md) 第 5 节。