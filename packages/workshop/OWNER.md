# workshop 包负责人

> 换届时这份文件必须更新。它是「这个包坏了找谁」的唯一答案，也是交接时最容易漏的一页。

## 现在谁负责

| 角色 | 姓名 | 联系方式 | 从什么时候 |
| --- | --- | --- | --- |
| 负责人 | 【待填】 | 【待填】 | 2026–2027 学年 |
| 备份 | 【待填】 | 【待填】 | 2026–2027 学年 |

## 交接时必须口头交代的三件事

1. **外壳不许长胖。**
   它只做「看现状 + 导航」。一旦有人开始往这儿加出图、剪辑、编译，
   三条产线就会缠成一坨，下一届连从哪儿改都不知道。新能力加在对应产线的包里。

2. **三条产线的定义只有一处：`lib/lines.js` 的 `LINES`。**
   加产线 = 加一项 + 建一个插件包。别在面板里散着写 if。

3. **数据根目录默认 `~/.dsh/njau-ca`，不是仓库里的某个文件夹。**
   协会资料跟着「人的机器」走，不跟着代码走。换电脑要拷的是那个目录。

## 改代码之后怎么让它生效（踩过的坑）

`file:` 依赖是被**拷贝**进 profile 的，不是软链。改完 `lib/*.js` 或 `client/*.js`，
**直接重启不生效**，`pnpm install --force` 也不生效（pnpm 只看 spec 不看内容）。必须：

```powershell
# 把 <repo> 换成本机 clone 的位置
dsh plugin --profile njau remove "@njau-ca/dsh-njau-workshop"
dsh plugin --profile njau add "file:<repo>/packages/workshop"
```

或者直接重跑仓库根的 `scripts\install.ps1`（它会按目录重新装一遍全部包）。

判断有没有生效：比对源文件与
`%USERPROFILE%\.dsh\profiles\njau\node_modules\@njau-ca\dsh-njau-workshop\lib\` 下同名文件的**字节数**。

## 这个包最容易在什么时候坏

按可能性排序：

1. **DSH 升级后 slot 契约变了** —— 症状：面板不出现、或控制台报
   `slot entry crashed in 'sidebar.right.pane.tab'`。
   看启动日志有没有 `[njau-workshop] 已加载`（有 = host 没问题，是浏览器侧）。
2. **`sidebarRightTabs.register` 的 `id` 撞车** —— 症状：插件整个不激活。
   `id` 必须全局唯一，本包用的是 `njau-workshop`。
3. **数据目录权限** —— 症状：面板显示三条产线但数量全是 0。
   检查 `~/.dsh/njau-ca` 能不能读。
4. **办公柱没装** —— 症状：点文件只开空面板。检查 `@njau-ca/dsh-njau-office` 在不在 bundles 里。

排查顺序：看启动日志 → 调 `/njau/api/workshop/state` → 再手查数据目录。

## 怎么彻底删掉这个包

```powershell
dsh plugin --profile njau remove "@njau-ca/dsh-njau-workshop"
```

再从 `njau-ca-dsh/packages/` 删掉目录、从 `profiles/njau/package.json` 的
`dsh.profile.bundles` 里去掉那一行。数据目录不用动 —— 它属于协会，不属于这个包。
