/**
 * client.js —— 计协工作坊「开发柱」的浏览器侧：文件树 + 代码编辑器 + 白名单运行。
 *
 * 编辑器是自带的轻量实现（textarea + 高亮底版 + 行号），不引任何外部包 ——
 * 生态铁律要求零运行时依赖，也没有 CDN 可依赖。
 *
 * 不做的事：不当 IDE。终端与工作区文件树用 DSH 自带的（这里只给按钮切过去）。
 */

window.__ModuleLoader__.load({
  id: 'njau-code',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef, useMemo } = React

    const TAB_ID = 'njau-code'
    const KIND = 'njau-code'
    const API = '/njau/api/code'

    // ------------------------------------------------------------ 面板状态

    const panelState = { project: null }
    const listeners = new Set()

    function publish(patch) {
      Object.assign(panelState, patch)
      for (const listener of listeners) listener()
    }

    function usePanelState() {
      const [, bump] = useState(0)
      useEffect(() => {
        const listener = () => bump((n) => n + 1)
        listeners.add(listener)
        return () => listeners.delete(listener)
      }, [])
      return panelState
    }

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
        const failure = new Error(error.message || '请求失败')
        failure.code = error.code
        throw failure
      }
      return data.value
    }

    const post = (path, body) => call(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    // ------------------------------------------------------------ 高亮

    const KEYWORDS = {
      javascript: 'const let var function return if else for while class new await async import export from try catch finally throw switch case break continue default typeof instanceof in of this super yield delete void extends static get set',
      typescript: 'const let var function return if else for while class new await async import export from try catch finally throw switch case break continue default typeof instanceof in of this super yield interface type enum implements declare public private protected readonly as namespace satisfies key',
      python: 'def class return if elif else for while import from as try except finally with lambda yield pass raise in is not and or None True False async await global nonlocal',
      shell: 'if then else fi for in do done while function export local echo cd ls cat mkdir rm cp mv git npm pnpm node',
      yaml: 'true false null',
      json: 'true false null',
      css: 'important media supports keyframes import from to',
    }

    function tokenize(code, language) {
      const kw = KEYWORDS[language]
      if (kw === undefined) return null
      const words = kw.split(' ')
      const keywordRe = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
      const pattern = new RegExp(
        '(\\/\\/[^\\n]*|#[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|<!--[\\s\\S]*?-->)' + // 1 注释
        '|(\'(?:\\\\.|[^\'\\\\])*\'|"(?:\\\\.|[^"\\\\])*"|`(?:\\\\.|[^`\\\\])*`)' + // 2 字符串
        `|\\b(${keywordRe})\\b` + // 3 关键字
        '|\\b(0x[0-9a-fA-F]+|\\d+(?:\\.\\d+)?)\\b', // 4 数字
        'g',
      )
      const out = []
      let last = 0
      let match
      while ((match = pattern.exec(code)) !== null) {
        if (match.index > last) out.push({ text: code.slice(last, match.index), cls: '' })
        const cls = match[1] !== undefined ? 'c' : match[2] !== undefined ? 's' : match[3] !== undefined ? 'k' : 'n'
        out.push({ text: match[0], cls })
        last = match.index + match[0].length
      }
      if (last < code.length) out.push({ text: code.slice(last), cls: '' })
      return out
    }

    function escapeHtml(text) {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
    }

    /** 高亮成 HTML：先分词再转义，避免把 HTML 当代码执行。 */
    function highlight(code, language) {
      const tokens = tokenize(code, language)
      if (tokens === null) return escapeHtml(code)
      return tokens
        .map((token) => (token.cls === '' ? escapeHtml(token.text) : `<span class="nk-t-${token.cls}">${escapeHtml(token.text)}</span>`))
        .join('')
    }

    // ------------------------------------------------------------ 样式

    const STYLE_ID = 'njau-code-style'
    const CSS = `
.nk-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}
.nk-top{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);flex-wrap:wrap}
.nk-select{height:26px;max-width:190px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:12px;padding:0 4px}
.nk-btn{height:26px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.nk-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.nk-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.nk-btn:disabled{opacity:.45;cursor:default}
.nk-status{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dsw-alias-label-tertiary);min-width:0}
.nk-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:0 0 auto}
.nk-dot[data-dirty="true"]{background:var(--dsw-alias-state-warn-primary)}
.nk-main{flex:1 1 auto;min-height:0;display:flex}
.nk-side{flex:0 0 196px;min-width:0;overflow:auto;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);padding:6px 4px}
.nk-side-head{display:flex;align-items:center;gap:4px;padding:2px 4px 6px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.nk-node{display:flex;align-items:center;gap:4px;width:100%;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;padding:2px 4px;border-radius:5px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nk-node:hover{background:var(--dsw-alias-interactive-bg-hover)}
.nk-node[data-active="true"]{background:var(--dsw-alias-interactive-bg-active)}
.nk-node .nk-tw{flex:0 0 auto;width:9px;color:var(--dsw-alias-label-tertiary);font-size:9px}
.nk-node .nk-nm{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}
.nk-editor{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;min-height:0}
.nk-filebar{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11.5px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}
.nk-code{position:relative;flex:1 1 auto;min-height:0;display:flex;background:#1e1e1e}
.nk-gutter{flex:0 0 auto;padding:8px 6px;text-align:right;font:12.5px/1.65 ui-monospace,Consolas,monospace;color:#6b7280;background:#1e1e1e;user-select:none;overflow:hidden;border-right:1px solid #2b2b2b}
.nk-pane{position:relative;flex:1 1 auto;min-width:0}
.nk-hl{position:absolute;inset:0;margin:0;padding:8px 10px;overflow:hidden;white-space:pre;tab-size:2;pointer-events:none;font:12.5px/1.65 ui-monospace,Consolas,monospace;color:#d4d4d4}
.nk-input{position:absolute;inset:0;margin:0;padding:8px 10px;width:100%;height:100%;border:0;outline:none;resize:none;background:transparent;color:transparent;caret-color:#fff;white-space:pre;tab-size:2;overflow:auto;font:12.5px/1.65 ui-monospace,Consolas,monospace}
.nk-t-c{color:#6a9955}
.nk-t-s{color:#ce9178}
.nk-t-k{color:#569cd6}
.nk-t-n{color:#b5cea8}
.nk-out{flex:0 0 auto;max-height:34%;overflow:auto;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.nk-out-head{display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:11.5px;color:var(--dsw-alias-label-tertiary);position:sticky;top:0;background:var(--dsw-alias-bg-layer-1)}
.nk-pre{margin:0;padding:0 10px 8px;font:11.5px/1.6 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary)}
.nk-empty{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:12.5px;padding:24px;text-align:center;line-height:1.8}
.nk-error{margin:0 8px 6px;padding:7px 9px;border-radius:6px;background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-error);font-size:12px;white-space:pre-wrap}
`

    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const element = document.createElement('style')
      element.id = STYLE_ID
      element.textContent = CSS
      document.head.appendChild(element)
    }

    // ------------------------------------------------------------ 文件树

    function TreeNode(props) {
      const { node, prefix, depth, expanded, onToggle, onOpen, activePath } = props
      const path = prefix === '' ? node.name : `${prefix}/${node.name}`
      if (node.type === 'dir') {
        const isOpen = expanded.has(path)
        return h('div', null,
          h('button', {
            type: 'button',
            className: 'nk-node',
            title: path,
            style: { paddingLeft: 4 + depth * 10 },
            onClick: () => onToggle(path),
          },
          h('span', { className: 'nk-tw' }, isOpen ? '▾' : '▸'),
          h('span', { className: 'nk-nm' }, `${node.name}/`)),
          isOpen
            ? (node.children ?? []).map((child) => h(TreeNode, {
              key: `${path}/${child.name}`,
              node: child,
              prefix: path,
              depth: depth + 1,
              expanded,
              onToggle,
              onOpen,
              activePath,
            }))
            : null,
        )
      }
      return h('button', {
        type: 'button',
        className: 'nk-node',
        title: path,
        'data-active': activePath === path ? 'true' : 'false',
        style: { paddingLeft: 4 + depth * 10 + 9 },
        onClick: () => onOpen(path),
      }, h('span', { className: 'nk-nm' }, node.name))
    }

    // ------------------------------------------------------------ 编辑器

    function CodePanel() {
      const shared = usePanelState()
      const [projects, setProjects] = useState([])
      const [project, setProject] = useState(null)
      const [tree, setTree] = useState(null)
      const [expanded, setExpanded] = useState(new Set())
      const [file, setFile] = useState(null)
      const [draft, setDraft] = useState('')
      const [dirty, setDirty] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [output, setOutput] = useState(null)

      const hlRef = useRef(null)
      const inputRef = useRef(null)
      const gutterRef = useRef(null)
      const fileRef = useRef(null)
      fileRef.current = file

      const flash = useCallback((message) => {
        setNotice(message)
        window.setTimeout(() => setNotice((value) => (value === message ? '' : value)), 2000)
      }, [])

      const refreshProjects = useCallback(async () => {
        try {
          const value = await call('/projects')
          setProjects(value.projects ?? [])
          return value.projects ?? []
        } catch (failure) {
          setError(failure.message)
          return []
        }
      }, [])

      const openProject = useCallback(async (id) => {
        if (id === null || id === undefined || id === '') return
        setBusy(true)
        setError('')
        setOutput(null)
        try {
          const [list, value] = await Promise.all([refreshProjects(), call(`/tree?project=${encodeURIComponent(id)}`)])
          setProject({ id, ...value })
          setTree(value.nodes ?? [])
          setFile(null)
          setDraft('')
          setDirty(false)
          // 默认展开顶层目录
          const top = new Set()
          for (const node of value.nodes ?? []) if (node.type === 'dir') top.add(node.name)
          setExpanded(top)
          publish({ project: id })
          void list
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [refreshProjects])

      const openFile = useCallback(async (path) => {
        if (project === null) return
        if (dirty && !window.confirm('当前文件有未保存的修改，切换会丢掉它们。继续？')) return
        setBusy(true)
        setError('')
        try {
          const value = await call(`/file?project=${encodeURIComponent(project.id)}&path=${encodeURIComponent(path)}`)
          setFile(value)
          fileRef.current = value
          setDraft(value.text)
          setDirty(false)
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [dirty, project])

      const save = useCallback(async () => {
        const current = fileRef.current
        if (project === null || current === null) return
        setBusy(true)
        setError('')
        try {
          const result = await post('/file', {
            project: project.id,
            path: current.path,
            text: draft,
            baseHash: current.hash,
          })
          const next = { ...current, hash: result.hash, bytes: result.bytes, lines: draft.split('\n').length }
          setFile(next)
          fileRef.current = next
          setDirty(false)
          flash('已保存')
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [draft, flash, project])

      const runAction = useCallback(async (action) => {
        if (project === null || action === '') return
        setBusy(true)
        setError('')
        try {
          const value = await post('/run', { project: project.id, action })
          setOutput(value)
        } catch (failure) {
          setError(failure.message)
          setOutput(null)
        } finally {
          setBusy(false)
        }
      }, [project])

      useEffect(() => {
        void refreshProjects()
      }, [refreshProjects])

      useEffect(() => {
        const target = shared.project
        if (target === null) return
        if (project !== null && project.id === target) return
        void openProject(target)
      }, [shared.project, openProject, project])

      // 行号与高亮跟随内容
      const lines = useMemo(() => draft.split('\n').length, [draft])
      const gutter = useMemo(() => Array.from({ length: lines }, (_, i) => i + 1).join('\n'), [lines])

      const syncScroll = useCallback(() => {
        const input = inputRef.current
        if (input === null) return
        if (hlRef.current !== null) {
          hlRef.current.scrollTop = input.scrollTop
          hlRef.current.scrollLeft = input.scrollLeft
        }
        if (gutterRef.current !== null) gutterRef.current.scrollTop = input.scrollTop
      }, [])

      const onKeyDown = useCallback((event) => {
        if (event.key === 'Tab') {
          event.preventDefault()
          const input = event.currentTarget
          const start = input.selectionStart
          const end = input.selectionEnd
          const next = `${draft.slice(0, start)}  ${draft.slice(end)}`
          setDraft(next)
          setDirty(true)
          window.requestAnimationFrame(() => {
            input.selectionStart = start + 2
            input.selectionEnd = start + 2
          })
          return
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          void save()
        }
      }, [draft, save])

      // ---- 渲染

      const runOptions = []
      if (project !== null) {
        for (const script of project.scripts ?? []) {
          runOptions.push([`${project.packageManager ?? 'npm'}:run:${script}`, `${project.packageManager ?? 'npm'} run ${script}`])
        }
        if (project.hasGit) {
          runOptions.push(['git:status', 'git status'])
          runOptions.push(['git:log', 'git log'])
          runOptions.push(['git:diff-stat', 'git diff --stat'])
        }
      }

      const header = h('div', { className: 'nk-top' },
        h('select', {
          className: 'nk-select',
          value: project === null ? '' : project.id,
          onChange: (event) => { void openProject(event.currentTarget.value) },
        },
        project === null ? h('option', { value: '' }, '选择项目…') : null,
        projects.map((item) => h('option', { key: item.id, value: item.id }, `${item.id}${item.hasPackage ? '' : ' (静态页)'}`)),
        ),
        h('button', { type: 'button', className: 'nk-btn', disabled: busy, onClick: () => void refreshProjects(), title: '重新扫描项目' }, '刷新'),
        h('div', { style: { width: 1, height: 18, background: 'var(--dsw-alias-border-l2)', margin: '0 2px' } }),
        h('button', {
          type: 'button',
          className: 'nk-btn nk-btn-primary',
          disabled: busy || file === null || dirty === false,
          onClick: () => void save(),
          title: 'Ctrl+S',
        }, '保存'),
        runOptions.length > 0
          ? h('select', {
            className: 'nk-select',
            defaultValue: '',
            onClick: (event) => { event.currentTarget.dataset.open = '1' },
            onChange: (event) => {
              const action = event.currentTarget.value
              event.currentTarget.value = ''
              if (action !== '') void runAction(action)
            },
          },
          h('option', { value: '' }, '运行…'),
          runOptions.map(([value, label]) => h('option', { key: value, value }, label)))
          : null,
        h('div', { className: 'nk-status' },
          h('span', { className: 'nk-dot', 'data-dirty': dirty ? 'true' : 'false' }),
          h('span', null, busy ? '处理中…' : notice !== '' ? notice : dirty ? '未保存' : file === null ? '未打开文件' : '已同步'),
        ),
      )

      if (project === null) {
        return h('div', { className: 'nk-root' },
          header,
          error !== '' ? h('div', { className: 'nk-error' }, error) : null,
          h('div', { className: 'nk-empty' },
            h('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, '开发'),
            h('div', null, '协会的代码项目在数据目录的 site/ 与 learning/ 下。'),
            h('div', null, '这里能看文件树、改代码、跑 package.json 里声明的脚本。'),
            projects.length > 0
              ? h('div', { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 260 } },
                projects.map((item) => h('button', {
                  key: item.id,
                  type: 'button',
                  className: 'nk-btn',
                  style: { textAlign: 'left' },
                  onClick: () => void openProject(item.id),
                }, `${item.id} · ${item.scripts.length} scripts`)))
              : h('div', null, '还没有项目。在 site/ 下建一个目录（带 package.json 或 index.html）就会出现。'),
          ),
        )
      }

      return h('div', { className: 'nk-root' },
        header,
        error !== '' ? h('div', { className: 'nk-error' }, error) : null,
        h('div', { className: 'nk-main' },
          h('div', { className: 'nk-side' },
            h('div', { className: 'nk-side-head' }, `${project.id} · ${project.hasPackage ? 'ts/js 项目' : '静态页'}`),
            (tree ?? []).map((node) => h(TreeNode, {
              key: node.name,
              node,
              prefix: '',
              depth: 0,
              expanded,
              activePath: file?.path ?? '',
              onToggle: (path) => {
                setExpanded((previous) => {
                  const next = new Set(previous)
                  if (next.has(path)) next.delete(path)
                  else next.add(path)
                  return next
                })
              },
              onOpen: (path) => void openFile(path),
            })),
          ),
          h('div', { className: 'nk-editor' },
            h('div', { className: 'nk-filebar' },
              h('span', null, file === null ? '未选择文件' : file.path),
              file !== null ? h('span', null, `· ${file.language} · ${lines} 行 · ${new Blob([draft]).size} 字节`) : null,
            ),
            file === null
              ? h('div', { className: 'nk-empty' }, '左边点一个文件开始改。', h('div', null, 'Ctrl+S 保存，Tab 缩进两格。'))
              : h('div', { className: 'nk-code' },
                h('div', { className: 'nk-gutter', ref: gutterRef }, gutter),
                h('div', { className: 'nk-pane' },
                  h('pre', {
                    className: 'nk-hl',
                    ref: hlRef,
                    'aria-hidden': true,
                    dangerouslySetInnerHTML: { __html: highlight(draft, file.language) + '\n' },
                  }),
                  h('textarea', {
                    className: 'nk-input',
                    ref: inputRef,
                    spellCheck: false,
                    value: draft,
                    onScroll: syncScroll,
                    onKeyDown,
                    onChange: (event) => { setDraft(event.currentTarget.value); setDirty(true) },
                  }),
                ),
              ),
          ),
        ),
        output !== null
          ? h('div', { className: 'nk-out' },
            h('div', { className: 'nk-out-head' },
              h('span', null, `$ ${output.command}`),
              h('span', null, `${output.code === null ? '?' : `exit ${output.code}`} · ${output.durationMs}ms${output.timedOut ? ' · 超时被杀' : ''}`),
              h('button', {
                type: 'button',
                className: 'nk-btn',
                style: { marginLeft: 'auto', height: 20, padding: '0 6px', fontSize: 11 },
                onClick: () => setOutput(null),
              }, '收起'),
            ),
            h('pre', { className: 'nk-pre' }, `${output.stdout ?? ''}${output.stderr ? `\n[stderr]\n${output.stderr}` : ''}` || '（无输出）'),
          )
          : null,
      )
    }

    // ------------------------------------------------------------ 注册

    function apply(ctx) {
      ensureStyle()

      if (typeof window !== 'undefined') {
        window.__NJAU_OPEN_CODE__ = (id) => {
          if (typeof id === 'string' && id !== '') publish({ project: id })
          ctx.sidebarRight.openTab(KIND)
        }
        ctx.effect(() => () => {
          if (window.__NJAU_OPEN_CODE__ !== undefined) delete window.__NJAU_OPEN_CODE__
        }, 'njau-code: window hook')
      }

      ctx.inject(['slots', 'sidebarRight', 'sidebarRightTabs'], (scope) => {
        scope.effect(() => scope.sidebarRightTabs.register({
          id: TAB_ID,
          kind: KIND,
          priority: 'extension',
          title: () => '开发',
        }), 'njau-code: tab type')

        scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
        }, CodePanel))

        scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: TAB_ID,
        }, function CodeTitle() {
          const shared = usePanelState()
          return h('span', { title: shared.project ?? '' }, shared.project === null ? '开发' : String(shared.project).split('/').pop())
        }))
      })
    }

    exports.name = 'njau-code'
    exports.inject = []
    exports.apply = apply
    module.exports = exports
    return module.exports
  },
})
