# workshop / 工作坊外壳

一句话：**把协会三条产线（办公 / 漫剧 / 开发）收进同一个面板，只负责「看现状 + 导航」，不替产线干活。**

## 它提供什么

| 东西 | 位置 | 说明 |
| --- | --- | --- |
| 浏览器面板 | 会话右侧栏「工作坊」标签页 | 首页 / 办公 / 漫剧 / 开发 四个视图 |
| 入口按钮 | 会话头部工具条「工作坊」 | 一键开面板 |
| HTTP 接口 | `/njau/api/workshop/*` | `health` `state` `manju` `manju/new` `code` |
| agent 工具 | `njau_workshop_state`、`njau_workshop_new_manju` | 看现状 / 起漫剧项目骨架 |
| 系统提示词段 | `njau-workshop:lines`（order 660） | 告诉模型三柱在哪 |

## 它刻意不做什么

- **不出图、不配音、不剪片、不编译。** 那些属于各产线自己的插件；外壳一旦开始干活，就会变成第二个百宝箱。
- **不 import 其它插件。** 数据根目录与身份卡在 `lib/env.js` 里自己读（十几行），这是生态铁律的代价。
- **不替用户做决定。** 每个项目只标「下一步该干什么」，从不自动推进。

## 三条产线定义在哪

`lib/lines.js` 的 `LINES` 数组。加一条产线只改这一处：

```js
{
  id: 'manju',            // 面板视图 id
  zh: '漫剧',              // 显示名
  glyph: '漫',            // 图标字
  desc: '剧本 → 分镜 → 出图 → 配音字幕 → 合成',
  domains: ['media'],     // 归属的数据目录（相对 <root>）
  panel: null,            // 有独立面板时填它的 tab kind
}
```

## 数据从哪来

`<root>` 默认 `~/.dsh/njau-ca`（可用 `NJAU_CA_DATA` 或 config `dataDir` 覆盖）：

- 办公：`report/ finance/ compliance/ recruit/ events/ org/ school/` 下的 `.docx`
- 漫剧：`media/manju/<项目>/`，每个项目 = `剧本.md` + `storyboard.json` + `assets/`
- 开发：`site/` 与 `learning/` 下带 `package.json` 或 `index.html` 的目录

## 怎么跑测试

```powershell
node tests/smoke-workshop.mjs
```

它用一个假 ctx 把「办公柱 + 工作坊」两个插件真跑起来，再把路由接到真 HTTP 服务上，
用 fetch 走一遍面板会走的请求，还会真的落一份 .docx 到临时目录。
见 `../../tests/smoke-workshop.mjs`。
