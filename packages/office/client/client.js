/**
 * client.js —— 计协工作坊「办公」柱的浏览器侧：会话右侧栏里的「办公」面板。
 *
 * 它负责这一柱的门面：
 *   - 打开 .docx → 渲染成纸页 → 直接在字上改（contenteditable）；
 *   - 保存时把整份模型 POST 回 host，host 用 OOXML 引擎写回真正的 .docx；
 *   - 模型改了文档以后，面板轮询发现 hash 变了就自己刷新，不会各说各话。
 *
 * 三条自我约束（都是 DSH 的规矩）：
 *   1. 只通过 slot 注册进界面，不碰别人的 DOM，不往 document.body 上挂东西；
 *   2. 样式只用 --dsw-alias-* 主题令牌（纸张本身是文档，固定白底黑字）；
 *   3. 组件内不 import 任何 @deepseek-ai/* 客户端包，只用 React。
 */

window.__ModuleLoader__.load({
  id: 'njau-office',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback, useMemo } = React

    const TAB_ID = 'njau-office'
    const KIND = 'njau-office'
    const API = '/njau/api/office'
    const NS = 'njau-office'

    // ------------------------------------------------------------ 面板状态
    //
    // 打开哪份文档由模块级 state 记住，而不是塞进 tab params：
    // 页类型（page type）的 params 在各版本里不保证透传，而「点按钮 → 开面板
    // → 面板知道该开哪个文件」这件事必须稳。state 变了就通知订阅者。

    const panelState = { path: null }
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

    // ------------------------------------------------------------ 模型 <-> DOM

    function escapeHtml(text) {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
    }

    /** 一段 run 的 HTML：格式用真实标签包住，visual 与结构一一对应。 */
    function runsToHtml(runs) {
      const body = (runs ?? []).map((run) => {
        let html = escapeHtml(run.text ?? '').replace(/\n/g, '<br>')
        if (html === '') return ''
        if (typeof run.color === 'string') html = `<span style="color:#${escapeHtml(run.color)}">${html}</span>`
        if (typeof run.size === 'number') html = `<span style="font-size:${run.size}pt">${html}</span>`
        if (run.underline) html = `<u>${html}</u>`
        if (run.italic) html = `<i>${html}</i>`
        if (run.bold) html = `<b>${html}</b>`
        if (run.strike) html = `<s>${html}</s>`
        return html
      }).join('')
      return body === '' ? '<br>' : body
    }

    const BASE_FORMAT = { bold: false, italic: false, underline: false, strike: false, caps: false }

    /** 把 contenteditable 里的 DOM 读回 runs（相邻同格式合并）。 */
    function runsFromDom(root) {
      const raw = []
      const walk = (node, format) => {
        if (node.nodeType === 3) {
          const text = node.nodeValue.replace(/\u00a0/g, ' ')
          if (text !== '') raw.push({ text, ...format })
          return
        }
        if (node.nodeType !== 1) return
        const tag = node.tagName.toLowerCase()
        if (tag === 'br') {
          raw.push({ text: '\n', ...format })
          return
        }
        const next = { ...format }
        if (tag === 'b' || tag === 'strong') next.bold = true
        if (tag === 'i' || tag === 'em') next.italic = true
        if (tag === 'u') next.underline = true
        if (tag === 's' || tag === 'strike' || tag === 'del') next.strike = true
        const style = node.getAttribute('style') ?? ''
        const color = /(?:^|;)\s*color:\s*(?:#|rgb\()?\s*([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/.exec(style)
        if (color !== null) next.color = color[1].length === 3
          ? color[1].split('').map((c) => c + c).join('').toLowerCase()
          : color[1].toLowerCase()
        const size = /(?:^|;)\s*font-size:\s*([0-9.]+)pt/.exec(style)
        if (size !== null) next.size = Number(size[1])
        for (const child of node.childNodes) walk(child, next)
      }
      walk(root, BASE_FORMAT)

      const merged = []
      for (const run of raw) {
        const last = merged[merged.length - 1]
        if (last !== undefined
          && last.bold === run.bold && last.italic === run.italic
          && last.underline === run.underline && last.strike === run.strike
          && last.color === run.color && last.size === run.size) {
          last.text += run.text
        } else {
          merged.push({ ...run })
        }
      }
      return merged
    }

    const paragraphText = (block) => (block.runs ?? []).map((run) => run.text).join('')

    /** 列号 → 字母（0 → A，26 → AA），表格表头用。 */
    function colName(col) {
      let name = ''
      let n = col + 1
      while (n > 0) {
        const rem = (n - 1) % 26
        name = String.fromCharCode(65 + rem) + name
        n = Math.floor((n - 1) / 26)
      }
      return name
    }

    function cloneFormat(run) {
      const out = { ...BASE_FORMAT }
      if (run !== undefined) {
        if (typeof run.size === 'number') out.size = run.size
        if (typeof run.color === 'string') out.color = run.color
        if (typeof run.font === 'string') out.font = run.font
        if (run.bold) out.bold = true
        if (run.italic) out.italic = true
        if (run.underline) out.underline = true
        if (run.strike) out.strike = true
      }
      return out
    }

    /** 取光标在纯文本里的偏移，以及该段的纯文本。 */
    function caretOffset(root) {
      const selection = window.getSelection()
      if (selection === null || selection.rangeCount === 0) return { text: root.textContent ?? '', offset: 0 }
      const range = selection.getRangeAt(0)
      if (!root.contains(range.startContainer)) return { text: root.textContent ?? '', offset: 0 }
      const before = range.cloneRange()
      before.selectNodeContents(root)
      before.setEnd(range.startContainer, range.startOffset)
      return { text: root.textContent ?? '', offset: before.toString().length }
    }

    // ------------------------------------------------------------ 样式

    const STYLE_ID = 'njau-office-style'
    const CSS = `
.ws-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}
.ws-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);flex:0 0 auto}
.ws-btn{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.ws-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ws-btn[data-active="true"]{background:var(--dsw-alias-interactive-bg-active);border-color:var(--dsw-alias-border-l3)}
.ws-btn:disabled{opacity:.45;cursor:default}
.ws-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.ws-btn-primary:hover{background:var(--dsw-alias-button-primary-hover)}
.ws-sep{width:1px;height:18px;background:var(--dsw-alias-border-l2);margin:0 4px}
.ws-select{height:26px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:12px;padding:0 4px}
.ws-status{display:flex;align-items:center;gap:8px;margin-left:auto;font-size:12px;color:var(--dsw-alias-label-tertiary);min-width:0}
.ws-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:0 0 auto}
.ws-dot[data-dirty="true"]{background:var(--dsw-alias-state-warn-primary)}
.ws-name{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.ws-canvas{flex:1 1 auto;min-height:0;overflow:auto;padding:16px;background:var(--dsw-alias-bg-layer-1)}
.ws-page{width:794px;max-width:100%;margin:0 auto;background:#ffffff;color:#1a1a1a;box-shadow:0 1px 4px rgba(0,0,0,.18),0 8px 28px rgba(0,0,0,.08);border-radius:2px;padding:56px 64px;box-sizing:border-box;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;font-size:11pt;line-height:1.7}
.ws-page [contenteditable]{outline:none}
.ws-page [contenteditable]:focus{background:#f6f9ff;box-shadow:inset 2px 0 0 #0b5fff}
.ws-p{margin:0 0 6px;min-height:1.7em;white-space:pre-wrap;word-break:break-word}
.ws-p[data-kind="title"]{font-size:26pt;font-weight:600;text-align:center;margin:0 0 18px;line-height:1.3}
.ws-p[data-kind="subtitle"]{font-size:14pt;text-align:center;color:#595959;margin:0 0 18px}
.ws-p[data-kind="h1"]{font-size:20pt;font-weight:600;margin:18px 0 8px;line-height:1.35}
.ws-p[data-kind="h2"]{font-size:16pt;font-weight:600;margin:14px 0 6px;line-height:1.35}
.ws-p[data-kind="h3"]{font-size:13.5pt;font-weight:600;margin:12px 0 4px}
.ws-p[data-kind="h4"],.ws-p[data-kind="h5"],.ws-p[data-kind="h6"]{font-size:11.5pt;font-weight:600;margin:10px 0 4px}
.ws-p[data-kind="quote"]{border-left:3px solid #bfbfbf;padding-left:12px;color:#595959}
.ws-p[data-kind="list"]{padding-left:22px;position:relative}
.ws-p[data-kind="list"]::before{content:"•";position:absolute;left:8px;color:#666}
.ws-table{border-collapse:collapse;width:100%;margin:8px 0 12px;table-layout:fixed}
.ws-table td{border:1px solid #bfbfbf;padding:4px 8px;vertical-align:top;font-size:10.5pt}
.ws-table td[contenteditable]{min-width:24px;white-space:pre-wrap;word-break:break-word}
.ws-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--dsw-alias-label-tertiary);font-size:13px;padding:24px}
.ws-empty h3{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.ws-filelist{width:100%;max-width:520px;max-height:60%;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.ws-filerow{display:flex;align-items:center;gap:8px;padding:8px 10px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;width:100%;cursor:pointer}
.ws-filerow:last-child{border-bottom:0}
.ws-filerow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ws-filerow span:first-child{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-filerow span:last-child{flex:0 0 auto;color:var(--dsw-alias-label-tertiary)}
.ws-input{height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:12px;padding:0 8px;width:340px;max-width:100%}
.ws-error{margin:0 8px;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-error);font-size:12px;white-space:pre-wrap}
.ws-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);text-align:center;max-width:560px;line-height:1.6}
.ws-sheet-canvas{flex:1 1 auto;min-height:0;overflow:auto;padding:8px;background:var(--dsw-alias-bg-layer-1)}
.ws-sheet{border-collapse:separate;border-spacing:0;font-size:11.5px;background:#fff;color:#111}
.ws-sheet th{position:sticky;top:0;z-index:1;background:#f0f0f0;color:#555;font-weight:500;font-size:10.5px;padding:2px 4px;border:1px solid #d0d0d0;min-width:78px;text-align:center}
.ws-sheet th.ws-rownum{left:0;z-index:2;min-width:34px;text-align:right;color:#666;background:#f0f0f0}
.ws-sheet td{border:1px solid #e0e0e0;padding:0}
.ws-cell{width:100%;box-sizing:border-box;border:0;outline:none;background:transparent;color:inherit;font:inherit;font-size:11.5px;padding:3px 5px;min-width:78px}
.ws-cell:focus{background:#eef5ff;box-shadow:inset 0 0 0 2px #0b5fff}
.ws-sheet-foot{flex:0 0 auto;padding:4px 8px;border-top:1px solid var(--dsw-alias-border-l2);font-size:11px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}
.ws-deck-body{flex:1 1 auto;min-height:0;display:flex;gap:8px;padding:8px}
.ws-deck-list{flex:0 0 132px;min-width:0;overflow:auto;display:flex;flex-direction:column;gap:4px}
.ws-deck-thumb{display:flex;align-items:center;gap:6px;padding:6px 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:11.5px;text-align:left;cursor:pointer}
.ws-deck-thumb[data-active="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-active)}
.ws-deck-no{flex:0 0 auto;width:18px;height:18px;border-radius:4px;background:var(--dsw-alias-bg-layer-3);display:grid;place-items:center;font-size:10px;color:var(--dsw-alias-label-secondary)}
.ws-deck-title{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-deck-editor{flex:1 1 auto;min-width:0;overflow:auto;display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.ws-deck-row{display:flex;align-items:center;gap:6px}
.ws-deck-section{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:4px}
`

    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const element = document.createElement('style')
      element.id = STYLE_ID
      element.textContent = CSS
      document.head.appendChild(element)
    }

    // ------------------------------------------------------------ 面板组件

    const KIND_OPTIONS = [
      ['p', '正文'],
      ['title', '标题'],
      ['subtitle', '副标题'],
      ['h1', '标题 1'],
      ['h2', '标题 2'],
      ['h3', '标题 3'],
      ['quote', '引用'],
      ['list', '列表'],
    ]

    function WpsDocumentTab() {
      const shared = usePanelState()
      const [doc, setDoc] = useState(null)
      const [sheet, setSheet] = useState(null)
      const [deck, setDeck] = useState(null)
      const [activeSlide, setActiveSlide] = useState(0)
      const [files, setFiles] = useState([])
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState(false)
      const [dirty, setDirty] = useState(false)
      const [rev, setRev] = useState(0)
      const [newName, setNewName] = useState('')
      const [showPicker, setShowPicker] = useState(false)
      const [viewRows, setViewRows] = useState(30)
      const [viewCols, setViewCols] = useState(14)
      const [activeSheet, setActiveSheet] = useState(0)

      const docRef = useRef(null)
      const sheetRef = useRef(null)
      const deckRef = useRef(null)
      const pageRef = useRef(null)
      const activeIndex = useRef(-1)
      const pendingCaret = useRef(null)

      docRef.current = doc
      sheetRef.current = sheet
      deckRef.current = deck

      const flash = useCallback((message) => {
        setNotice(message)
        window.setTimeout(() => setNotice((current) => (current === message ? '' : current)), 2200)
      }, [])

      const markDirty = useCallback(() => setDirty(true), [])

      // ---- 打开 / 保存 / 刷新

      const load = useCallback(async (path, options = {}) => {
        setBusy(true)
        setError('')
        const isSheet = /\.(xlsx|xlsm)$/i.test(path)
        const isDeck = /\.(pptx|pptm)$/i.test(path)
        try {
          if (isDeck) {
            const value = await call(`/deck?path=${encodeURIComponent(path)}`)
            setDeck(value)
            deckRef.current = value
            setDoc(null)
            setSheet(null)
            docRef.current = null
            sheetRef.current = null
            setActiveSlide(0)
          } else if (isSheet) {
            const value = await call(`/sheet?path=${encodeURIComponent(path)}`)
            setSheet(value)
            sheetRef.current = value
            setDoc(null)
            setDeck(null)
            deckRef.current = null
            docRef.current = null
            setActiveSheet(0)
          } else {
            const value = await call(`/doc?path=${encodeURIComponent(path)}`)
            setDoc(value)
            docRef.current = value
            setSheet(null)
            setDeck(null)
            sheetRef.current = null
            deckRef.current = null
            setRev((r) => r + 1)
          }
          setDirty(false)
          setShowPicker(false)
          publish({ path: path })
          if (options.silent !== true) flash(`已打开 ${value.name}`)
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [flash])

      const save = useCallback(async () => {
        const current = docRef.current
        if (current === null) return
        setBusy(true)
        setError('')
        try {
          const value = await post('/doc', { path: current.path, model: current.model, baseHash: current.hash })
          const next = { ...current, hash: value.hash, bytes: value.bytes }
          setDoc(next)
          docRef.current = next
          setDirty(false)
          flash('已保存')
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [flash])

      const refresh = useCallback(async () => {
        const current = docRef.current
        if (current === null) return
        if (dirty && !window.confirm('有未保存的修改，刷新会丢掉它们。继续？')) return
        await load(current.path, { silent: true })
      }, [dirty, load])

      const listFiles = useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          const value = await call('/files')
          setFiles(value.files ?? [])
          setShowPicker(true)
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [])

      const createDeck = useCallback(async () => {
        const name = newName.trim()
        if (name === '') {
          setError('先写个文件名，例如 招新宣讲.pptx')
          return
        }
        const fileName = /\.pptx$/i.test(name) ? name : `${name}.pptx`
        setBusy(true)
        setError('')
        try {
          const value = await post('/new-deck', { path: fileName, title: '' })
          setNewName('')
          await load(value.path)
        } catch (failure) {
          setError(failure.message)
          setBusy(false)
        }
      }, [newName, load])

      // ---- 幻灯片编辑

      const saveDeck = useCallback(async () => {
        const current = deckRef.current
        if (current === null) return
        setBusy(true)
        setError('')
        try {
          const result = await post('/deck', {
            path: current.path,
            model: { slides: current.slides.map((slide) => ({ part: slide.part, shapes: slide.shapes })) },
            baseHash: current.hash,
          })
          const next = { ...current, hash: result.hash, bytes: result.bytes }
          setDeck(next)
          deckRef.current = next
          setDirty(false)
          flash('演示文稿已保存')
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [flash])

      const editParagraph = useCallback((slideIndex, shapeIndex, paragraphIndex, patch) => {
        setDeck((previous) => {
          if (previous === null) return previous
          const slides = previous.slides.map((slide, index) => {
            if (index !== slideIndex) return slide
            const shapes = slide.shapes.map((shape, sIndex) => {
              if (sIndex !== shapeIndex) return shape
              const paragraphs = shape.paragraphs.map((paragraph, pIndex) => (
                pIndex === paragraphIndex ? { ...paragraph, ...patch } : paragraph
              ))
              return { ...shape, paragraphs }
            })
            return { ...slide, shapes }
          })
          return { ...previous, slides }
        })
        markDirty()
      }, [markDirty])

      const addParagraph = useCallback((slideIndex, shapeIndex) => {
        setDeck((previous) => {
          if (previous === null) return previous
          const slides = previous.slides.map((slide, index) => {
            if (index !== slideIndex) return slide
            const shapes = slide.shapes.map((shape, sIndex) => (
              sIndex === shapeIndex
                ? { ...shape, paragraphs: [...shape.paragraphs, { text: '', level: 0 }] }
                : shape
            ))
            return { ...slide, shapes }
          })
          return { ...previous, slides }
        })
        markDirty()
      }, [markDirty])

      const deleteParagraph = useCallback((slideIndex, shapeIndex, paragraphIndex) => {
        setDeck((previous) => {
          if (previous === null) return previous
          const slides = previous.slides.map((slide, index) => {
            if (index !== slideIndex) return slide
            const shapes = slide.shapes.map((shape, sIndex) => {
              if (sIndex !== shapeIndex) return shape
              if (shape.paragraphs.length <= 1) return shape
              return { ...shape, paragraphs: shape.paragraphs.filter((_, pIndex) => pIndex !== paragraphIndex) }
            })
            return { ...slide, shapes }
          })
          return { ...previous, slides }
        })
        markDirty()
      }, [markDirty])

      const createSheet = useCallback(async () => {
        const name = newName.trim()
        if (name === '') {
          setError('先写个文件名，例如 报名表.xlsx')
          return
        }
        const fileName = /\.xlsx$/i.test(name) ? name : `${name}.xlsx`
        setBusy(true)
        setError('')
        try {
          const value = await post('/new-sheet', { path: fileName, sheetName: '' })
          setNewName('')
          await load(value.path)
        } catch (failure) {
          setError(failure.message)
          setBusy(false)
        }
      }, [newName, load])

      // ---- 表格编辑

      const saveSheet = useCallback(async () => {
        const current = sheetRef.current
        if (current === null) return
        setBusy(true)
        setError('')
        try {
          const result = await post('/sheet', {
            path: current.path,
            model: { sheets: current.sheets },
            baseHash: current.hash,
          })
          const next = { ...current, hash: result.hash, bytes: result.bytes }
          setSheet(next)
          sheetRef.current = next
          setDirty(false)
          flash('表格已保存')
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [flash])

      /** 改一个单元格：保留原样式下标；公式会被覆盖（表格里手改值就是这个意思）。 */
      const setCell = useCallback((sheetIndex, row, col, value) => {
        setSheet((previous) => {
          if (previous === null) return previous
          const sheets = previous.sheets.map((item, index) => {
            if (index !== sheetIndex) return item
            const rows = item.rows.map((line) => line.slice())
            while (rows.length <= row) rows.push([])
            const line = rows[row]
            while (line.length <= col) line.push(null)
            const existing = line[col]
            const text = String(value ?? '')
            line[col] = text === ''
              ? null
              : { v: text, ...(existing?.s !== undefined ? { s: existing.s } : {}) }
            return { ...item, rows, height: Math.max(item.height ?? 0, rows.length), width: Math.max(item.width ?? 0, col + 1) }
          })
          return { ...previous, sheets }
        })
        markDirty()
      }, [markDirty])

      const addRow = useCallback(() => {
        setSheet((previous) => {
          if (previous === null) return previous
          const sheets = previous.sheets.map((item, index) => {
            if (index !== activeSheet) return item
            const rows = item.rows.concat([Array.from({ length: item.width ?? 1 }, () => null)])
            return { ...item, rows, height: rows.length }
          })
          return { ...previous, sheets }
        })
        markDirty()
        setViewRows((n) => n + 1)
      }, [activeSheet, markDirty])

      const removeLastRow = useCallback(() => {
        setSheet((previous) => {
          if (previous === null) return previous
          const sheets = previous.sheets.map((item, index) => {
            if (index !== activeSheet) return item
            if (item.rows.length <= 1) return item
            const rows = item.rows.slice(0, -1)
            return { ...item, rows, height: rows.length }
          })
          return { ...previous, sheets }
        })
        markDirty()
      }, [activeSheet, markDirty])

      const addCol = useCallback(() => {
        setSheet((previous) => {
          if (previous === null) return previous
          const sheets = previous.sheets.map((item, index) => {
            if (index !== activeSheet) return item
            const rows = item.rows.map((line) => line.concat([null]))
            return { ...item, rows, width: (item.width ?? 1) + 1 }
          })
          return { ...previous, sheets }
        })
        markDirty()
        setViewCols((n) => n + 1)
      }, [activeSheet, markDirty])

      const createDoc = useCallback(async () => {
        const name = newName.trim()
        if (name === '') {
          setError('先写个文件名，例如 会议纪要.docx')
          return
        }
        const fileName = /\.docx$/i.test(name) ? name : `${name}.docx`
        setBusy(true)
        setError('')
        try {
          const value = await post('/new', { path: fileName, title: '' })
          setNewName('')
          await load(value.path)
        } catch (failure) {
          setError(failure.message)
          setBusy(false)
        }
      }, [newName, load])

      // ---- 首次进入：先列目录；被外壳塞了路径就跟过去

      useEffect(() => {
        void listFiles()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      useEffect(() => {
        const target = shared.path
        if (target === null) return
        const currentDoc = docRef.current
        const currentSheet = sheetRef.current
        const currentDeck = deckRef.current
        if (currentDoc !== null && currentDoc.path === target) return
        if (currentSheet !== null && currentSheet.path === target) return
        if (currentDeck !== null && currentDeck.path === target) return
        void load(target, { silent: true })
      }, [shared.path, load])

      // ---- 轮询：别人（模型）改了文件就自动跟上

      useEffect(() => {
        const timer = window.setInterval(async () => {
          const currentDoc = docRef.current
          const currentSheet = sheetRef.current
          const currentDeck = deckRef.current
          const current = currentDoc ?? currentSheet ?? currentDeck
          if (current === null || dirty || document.visibilityState !== 'visible') return
          try {
            const value = await call(`/stat?path=${encodeURIComponent(current.path)}`)
            if (value.hash !== current.hash) await load(current.path, { silent: true })
          } catch {
            /* 轮询失败不打扰用户 */
          }
        }, 4000)
        return () => window.clearInterval(timer)
      }, [dirty, load])

      // ---- 编辑处理

      const onInput = useCallback((index, element) => {
        const current = docRef.current
        if (current === null) return
        const block = current.model.blocks[index]
        if (block === undefined || block.type !== 'p') return
        block.runs = runsFromDom(element)
        markDirty()
      }, [markDirty])

      const commitParagraph = useCallback((index, nextRuns) => {
        const current = docRef.current
        if (current === null) return
        current.model.blocks[index].runs = nextRuns
        markDirty()
        setRev((r) => r + 1)
      }, [markDirty])

      const splitParagraph = useCallback((index, offset) => {
        const current = docRef.current
        if (current === null) return
        const block = current.model.blocks[index]
        if (block === undefined || block.type !== 'p') return
        const text = paragraphText(block)
        const format = cloneFormat(block.runs[0])
        const left = text.slice(0, offset)
        const right = text.slice(offset)
        block.runs = left === '' ? [] : [{ ...format, text: left }]
        const created = { type: 'p', kind: block.kind === 'list' ? 'list' : 'p', runs: right === '' ? [] : [{ ...format, text: right }] }
        current.model.blocks.splice(index + 1, 0, created)
        markDirty()
        pendingCaret.current = right === '' ? { index: index + 1, offset: 0 } : { index: index + 1, offset: 0 }
        setRev((r) => r + 1)
      }, [markDirty])

      const removeParagraph = useCallback((index) => {
        const current = docRef.current
        if (current === null) return
        const blocks = current.model.blocks
        if (blocks.length <= 1) return
        blocks.splice(index, 1)
        markDirty()
        pendingCaret.current = { index: Math.max(0, index - 1), offset: -1 }
        setRev((r) => r + 1)
      }, [markDirty])

      // 结构性改动后恢复光标
      useEffect(() => {
        const pending = pendingCaret.current
        if (pending === null) return
        pendingCaret.current = null
        const page = pageRef.current
        if (page === null) return
        const target = page.querySelector(`[data-ws-index="${pending.index}"][contenteditable]`)
        if (target === null) return
        target.focus()
        const range = document.createRange()
        range.selectNodeContents(target)
        if (pending.offset >= 0) {
          let remaining = pending.offset
          const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
          let node = walker.nextNode()
          let placed = false
          while (node !== null) {
            const length = node.nodeValue.length
            if (remaining <= length) {
              range.setStart(node, remaining)
              range.collapse(true)
              placed = true
              break
            }
            remaining -= length
            node = walker.nextNode()
          }
          if (!placed) range.collapse(false)
        } else {
          range.collapse(false)
        }
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }, [rev])

      const onKeyDown = useCallback((event, index, element) => {
        if (event.key === 'Enter' && event.shiftKey === false) {
          event.preventDefault()
          splitParagraph(index, caretOffset(element).offset)
          return
        }
        if (event.key === 'Backspace') {
          const { offset } = caretOffset(element)
          if (offset === 0) {
            const current = docRef.current
            const block = current?.model.blocks[index]
            if (block !== undefined && paragraphText(block) === '') {
              event.preventDefault()
              removeParagraph(index)
            }
          }
        }
      }, [splitParagraph, removeParagraph])

      // ---- 工具栏动作

      const withSelection = useCallback((action) => (event) => {
        event.preventDefault()
        action()
      }, [])

      const execCommand = useCallback((command) => {
        const page = pageRef.current
        const active = page === null ? null : page.querySelector('[contenteditable]:focus')
        if (active === null) {
          setError('先在正文里点一下，再把光标放到要改的文字上')
          return
        }
        document.execCommand(command, false)
        onInput(Number(active.dataset.wsIndex), active)
      }, [onInput])

      const setKind = useCallback((kind) => {
        const current = docRef.current
        const index = activeIndex.current
        if (current === null || index < 0) {
          setError('先在正文里点一段，再改段落类型')
          return
        }
        const block = current.model.blocks[index]
        if (block === undefined || block.type !== 'p') return
        block.kind = kind
        delete block.style
        markDirty()
        setRev((r) => r + 1)
      }, [markDirty])

      const setAlign = useCallback((align) => {
        const current = docRef.current
        const index = activeIndex.current
        if (current === null || index < 0) {
          setError('先在正文里点一段，再改对齐')
          return
        }
        const block = current.model.blocks[index]
        if (block === undefined || block.type !== 'p') return
        if (align === 'none') delete block.align
        else block.align = align
        markDirty()
        setRev((r) => r + 1)
      }, [markDirty])

      const appendTable = useCallback(() => {
        const current = docRef.current
        if (current === null) return
        const cols = 3
        const width = Math.floor(9360 / cols)
        current.model.blocks.push({
          type: 'table',
          grid: Array.from({ length: cols }, () => width),
          rows: Array.from({ length: 3 }, () => Array.from({ length: cols }, () => ({
            blocks: [{ type: 'p', kind: 'p', runs: [] }],
          }))),
        })
        markDirty()
        setRev((r) => r + 1)
        flash('已在文末插入 3×3 表格')
      }, [flash, markDirty])

      // ---- 渲染

      // html 快照只在 rev 变化时重算：打字时 React 不会把 contenteditable 的
      // innerHTML 重写一遍，光标才不会跳。
      const htmls = useMemo(() => {
        const current = docRef.current
        if (current === null) return []
        return current.model.blocks.map((block) => {
          if (block.type === 'p') return runsToHtml(block.runs)
          return block.rows.map((row) => row.map((cell) => {
            const text = cell.blocks
              .filter((b) => b.type === 'p')
              .map((b) => paragraphText(b))
              .join('\n')
            return runsToHtml(text === '' ? [] : [{ ...BASE_FORMAT, text }])
          }))
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [rev, doc?.hash])

      const status = busy ? '处理中…' : notice !== '' ? notice : dirty ? '未保存' : '已同步'

      // 文档与表格共用的「重新读一遍」
      const refreshAny = useCallback(() => {
        const target = sheetRef.current?.path ?? deckRef.current?.path ?? docRef.current?.path
        if (target === undefined) return
        if (dirty && !window.confirm('有未保存的修改，刷新会丢掉它们。继续？')) return
        void load(target, { silent: true })
      }, [dirty, load])

      const header = h('div', { className: 'ws-toolbar' },
        h('button', {
          type: 'button',
          className: 'ws-btn',
          disabled: busy,
          onClick: listFiles,
          title: '从协会数据目录里挑一个 Word 文档',
        }, '打开'),
        h('button', {
          type: 'button',
          className: 'ws-btn',
          disabled: busy || (doc === null && sheet === null && deck === null),
          onClick: () => (sheetRef.current !== null ? void saveSheet() : deckRef.current !== null ? void saveDeck() : save()),
          title: '写回文件（Ctrl+S）',
        }, '保存'),
        h('button', {
          type: 'button',
          className: 'ws-btn',
          disabled: busy || (doc === null && sheet === null && deck === null),
          onClick: refreshAny,
          title: '重新从磁盘读一遍',
        }, '刷新'),
        h('div', { className: 'ws-sep' }),
        h('select', {
          className: 'ws-select',
          onChange: (event) => { setKind(event.currentTarget.value); event.currentTarget.blur() },
          defaultValue: 'p',
          disabled: doc === null,
          title: '段落类型',
        }, KIND_OPTIONS.map(([value, label]) => h('option', { key: value, value }, label))),
        h('button', { type: 'button', className: 'ws-btn', disabled: doc === null, style: { fontWeight: 700 }, onMouseDown: withSelection(() => execCommand('bold')), title: '加粗' }, 'B'),
        h('button', { type: 'button', className: 'ws-btn', disabled: doc === null, style: { fontStyle: 'italic' }, onMouseDown: withSelection(() => execCommand('italic')), title: '斜体' }, 'I'),
        h('button', { type: 'button', className: 'ws-btn', disabled: doc === null, style: { textDecoration: 'underline' }, onMouseDown: withSelection(() => execCommand('underline')), title: '下划线' }, 'U'),
        h('button', { type: 'button', className: 'ws-btn', disabled: doc === null, style: { textDecoration: 'line-through' }, onMouseDown: withSelection(() => execCommand('strikeThrough')), title: '删除线' }, 'S'),
        h('div', { className: 'ws-sep' }),
        h('button', { type: 'button', className: 'ws-btn', disabled: doc === null, onMouseDown: withSelection(() => setAlign('left')), title: '左对齐' }, '左'),
        h('button', { type: 'button', className: 'ws-btn', disabled: doc === null, onMouseDown: withSelection(() => setAlign('center')), title: '居中' }, '中'),
        h('button', { type: 'button', className: 'ws-btn', disabled: doc === null, onMouseDown: withSelection(() => setAlign('right')), title: '右对齐' }, '右'),
        h('div', { className: 'ws-sep' }),
        h('button', { type: 'button', className: 'ws-btn', disabled: doc === null, onClick: appendTable, title: '在文末插入表格' }, '表格'),
        h('div', { className: 'ws-status' },
          h('span', { className: 'ws-dot', 'data-dirty': dirty ? 'true' : 'false' }),
          h('span', { className: 'ws-name', title: doc?.path ?? sheet?.path ?? deck?.path ?? '' },
            doc !== null ? doc.name : sheet !== null ? sheet.name : deck !== null ? deck.name : '未打开文件'),
          h('span', null, status),
        ),
      )

      // ---- 幻灯片模式：页列表 + 文字编辑（这一版只改字，不增删页）
      if (deck !== null) {
        const slides = deck.slides ?? []
        const slide = slides[activeSlide] ?? slides[0]
        const shapes = slide.shapes ?? []
        const titleShapeIndex = Math.max(0, shapes.findIndex((shape) => shape.placeholder === 'title' || shape.placeholder === 'ctrTitle'))
        const titleShape = shapes[titleShapeIndex]
        const bodyShapeIndex = shapes.findIndex((shape, index) => index !== titleShapeIndex)
        const bodyShape = bodyShapeIndex >= 0 ? shapes[bodyShapeIndex] : undefined

        const titleText = titleShape?.paragraphs?.[0]?.text ?? ''
        const bodyParagraphs = bodyShape?.paragraphs ?? []

        return h('div', { className: 'ws-root' },
          h('div', { className: 'ws-toolbar' },
            h('button', { type: 'button', className: 'ws-btn', disabled: busy, onClick: listFiles, title: '换一个文件' }, '打开'),
            h('button', { type: 'button', className: 'ws-btn ws-btn-primary', disabled: busy, onClick: () => void saveDeck() }, '保存'),
            h('button', { type: 'button', className: 'ws-btn', disabled: busy, onClick: refreshAny }, '刷新'),
            h('div', { className: 'ws-sep' }),
            h('button', {
              type: 'button', className: 'ws-btn', disabled: activeSlide === 0,
              onClick: () => setActiveSlide((n) => Math.max(0, n - 1)),
            }, '上一页'),
            h('span', { className: 'ws-hint' }, `第 ${activeSlide + 1} / ${slides.length} 页`),
            h('button', {
              type: 'button', className: 'ws-btn', disabled: activeSlide >= slides.length - 1,
              onClick: () => setActiveSlide((n) => Math.min(slides.length - 1, n + 1)),
            }, '下一页'),
            h('div', { className: 'ws-status' },
              h('span', { className: 'ws-dot', 'data-dirty': dirty ? 'true' : 'false' }),
              h('span', { className: 'ws-name', title: deck.path }, deck.name),
              h('span', null, status),
            ),
          ),
          error !== '' ? h('div', { className: 'ws-error' }, error) : null,
          h('div', { className: 'ws-deck-body' },
            h('div', { className: 'ws-deck-list' },
              slides.map((item, index) => h('button', {
                key: index,
                type: 'button',
                className: 'ws-deck-thumb',
                'data-active': index === activeSlide ? 'true' : 'false',
                onClick: () => setActiveSlide(index),
              },
              h('span', { className: 'ws-deck-no' }, String(index + 1)),
              h('span', { className: 'ws-deck-title' }, item.title === '' ? '（无标题）' : item.title))),
            ),
            h('div', { className: 'ws-deck-editor' },
              h('div', { className: 'ws-deck-row' },
                h('span', { className: 'ws-hint', style: { flex: '0 0 auto' } }, '标题'),
                h('input', {
                  className: 'ws-input',
                  value: titleText,
                  placeholder: '这一页的标题',
                  onChange: (event) => editParagraph(activeSlide, titleShapeIndex, 0, { text: event.currentTarget.value }),
                }),
              ),
              h('div', { className: 'ws-deck-section' }, '正文'),
              bodyShape === undefined
                ? h('div', { className: 'ws-hint' }, '这一页没有正文占位符，只能改标题。')
                : h('div', null,
                  bodyParagraphs.map((paragraph, pIndex) => h('div', { key: pIndex, className: 'ws-deck-row' },
                    h('select', {
                      className: 'ws-select',
                      style: { flex: '0 0 62px' },
                      value: String(paragraph.level ?? 0),
                      onChange: (event) => editParagraph(activeSlide, bodyShapeIndex, pIndex, { level: Number(event.currentTarget.value) }),
                      title: '缩进层级',
                    }, [0, 1, 2, 3, 4].map((level) => h('option', { key: level, value: String(level) }, level === 0 ? '•' : '—'.repeat(level)))),
                    h('input', {
                      className: 'ws-input',
                      value: paragraph.text,
                      placeholder: '一条要点',
                      onChange: (event) => editParagraph(activeSlide, bodyShapeIndex, pIndex, { text: event.currentTarget.value }),
                    }),
                    h('button', {
                      type: 'button',
                      className: 'ws-btn',
                      style: { flex: '0 0 auto' },
                      disabled: bodyParagraphs.length <= 1,
                      title: '删掉这段',
                      onClick: () => deleteParagraph(activeSlide, bodyShapeIndex, pIndex),
                    }, '×'),
                  )),
                  h('div', { style: { marginTop: 6 } },
                    h('button', { type: 'button', className: 'ws-btn', onClick: () => addParagraph(activeSlide, bodyShapeIndex) }, '+ 加一条要点')),
                ),
            ),
          ),
          h('div', { className: 'ws-sheet-foot' },
            `共 ${slides.length} 页 · 这一版只改文字（标题与要点），不增删页；图片与图表原样保留`),
        )
      }

      // ---- 表格模式：网格编辑器（docx 的纸页渲染在这里让位）
      if (sheet !== null) {
        const current = sheet.sheets[activeSheet] ?? sheet.sheets[0]
        const showRows = Math.min(current.rows.length, viewRows)
        const showCols = Math.min(current.width, viewCols)
        const rows = []
        for (let r = 0; r < showRows; r += 1) {
          const cells = [h('th', { key: 'n', className: 'ws-rownum' }, String(r + 1))]
          for (let c = 0; c < showCols; c += 1) {
            const cell = current.rows[r]?.[c] ?? null
            cells.push(h('td', { key: c },
              h('input', {
                className: 'ws-cell',
                value: cell?.v ?? '',
                ...(cell?.f ? { title: `=${cell.f}` } : {}),
                onChange: (event) => setCell(activeSheet, r, c, event.currentTarget.value),
              })))
          }
          rows.push(h('tr', { key: r }, cells))
        }
        return h('div', { className: 'ws-root' },
          h('div', { className: 'ws-toolbar' },
            h('button', { type: 'button', className: 'ws-btn', disabled: busy, onClick: listFiles, title: '换一个文件' }, '打开'),
            h('button', { type: 'button', className: 'ws-btn ws-btn-primary', disabled: busy, onClick: () => void saveSheet() }, '保存'),
            h('button', { type: 'button', className: 'ws-btn', disabled: busy, onClick: refreshAny }, '刷新'),
            h('div', { className: 'ws-sep' }),
            sheet.sheets.length > 1
              ? h('select', {
                className: 'ws-select',
                value: String(activeSheet),
                onChange: (event) => setActiveSheet(Number(event.currentTarget.value)),
              }, sheet.sheets.map((item, index) => h('option', { key: index, value: String(index) }, item.name)))
              : h('span', { className: 'ws-hint' }, current.name),
            h('button', { type: 'button', className: 'ws-btn', disabled: busy, onClick: addRow, title: '在末尾加一行' }, '+ 行'),
            h('button', { type: 'button', className: 'ws-btn', disabled: busy, onClick: removeLastRow, title: '删掉最后一行' }, '− 行'),
            h('button', { type: 'button', className: 'ws-btn', disabled: busy, onClick: addCol, title: '在末尾加一列' }, '+ 列'),
            h('div', { className: 'ws-sep' }),
            h('button', { type: 'button', className: 'ws-btn', onClick: () => setViewRows((n) => n + 30) }, '更多行'),
            h('button', { type: 'button', className: 'ws-btn', onClick: () => setViewCols((n) => n + 10) }, '更多列'),
            h('div', { className: 'ws-status' },
              h('span', { className: 'ws-dot', 'data-dirty': dirty ? 'true' : 'false' }),
              h('span', { className: 'ws-name', title: sheet.path }, sheet.name),
              h('span', null, status),
            ),
          ),
          error !== '' ? h('div', { className: 'ws-error' }, error) : null,
          h('div', { className: 'ws-sheet-canvas' },
            h('table', { className: 'ws-sheet' },
              h('thead', null, h('tr', null,
                h('th', { className: 'ws-rownum' }, ''),
                Array.from({ length: showCols }, (_, c) => h('th', { key: c }, colName(c))),
              )),
              h('tbody', null, rows),
            ),
          ),
          h('div', { className: 'ws-sheet-foot' },
            `${current.width} 列 × ${current.rows.length} 行 · 正在显示前 ${showRows} × ${showCols}` +
            ' · 手改一个格子会覆盖它原有的公式（公式仍在 tooltip 里可见）'),
        )
      }

      if (doc === null) {
        return h('div', { className: 'ws-root' },
          header,
          error !== '' ? h('div', { className: 'ws-error' }, error) : null,
          h('div', { className: 'ws-empty' },
            h('h3', null, '办公'),
            h('div', { className: 'ws-hint' },
              '协会的文档与表格都在这儿改 —— 直接改字、直接改格子，保存回真正的 .docx / .xlsx，不需要 WPS 或 Office。'),
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' } },
              h('input', {
                className: 'ws-input',
                placeholder: '新文件名，例如 会议纪要（自动补 .docx）',
                value: newName,
                onChange: (event) => setNewName(event.currentTarget.value),
                onKeyDown: (event) => { if (event.key === 'Enter') void createDoc() },
              }),
              h('button', { type: 'button', className: 'ws-btn ws-btn-primary', disabled: busy, onClick: () => void createDoc() }, '新建文档'),
              h('button', {
                type: 'button',
                className: 'ws-btn',
                disabled: busy,
                onClick: () => void createSheet(),
                title: '同名会自动补 .xlsx',
              }, '新建表格'),
              h('button', {
                type: 'button',
                className: 'ws-btn',
                disabled: busy,
                onClick: () => void createDeck(),
                title: '同名会自动补 .pptx',
              }, '新建演示文稿'),
            ),
            h('button', { type: 'button', className: 'ws-btn', disabled: busy, onClick: listFiles }, '浏览已有文件'),
            files.length > 0
              ? h('div', { className: 'ws-filelist' }, files.map((file) => h('button', {
                key: file.path,
                type: 'button',
                className: 'ws-filerow',
                onClick: () => void load(file.path),
              }, h('span', null, `${file.name}${file.kind === 'xlsx' ? '  ·表格' : ''}`), h('span', null, `${Math.round(file.bytes / 1024)} KB`))))
              : null,
          ),
        )
      }

      const page = h('div', { className: 'ws-page', ref: pageRef },
        doc.model.blocks.map((block, index) => {
          if (block.type === 'p') {
            return h('div', {
              key: `${rev}:${index}`,
              className: 'ws-p',
              'data-kind': block.kind,
              'data-ws-index': index,
              contentEditable: true,
              suppressContentEditableWarning: true,
              spellCheck: false,
              style: block.align === undefined ? undefined : { textAlign: block.align },
              onInput: (event) => onInput(index, event.currentTarget),
              onKeyDown: (event) => onKeyDown(event, index, event.currentTarget),
              onFocus: () => { activeIndex.current = index },
              dangerouslySetInnerHTML: { __html: htmls[index] ?? '<br>' },
            })
          }
          const cells = htmls[index] ?? []
          return h('table', { key: `${rev}:${index}`, className: 'ws-table' },
            h('tbody', null, block.rows.map((row, rowIndex) => h('tr', { key: rowIndex },
              row.map((cell, colIndex) => h('td', {
                key: colIndex,
                colSpan: cell.span > 1 ? cell.span : undefined,
                contentEditable: true,
                suppressContentEditableWarning: true,
                spellCheck: false,
                onInput: (event) => {
                  const current = docRef.current
                  if (current === null) return
                  const table = current.model.blocks[index]
                  const target = table.rows[rowIndex][colIndex]
                  target.blocks = [{ type: 'p', kind: 'p', runs: runsFromDom(event.currentTarget) }]
                  markDirty()
                },
                dangerouslySetInnerHTML: { __html: cells[colIndex] ?? runsToHtml([]) },
              })),
            ))),
          )
        }),
      )

      return h('div', { className: 'ws-root' },
        header,
        error !== '' ? h('div', { className: 'ws-error' }, error) : null,
        showPicker
          ? h('div', { style: { padding: '8px' } },
            h('div', { className: 'ws-filelist', style: { maxWidth: '100%', maxHeight: '220px' } },
              files.length === 0
                ? h('div', { className: 'ws-filerow' }, h('span', null, '这个目录里没有 .docx'))
                : files.map((file) => h('button', {
                  key: file.path,
                  type: 'button',
                  className: 'ws-filerow',
                  onClick: () => void load(file.path),
                }, h('span', null, file.name), h('span', null, `${Math.round(file.bytes / 1024)} KB`))),
            ),
            h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
              h('button', { type: 'button', className: 'ws-btn', onClick: () => setShowPicker(false) }, '收起'),
              h('button', { type: 'button', className: 'ws-btn', onClick: () => void load(doc.path) }, '重载当前文件'),
            ),
          )
          : null,
        h('div', { className: 'ws-canvas' }, page),
      )
    }

    // ------------------------------------------------------------ 入口按钮

    function makeOpenButton(ctx) {
      return function WpsOpenButton() {
        return h('button', {
          type: 'button',
          className: 'ws-btn',
          title: '打开办公面板（Word 文档）',
          style: { marginLeft: 4 },
          onClick: () => {
            ensureStyle()
            ctx.sidebarRight.openTab(KIND)
          },
        }, '办公')
      }
    }

    // ------------------------------------------------------------ 注册

    function apply(ctx) {
      ensureStyle()

      // 工作坊外壳的「办公」视图要能直接点开某一份文件。
      // 跨插件只暴露这一个函数：不动 DOM、不共享状态机，拿不到就自己开面板。
      if (typeof window !== 'undefined') {
        window.__NJAU_OPEN_OFFICE__ = (path) => {
          if (typeof path === 'string' && path !== '') publish({ path })
          ctx.sidebarRight.openTab(KIND)
        }
        ctx.effect(() => () => {
          if (window.__NJAU_OPEN_OFFICE__ !== undefined) delete window.__NJAU_OPEN_OFFICE__
        }, 'njau-office: window hook')
      }

      ctx.inject(['slots', 'sidebarRight', 'sidebarRightTabs'], (scope) => {
        scope.effect(() => scope.sidebarRightTabs.register({
          id: TAB_ID,
          kind: KIND,
          priority: 'extension',
          title: () => '办公',
        }), 'njau-office: tab type')

        scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
        }, WpsDocumentTab))

        scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: TAB_ID,
        }, function WpsTitle() {
          const shared = usePanelState()
          const name = shared.path === null ? '办公' : String(shared.path).split(/[\\/]/).pop()
          return h('span', { title: shared.path ?? '' }, name)
        }))

        scope.slots.inject('conversation.session.header.utilities', () => scope.slots.register({
          name: 'conversation.session.header.utilities',
          id: TAB_ID,
          order: 60,
        }, makeOpenButton(ctx)))
      })
    }

    exports.name = 'njau-office'
    exports.inject = []
    exports.apply = apply
    module.exports = exports
    return module.exports
  },
})
