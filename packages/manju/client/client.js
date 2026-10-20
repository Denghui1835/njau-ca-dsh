/**
 * client.js —— 计协工作坊「漫剧柱」的浏览器侧。
 *
 * 一个面板管两件事：写剧本（剧本.md）与拆分镜（storyboard.json）。
 * 出图 / 配音 / 合成还没做 —— 面板会明确显示「未出图」，不假装有图。
 *
 * 约束（DSH 的规矩）：
 *   1. 只往 slot 里注册，不碰别人的 DOM；
 *   2. 样式只用 --dsw-alias-* 主题令牌；
 *   3. 不 import 任何 @deepseek-ai/* 客户端包，只用 React。
 */

window.__ModuleLoader__.load({
  id: 'njau-manju',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const TAB_ID = 'njau-manju'
    const KIND = 'njau-manju'
    const API = '/njau/api/manju'

    const STATUS = [
      ['todo', '待出图'],
      ['drawn', '已出图'],
      ['voiced', '已配音'],
      ['done', '已完成'],
    ]
    const ASPECTS = ['9:16', '16:9', '1:1', '4:5']
    const LOOKS = ['manga', 'webtoon', 'chinese-ink', 'pixel']

    // ------------------------------------------------------------ 面板状态
    //
    // 和办公柱同一个约定：打开哪条漫剧由模块级 state 记住，
    // 外壳点项目时调 window.__NJAU_OPEN_MANJU__(name) 带进来。

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

    // ------------------------------------------------------------ 样式

    const STYLE_ID = 'njau-manju-style'
    const CSS = `
.nm-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}
.nm-top{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.nm-select{height:26px;max-width:180px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:12px;padding:0 4px}
.nm-tabs{display:flex;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.nm-tab{height:22px;padding:0 9px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.nm-tab[data-active="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.nm-btn{height:26px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.nm-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.nm-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.nm-btn:disabled{opacity:.45;cursor:default}
.nm-mini{height:22px;padding:0 6px;font-size:11px;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit}
.nm-mini:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.nm-status{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dsw-alias-label-tertiary);min-width:0}
.nm-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:0 0 auto}
.nm-dot[data-dirty="true"]{background:var(--dsw-alias-state-warn-primary)}
.nm-body{flex:1 1 auto;min-height:0;overflow:auto;padding:10px}
.nm-error{margin:0 8px 8px;padding:7px 9px;border-radius:6px;background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-error);font-size:12px;white-space:pre-wrap}
.nm-meta{display:grid;grid-template-columns:1fr;gap:6px;padding:8px;margin-bottom:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}
.nm-input,.nm-area{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:12px;padding:5px 7px}
.nm-area{resize:vertical;line-height:1.6;min-height:44px}
.nm-card{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1);margin-bottom:10px;overflow:hidden}
.nm-card-head{display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1)}
.nm-shot{font-weight:600;font-size:12px}
.nm-card-body{display:flex;flex-direction:column;gap:7px;padding:8px}
.nm-row{display:flex;gap:6px;align-items:center}
.nm-line{display:flex;gap:5px;align-items:center}
.nm-line .nm-input{flex:1 1 auto;min-width:0}
.nm-who{max-width:82px;flex:0 0 82px}
.nm-emo{max-width:62px;flex:0 0 62px}
.nm-dur{max-width:64px;flex:0 0 64px}
.nm-pill{display:inline-block;padding:1px 6px;border-radius:999px;font-size:10.5px;background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-secondary)}
.nm-pill[data-warn="true"]{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label)}
.nm-pill[data-ok="true"]{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}
.nm-asset{display:flex;align-items:center;gap:8px;padding:6px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.nm-asset img{width:72px;height:96px;object-fit:cover;border-radius:5px;background:#000}
.nm-empty{padding:22px 12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.8}
.nm-script{width:100%;box-sizing:border-box;min-height:320px;height:60vh;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;font-family:ui-monospace,Consolas,"Microsoft YaHei",monospace;font-size:12.5px;line-height:1.75;padding:10px;resize:vertical}
.nm-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.6}
`

    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const element = document.createElement('style')
      element.id = STYLE_ID
      element.textContent = CSS
      document.head.appendChild(element)
    }

    // ------------------------------------------------------------ 小工具

    const totalDuration = (panels) => panels.reduce((sum, panel) => sum + (Number(panel.duration) || 0), 0)

    const gapsOf = (panel) => {
      const gaps = []
      if ((panel.desc ?? '').trim() === '') gaps.push('画面描述')
      if (panel.asset === null || panel.asset === undefined) gaps.push('画面')
      if ((panel.dialogue ?? []).length === 0) gaps.push('台词')
      return gaps
    }

    // ------------------------------------------------------------ 面板

    function ManjuPanel() {
      const shared = usePanelState()
      const [projects, setProjects] = useState([])
      const [current, setCurrent] = useState(null)
      const [board, setBoard] = useState(null)
      const [script, setScript] = useState('')
      const [boardHash, setBoardHash] = useState('')
      const [scriptHash, setScriptHash] = useState('')
      const [view, setView] = useState('storyboard')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [newName, setNewName] = useState('')
      const [dirty, setDirty] = useState(false)

      const boardRef = useRef(null)
      const currentRef = useRef(null)
      boardRef.current = board
      currentRef.current = current

      const flash = useCallback((message) => {
        setNotice(message)
        window.setTimeout(() => setNotice((value) => (value === message ? '' : value)), 2000)
      }, [])

      const markDirty = useCallback(() => setDirty(true), [])

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

      const openProject = useCallback(async (name) => {
        if (name === null || name === undefined || name === '') return
        setBusy(true)
        setError('')
        try {
          const value = await call(`/project?name=${encodeURIComponent(name)}`)
          setCurrent(value)
          currentRef.current = value
          setBoard(value.board)
          boardRef.current = value.board
          setScript(value.script)
          setBoardHash(value.boardHash)
          setScriptHash(value.scriptHash)
          setDirty(false)
          publish({ project: value.name })
          if (value.repaired) setError('storyboard.json 原本不是合法 JSON，已按空分镜表读入。保存前请确认。')
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [])

      const createProject = useCallback(async () => {
        const name = newName.trim()
        if (name === '') {
          setError('先写个项目名，例如 招新宣传漫剧')
          return
        }
        setBusy(true)
        setError('')
        try {
          const value = await post('/new', { name })
          setNewName('')
          await refreshProjects()
          await openProject(value.name)
          flash(`已新建 ${value.name}`)
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [newName, openProject, refreshProjects, flash])

      const saveBoard = useCallback(async () => {
        const project = currentRef.current
        const value = boardRef.current
        if (project === null || value === null) return
        setBusy(true)
        setError('')
        try {
          const result = await post('/board', { name: project.name, board: value, baseHash: boardHash })
          setBoardHash(result.boardHash)
          setDirty(false)
          flash('分镜已保存')
          void refreshProjects()
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [boardHash, flash, refreshProjects])

      const saveScript = useCallback(async () => {
        const project = currentRef.current
        if (project === null) return
        setBusy(true)
        setError('')
        try {
          const result = await post('/script', { name: project.name, text: script, baseHash: scriptHash })
          setScriptHash(result.scriptHash)
          setDirty(false)
          flash('剧本已保存')
          void refreshProjects()
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [flash, refreshProjects, script, scriptHash])

      // 首次进入：列项目；外壳塞了项目名就直接打开
      useEffect(() => {
        void refreshProjects()
      }, [refreshProjects])

      useEffect(() => {
        const target = shared.project
        if (target === null) return
        if (currentRef.current !== null && currentRef.current.name === target) return
        void openProject(target)
      }, [shared.project, openProject])

      // ---- 分镜编辑

      const updatePanel = useCallback((id, patch) => {
        setBoard((previous) => {
          if (previous === null) return previous
          return {
            ...previous,
            panels: previous.panels.map((panel) => (panel.id === id ? { ...panel, ...patch } : panel)),
          }
        })
        markDirty()
      }, [markDirty])

      const updateDialogue = useCallback((panel, index, patch) => {
        const dialogue = panel.dialogue.map((line, i) => (i === index ? { ...line, ...patch } : line))
        updatePanel(panel.id, { dialogue })
      }, [updatePanel])

      const addDialogue = useCallback((panel) => {
        updatePanel(panel.id, { dialogue: [...panel.dialogue, { who: '', line: '', emotion: '' }] })
      }, [updatePanel])

      const removeDialogue = useCallback((panel, index) => {
        updatePanel(panel.id, { dialogue: panel.dialogue.filter((_, i) => i !== index) })
      }, [updatePanel])

      const addPanel = useCallback((afterIndex) => {
        setBoard((previous) => {
          if (previous === null) return previous
          let max = 0
          for (const panel of previous.panels) {
            const matched = /^p(\d+)$/.exec(panel.id)
            if (matched !== null) max = Math.max(max, Number(matched[1]))
          }
          const created = {
            id: `p${max + 1}`,
            shot: 0,
            desc: '',
            dialogue: [],
            duration: 3,
            characters: [],
            asset: null,
            status: 'todo',
            notes: '',
          }
          const panels = [...previous.panels]
          panels.splice(afterIndex + 1, 0, created)
          panels.forEach((panel, index) => { panel.shot = index + 1 })
          return { ...previous, panels }
        })
        markDirty()
      }, [markDirty])

      const removePanel = useCallback((index) => {
        setBoard((previous) => {
          if (previous === null) return previous
          const panels = previous.panels.filter((_, i) => i !== index)
          panels.forEach((panel, i) => { panel.shot = i + 1 })
          return { ...previous, panels }
        })
        markDirty()
      }, [markDirty])

      const movePanel = useCallback((index, delta) => {
        setBoard((previous) => {
          if (previous === null) return previous
          const target = index + delta
          if (target < 0 || target >= previous.panels.length) return previous
          const panels = [...previous.panels]
          const [panel] = panels.splice(index, 1)
          panels.splice(target, 0, panel)
          panels.forEach((item, i) => { item.shot = i + 1 })
          return { ...previous, panels }
        })
        markDirty()
      }, [markDirty])

      // ---- 渲染

      const header = h('div', { className: 'nm-top' },
        h('select', {
          className: 'nm-select',
          value: current === null ? '' : current.name,
          onChange: (event) => { void openProject(event.currentTarget.value) },
        },
        current === null ? h('option', { value: '' }, '选择漫剧项目…') : null,
        projects.map((project) => h('option', { key: project.name, value: project.name }, project.name)),
        ),
        h('button', { type: 'button', className: 'nm-btn', disabled: busy, onClick: () => void createProject(), title: '新建一条漫剧' }, '新建'),
        h('div', { className: 'nm-tabs' },
          h('button', {
            type: 'button', className: 'nm-tab', 'data-active': view === 'storyboard' ? 'true' : 'false',
            onClick: () => setView('storyboard'),
          }, '分镜'),
          h('button', {
            type: 'button', className: 'nm-tab', 'data-active': view === 'script' ? 'true' : 'false',
            onClick: () => setView('script'),
          }, '剧本'),
        ),
        h('button', {
          type: 'button',
          className: 'nm-btn nm-btn-primary',
          disabled: busy || current === null,
          onClick: () => (view === 'script' ? void saveScript() : void saveBoard()),
        }, '保存'),
        h('div', { className: 'nm-status' },
          h('span', { className: 'nm-dot', 'data-dirty': dirty ? 'true' : 'false' }),
          h('span', null, busy ? '处理中…' : notice !== '' ? notice : dirty ? '未保存' : current === null ? '未打开' : '已同步'),
        ),
      )

      if (current === null) {
        return h('div', { className: 'nm-root' },
          header,
          error !== '' ? h('div', { className: 'nm-error' }, error) : null,
          h('div', { className: 'nm-empty' },
            h('div', { style: { marginBottom: 10 } }, '漫剧：剧本 → 分镜 → 出图 → 配音字幕 → 合成'),
            h('div', { style: { display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 12 } },
              h('input', {
                className: 'nm-input',
                style: { maxWidth: 220 },
                placeholder: '新项目名，例如 招新宣传漫剧',
                value: newName,
                onChange: (event) => setNewName(event.currentTarget.value),
                onKeyDown: (event) => { if (event.key === 'Enter') void createProject() },
              }),
              h('button', { type: 'button', className: 'nm-btn nm-btn-primary', disabled: busy, onClick: () => void createProject() }, '新建'),
            ),
            projects.length > 0
              ? h('div', { style: { textAlign: 'left', maxWidth: 380, margin: '0 auto' } },
                projects.map((project) => h('button', {
                  key: project.name,
                  type: 'button',
                  className: 'nm-btn',
                  style: { display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 },
                  onClick: () => void openProject(project.name),
                }, `${project.name} · ${project.panels} 格 · ${project.nextStep}`)))
              : h('div', null, '还没有漫剧项目。'),
          ),
        )
      }

      const panels = board?.panels ?? []

      const storyboardView = h('div', null,
        h('div', { className: 'nm-meta' },
          h('input', {
            className: 'nm-input',
            placeholder: '标题',
            value: board.title ?? '',
            onChange: (event) => { setBoard({ ...board, title: event.currentTarget.value }); markDirty() },
          }),
          h('input', {
            className: 'nm-input',
            placeholder: '一句话故事（logline）',
            value: board.logline ?? '',
            onChange: (event) => { setBoard({ ...board, logline: event.currentTarget.value }); markDirty() },
          }),
          h('div', { className: 'nm-row' },
            h('span', { className: 'nm-hint' }, '画幅'),
            h('select', {
              className: 'nm-select',
              value: board.style?.aspect ?? '9:16',
              onChange: (event) => {
                setBoard({ ...board, style: { ...board.style, aspect: event.currentTarget.value } })
                markDirty()
              },
            }, ASPECTS.map((aspect) => h('option', { key: aspect, value: aspect }, aspect))),
            h('span', { className: 'nm-hint' }, '画风'),
            h('select', {
              className: 'nm-select',
              value: board.style?.look ?? 'manga',
              onChange: (event) => {
                setBoard({ ...board, style: { ...board.style, look: event.currentTarget.value } })
                markDirty()
              },
            }, LOOKS.map((look) => h('option', { key: look, value: look }, look))),
            h('span', { className: 'nm-hint', style: { marginLeft: 'auto' } },
              `${panels.length} 格 · 约 ${Math.round(totalDuration(panels) * 10) / 10} 秒`),
          ),
        ),
        panels.length === 0
          ? h('div', { className: 'nm-empty' },
            '还没有分镜。先写剧本，或者直接加一格：把剧本里的一个画面写成一句话。',
            h('div', { style: { marginTop: 10 } },
              h('button', { type: 'button', className: 'nm-btn nm-btn-primary', onClick: () => addPanel(-1) }, '加第一格')))
          : panels.map((panel, index) => h('div', { key: panel.id, className: 'nm-card' },
            h('div', { className: 'nm-card-head' },
              h('span', { className: 'nm-shot' }, `#${panel.shot}`),
              h('span', { className: 'nm-hint' }, panel.id),
              gapsOf(panel).map((gap) => h('span', { key: gap, className: 'nm-pill', 'data-warn': 'true' }, gap)),
              h('span', { style: { flex: '1 1 auto' } }),
              h('select', {
                className: 'nm-select',
                style: { height: 22, fontSize: 11 },
                value: panel.status,
                onChange: (event) => updatePanel(panel.id, { status: event.currentTarget.value }),
              }, STATUS.map(([value, label]) => h('option', { key: value, value }, label))),
              h('button', { type: 'button', className: 'nm-mini', title: '上移', disabled: index === 0, onClick: () => movePanel(index, -1) }, '↑'),
              h('button', { type: 'button', className: 'nm-mini', title: '下移', disabled: index === panels.length - 1, onClick: () => movePanel(index, 1) }, '↓'),
              h('button', { type: 'button', className: 'nm-mini', title: '删除这一格', onClick: () => removePanel(index) }, '删'),
            ),
            h('div', { className: 'nm-card-body' },
              h('textarea', {
                className: 'nm-area',
                placeholder: '画面描述：谁、在哪、在做什么、镜头怎么给（一句话就够）',
                value: panel.desc ?? '',
                onChange: (event) => updatePanel(panel.id, { desc: event.currentTarget.value }),
              }),
              (panel.dialogue ?? []).map((line, lineIndex) => h('div', { key: lineIndex, className: 'nm-line' },
                h('input', {
                  className: 'nm-input nm-who',
                  placeholder: '角色',
                  value: line.who ?? '',
                  onChange: (event) => updateDialogue(panel, lineIndex, { who: event.currentTarget.value }),
                }),
                h('input', {
                  className: 'nm-input',
                  placeholder: '台词',
                  value: line.line ?? '',
                  onChange: (event) => updateDialogue(panel, lineIndex, { line: event.currentTarget.value }),
                }),
                h('input', {
                  className: 'nm-input nm-emo',
                  placeholder: '情绪',
                  value: line.emotion ?? '',
                  onChange: (event) => updateDialogue(panel, lineIndex, { emotion: event.currentTarget.value }),
                }),
                h('button', { type: 'button', className: 'nm-mini', title: '删掉这句', onClick: () => removeDialogue(panel, lineIndex) }, '×'),
              )),
              h('div', { className: 'nm-row' },
                h('button', { type: 'button', className: 'nm-mini', onClick: () => addDialogue(panel) }, '+ 台词'),
                h('span', { className: 'nm-hint', style: { marginLeft: 4 } }, '时长'),
                h('input', {
                  className: 'nm-input nm-dur',
                  type: 'number',
                  min: '0.2',
                  step: '0.5',
                  value: panel.duration ?? 3,
                  onChange: (event) => updatePanel(panel.id, { duration: Number(event.currentTarget.value) || 0.2 }),
                }),
                h('span', { className: 'nm-hint' }, '秒'),
                h('button', { type: 'button', className: 'nm-mini', style: { marginLeft: 'auto' }, onClick: () => addPanel(index) }, '+ 下面加一格'),
              ),
              panel.asset === null || panel.asset === undefined
                ? h('div', { className: 'nm-asset' },
                  h('div', { style: { width: 72, height: 96, borderRadius: 5, background: 'var(--dsw-alias-interactive-bg-active)', display: 'grid', placeItems: 'center', fontSize: 11 } }, '未出图'),
                  h('div', null,
                    h('div', null, '这一格还没有画面。'),
                    h('div', { className: 'nm-hint' }, '出图产线落地后，生成的图会落到 assets/ 并自动填进这里。')))
                : h('div', { className: 'nm-asset' },
                  h('img', {
                    src: `${API}/asset?name=${encodeURIComponent(current.name)}&path=${encodeURIComponent(panel.asset)}`,
                    alt: panel.desc ?? '',
                  }),
                  h('div', null,
                    h('div', null, panel.asset),
                    h('div', { className: 'nm-hint' }, '已出图'))),
            ),
          )),
        panels.length > 0
          ? h('div', { style: { display: 'flex', gap: 6, marginTop: 4 } },
            h('button', { type: 'button', className: 'nm-btn', onClick: () => addPanel(panels.length - 1) }, '+ 末尾加一格'))
          : null,
      )

      const scriptView = h('div', null,
        h('div', { className: 'nm-hint', style: { marginBottom: 6 } },
          '剧本是给人看的：故事、设定、分集、对白。分镜表才是给机器读的，两边不要混。'),
        h('textarea', {
          className: 'nm-script',
          placeholder: '在这里写剧本…',
          value: script,
          onChange: (event) => { setScript(event.currentTarget.value); markDirty() },
        }),
        h('div', { className: 'nm-hint', style: { marginTop: 6 } },
          `${script.length} 字 · ${script.split('\n').length} 行 · 下一步：${current.nextStep ?? ''}`),
      )

      return h('div', { className: 'nm-root' },
        header,
        error !== '' ? h('div', { className: 'nm-error' }, error) : null,
        h('div', { className: 'nm-body' }, view === 'script' ? scriptView : storyboardView),
      )
    }

    // ------------------------------------------------------------ 注册

    function apply(ctx) {
      ensureStyle()

      if (typeof window !== 'undefined') {
        window.__NJAU_OPEN_MANJU__ = (name) => {
          if (typeof name === 'string' && name !== '') publish({ project: name })
          ctx.sidebarRight.openTab(KIND)
        }
        ctx.effect(() => () => {
          if (window.__NJAU_OPEN_MANJU__ !== undefined) delete window.__NJAU_OPEN_MANJU__
        }, 'njau-manju: window hook')
      }

      ctx.inject(['slots', 'sidebarRight', 'sidebarRightTabs'], (scope) => {
        scope.effect(() => scope.sidebarRightTabs.register({
          id: TAB_ID,
          kind: KIND,
          priority: 'extension',
          title: () => '漫剧',
        }), 'njau-manju: tab type')

        scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
        }, ManjuPanel))

        scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: TAB_ID,
        }, function ManjuTitle() {
          const shared = usePanelState()
          return h('span', { title: shared.project ?? '' }, shared.project === null ? '漫剧' : shared.project)
        }))
      })
    }

    exports.name = 'njau-manju'
    exports.inject = []
    exports.apply = apply
    module.exports = exports
    return module.exports
  },
})
