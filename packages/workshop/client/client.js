/**
 * client.js —— 计协工作坊外壳的浏览器侧。
 *
 * 一个面板装三根柱子：首页 / 办公 / 漫剧 / 开发。
 * 外壳只做导航与现状展示，真正干活的是各柱自己的插件（办公柱已经是 njau-office）。
 *
 * 约束（DSH 的规矩，不是我们的偏好）：
 *   1. 只往 slot 里注册，不碰别人的 DOM，不往 document.body 上挂东西；
 *   2. 样式只用 --dsw-alias-* 主题令牌；
 *   3. 不 import 任何 @deepseek-ai/* 客户端包，只用 React。
 */

window.__ModuleLoader__.load({
  id: 'njau-workshop',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const TAB_ID = 'njau-workshop'
    const KIND = 'njau-workshop'
    const API = '/njau/api/workshop'

    // ------------------------------------------------------------ 网络

    async function call(path, options) {
      const response = await fetch(API + path, options)
      let data
      try {
        data = await response.json()
      } catch {
        throw new Error(`接口返回的不是 JSON（HTTP ${response.status}）`)
      }
      if (data === null || typeof data !== 'object' || data.ok !== true) {
        const error = data && data.error ? data.error : { message: `HTTP ${response.status}` }
        throw new Error(error.message || '请求失败')
      }
      return data.value
    }

    // ------------------------------------------------------------ 样式

    const STYLE_ID = 'njau-workshop-style'
    const CSS = `
.nw-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}
.nw-top{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.nw-tabs{display:flex;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.nw-tab{height:24px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.nw-tab:hover{color:var(--dsw-alias-label-primary)}
.nw-tab[data-active="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.nw-refresh{margin-left:auto;height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.nw-refresh:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.nw-body{flex:1 1 auto;min-height:0;overflow:auto;padding:12px}
.nw-error{margin:0 10px 8px;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-error);font-size:12px;white-space:pre-wrap}
.nw-id{padding:12px;border-radius:10px;background:linear-gradient(135deg,rgba(11,95,255,.12),rgba(11,95,255,.03));border:1px solid var(--dsw-alias-border-l2);margin-bottom:12px}
.nw-id-name{font-size:15px;font-weight:600;letter-spacing:.01em}
.nw-id-sub{margin-top:4px;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.nw-motto{margin-top:8px;font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.6}
.nw-line{display:flex;flex-direction:column;gap:8px;padding:12px;margin-bottom:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.nw-line-head{display:flex;align-items:center;gap:10px}
.nw-glyph{flex:0 0 auto;width:32px;height:32px;border-radius:9px;display:grid;place-items:center;font-size:15px;font-weight:600;color:#fff;background:var(--dsw-alias-brand-primary)}
.nw-line-title{flex:1 1 auto;min-width:0}
.nw-line-name{font-size:13px;font-weight:600}
.nw-line-desc{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nw-count{flex:0 0 auto;font-size:12px;color:var(--dsw-alias-label-secondary)}
.nw-count b{font-size:16px;color:var(--dsw-alias-label-primary);margin-right:2px}
.nw-recent{display:flex;flex-direction:column;gap:2px}
.nw-recent-row{display:flex;gap:8px;align-items:baseline;font-size:11.5px;color:var(--dsw-alias-label-secondary);padding:2px 0}
.nw-recent-row span:first-child{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nw-recent-row span:last-child{flex:0 0 auto;color:var(--dsw-alias-label-tertiary)}
.nw-actions{display:flex;gap:6px;margin-top:2px}
.nw-btn{height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.nw-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.nw-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.nw-btn-primary:hover{background:var(--dsw-alias-button-primary-hover)}
.nw-btn:disabled{opacity:.45;cursor:default}
.nw-group{margin-bottom:12px}
.nw-group-title{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin:0 0 6px 2px}
.nw-file{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer}
.nw-file:hover{background:var(--dsw-alias-interactive-bg-hover)}
.nw-file span:first-child{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nw-file span:last-child{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.nw-input{height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:12px;padding:0 8px;flex:1 1 auto;min-width:0}
.nw-empty{padding:20px 12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.7}
.nw-pill{display:inline-block;padding:1px 6px;border-radius:999px;font-size:10.5px;background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-secondary);margin-left:4px}
.nw-pill[data-ok="true"]{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}
.nw-path{font-family:ui-monospace,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-tertiary);word-break:break-all;margin-top:2px}
`

    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const element = document.createElement('style')
      element.id = STYLE_ID
      element.textContent = CSS
      document.head.appendChild(element)
    }

    // ------------------------------------------------------------ 面板

    const VIEWS = [
      ['home', '首页'],
      ['office', '办公'],
      ['manju', '漫剧'],
      ['code', '开发'],
    ]

    function WorkshopPanel(props) {
      const [view, setView] = useState('home')
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [newName, setNewName] = useState('')

      const refresh = useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          const value = await call('/state')
          setData(value)
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => {
        void refresh()
      }, [refresh])

      const openOffice = useCallback((path) => {
        // 办公柱提供 window 钩子就能带着文件进去；没有钩子就只开面板。
        const hook = typeof window === 'undefined' ? undefined : window.__NJAU_OPEN_OFFICE__
        if (typeof hook === 'function') {
          try {
            hook(path)
            return
          } catch {
            /* 落到下面的兜底 */
          }
        }
        try {
          props.openTab('njau-office')
        } catch {
          setError('办公面板还没装（@njau-ca/dsh-njau-office），先把它加进 profile。')
        }
      }, [props])

      const createManju = useCallback(async () => {
        const name = newName.trim()
        if (name === '') {
          setError('先写个项目名，例如 招新宣传漫剧')
          return
        }
        setBusy(true)
        setError('')
        try {
          await call('/manju/new', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
          })
          setNewName('')
          await refresh()
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [newName, refresh])

      const openKind = useCallback((kind, label) => {
        try {
          props.openTab(kind)
        } catch {
          setError(`${label}面板没注册（kind: ${kind}）。`)
        }
      }, [props])

      const identity = data?.identity ?? {}
      const lines = data?.lines ?? []

      // ---- 首页
      const home = h('div', null,
        h('div', { className: 'nw-id' },
          h('div', { className: 'nw-id-name' }, identity.shortName ?? '南农计协'),
          h('div', { className: 'nw-id-sub' },
            `${identity.fullName ?? ''}`,
            identity.abbr ? ` · ${identity.abbr}` : '',
            data === null ? '' : ` · 学年 ${data.schoolYear}`,
          ),
          identity.motto ? h('div', { className: 'nw-motto' }, `「${identity.motto}」`) : null,
        ),
        lines.map((line) => h('div', { key: line.id, className: 'nw-line' },
          h('div', { className: 'nw-line-head' },
            h('div', { className: 'nw-glyph' }, line.glyph),
            h('div', { className: 'nw-line-title' },
              h('div', { className: 'nw-line-name' }, line.zh),
              h('div', { className: 'nw-line-desc' }, line.desc),
            ),
            h('div', { className: 'nw-count' }, h('b', null, String(line.count)), line.unit),
          ),
          line.recent.length > 0
            ? h('div', { className: 'nw-recent' }, line.recent.map((item, index) => h('div', {
              key: `${line.id}-${index}`,
              className: 'nw-recent-row',
            }, h('span', { title: item.path }, item.label), h('span', null, item.detail))))
            : h('div', { className: 'nw-empty', style: { padding: '6px 0' } },
              line.id === 'manju' ? '还没有漫剧项目，去「漫剧」起一个' : line.id === 'code' ? '还没有站点或练手项目' : '这个学年还没有文档'),
          h('div', { className: 'nw-actions' },
            h('button', {
              type: 'button',
              className: 'nw-btn nw-btn-primary',
              onClick: () => setView(line.id),
            }, `进入${line.zh}`),
            line.id === 'office'
              ? h('button', { type: 'button', className: 'nw-btn', onClick: () => openKind('njau-office', '办公') }, '打开编辑器')
              : null,
          ),
        )),
      )

      // ---- 办公
      const office = h('div', null,
        (data?.office ?? []).length === 0
          ? h('div', { className: 'nw-empty' }, '数据目录里还没有 .docx。可以去办公面板新建一份。')
          : (data?.office ?? []).map((group) => h('div', { key: group.domain, className: 'nw-group' },
            h('div', { className: 'nw-group-title' }, `${group.domain} · ${group.count}`),
            group.files.slice(0, 8).map((file) => h('button', {
              key: file.path,
              type: 'button',
              className: 'nw-file',
              title: file.path,
              onClick: () => openOffice(file.path),
            }, h('span', null, file.name), h('span', null, `${Math.round(file.bytes / 1024)} KB`))),
          )),
        h('div', { className: 'nw-actions', style: { marginTop: 10 } },
          h('button', { type: 'button', className: 'nw-btn nw-btn-primary', onClick: () => openKind('njau-office', '办公') }, '打开办公编辑器'),
        ),
      )

      // ---- 漫剧
      const manju = h('div', null,
        h('div', { className: 'nw-actions', style: { marginBottom: 10 } },
          h('input', {
            className: 'nw-input',
            placeholder: '新漫剧项目名，例如 招新宣传漫剧',
            value: newName,
            onChange: (event) => setNewName(event.currentTarget.value),
            onKeyDown: (event) => { if (event.key === 'Enter') void createManju() },
          }),
          h('button', { type: 'button', className: 'nw-btn nw-btn-primary', disabled: busy, onClick: () => void createManju() }, '新建'),
        ),
        (data?.manju?.projects ?? []).length === 0
          ? h('div', { className: 'nw-empty' },
            '还没有项目。新建一个会生成 剧本.md、storyboard.json 和 assets/ ——',
            h('br'),
            '然后按「写剧本 → 拆分镜 → 出图 → 配音/合成」往下推。')
          : (data?.manju?.projects ?? []).map((project) => h('div', { key: project.dir, className: 'nw-line' },
            h('div', { className: 'nw-line-head' },
              h('div', { className: 'nw-glyph', style: { background: '#8B5CF6' } }, '漫'),
              h('div', { className: 'nw-line-title' },
                h('div', { className: 'nw-line-name' }, project.name),
                h('div', { className: 'nw-line-desc' }, project.next),
              ),
            ),
            h('div', null,
              h('span', { className: 'nw-pill', 'data-ok': project.hasScript ? 'true' : 'false' }, project.hasScript ? '剧本 ✓' : '剧本 缺'),
              h('span', { className: 'nw-pill', 'data-ok': project.hasStoryboard ? 'true' : 'false' }, project.hasStoryboard ? '分镜 ✓' : '分镜 缺'),
              h('span', { className: 'nw-pill', 'data-ok': project.panels > 0 ? 'true' : 'false' }, `${project.panels} 格`),
              h('span', { className: 'nw-pill', 'data-ok': project.assets > 0 ? 'true' : 'false' }, `${project.assets} 素材`),
            ),
            h('div', { className: 'nw-path' }, project.rel),
          )),
      )

      // ---- 开发
      const code = h('div', null,
        (data?.code?.projects ?? []).length === 0
          ? h('div', { className: 'nw-empty' }, 'site / learning 下还没有带 package.json 或 index.html 的项目。')
          : (data?.code?.projects ?? []).map((project) => h('div', { key: project.dir, className: 'nw-line' },
            h('div', { className: 'nw-line-head' },
              h('div', { className: 'nw-glyph', style: { background: '#0EA5E9' } }, '码'),
              h('div', { className: 'nw-line-title' },
                h('div', { className: 'nw-line-name' }, project.name),
                h('div', { className: 'nw-line-desc' }, `${project.domain} · ${project.next}`),
              ),
              h('div', { className: 'nw-count' }, h('b', null, String(project.files)), '个文件'),
            ),
            h('div', { className: 'nw-path' }, project.rel),
          )),
        h('div', { className: 'nw-actions', style: { marginTop: 10 } },
          h('button', { type: 'button', className: 'nw-btn', onClick: () => openKind('files', '文件树') }, '文件树'),
          h('button', { type: 'button', className: 'nw-btn', onClick: () => openKind('terminal', '终端') }, '终端'),
        ),
      )

      const body = view === 'home' ? home : view === 'office' ? office : view === 'manju' ? manju : code

      return h('div', { className: 'nw-root' },
        h('div', { className: 'nw-top' },
          h('div', { className: 'nw-tabs' }, VIEWS.map(([id, label]) => h('button', {
            key: id,
            type: 'button',
            className: 'nw-tab',
            'data-active': view === id ? 'true' : 'false',
            onClick: () => setView(id),
          }, label))),
          h('button', { type: 'button', className: 'nw-refresh', disabled: busy, onClick: () => void refresh() },
            busy ? '…' : '刷新'),
        ),
        error !== '' ? h('div', { className: 'nw-error' }, error) : null,
        h('div', { className: 'nw-body' }, body),
      )
    }

    // ------------------------------------------------------------ 注册

    function makeEntryButton(ctx) {
      return function WorkshopEntry() {
        return h('button', {
          type: 'button',
          className: 'nw-btn',
          title: '打开计协工作坊：办公 / 漫剧 / 开发',
          style: { marginLeft: 4 },
          onClick: () => {
            ensureStyle()
            ctx.sidebarRight.openTab(KIND)
          },
        }, '工作坊')
      }
    }

    function apply(ctx) {
      ensureStyle()
      ctx.inject(['slots', 'sidebarRight', 'sidebarRightTabs'], (scope) => {
        scope.effect(() => scope.sidebarRightTabs.register({
          id: TAB_ID,
          kind: KIND,
          priority: 'extension',
          title: () => '工作坊',
        }), 'njau-workshop: tab type')

        scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          inject: () => ({
            openTab: (kind) => scope.sidebarRight.openTab(kind),
          }),
        }, WorkshopPanel))

        scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: TAB_ID,
        }, function WorkshopTitle() {
          return h('span', null, '工作坊')
        }))

        scope.slots.inject('conversation.session.header.utilities', () => scope.slots.register({
          name: 'conversation.session.header.utilities',
          id: TAB_ID,
          order: 55,
        }, makeEntryButton(ctx)))
      })
    }

    exports.name = 'njau-workshop'
    exports.inject = []
    exports.apply = apply
    module.exports = exports
    return module.exports
  },
})
