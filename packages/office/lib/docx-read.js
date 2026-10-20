/**
 * docx-read.js -- .docx -> 文档模型。
 *
 * 目标不是 100% 保真地「读懂 Word」，而是：
 *   1. 让人和 agent 都能按「段落 / 文字片段 / 表格单元格」定位到内容；
 *   2. 把没建模的排版 XML（w:pPr / w:rPr / w:sectPr）原样带走，
 *      写回时直接还原，所以编号、缩进、行距、页面尺寸不会被我们改坏。
 *
 * 只解析 word/document.xml 与 word/styles.xml。图片、脚注、域、批注
 * 目前不建模：它们存在于包里、写回时也还在（我们只替换 document.xml 里
 * 我们负责的部分），但界面上看不到。
 */

import { readZip } from './zip.js'
import {
  attr,
  childrenOf,
  firstChild,
  parseXml,
  serializeNode,
  textOf,
} from './xml.js'

/** 常见段落样式名 -> 语义 kind。Word 中文版的「标题 1」也吃。 */
function kindFromStyleName(name) {
  if (name === undefined) return undefined
  const n = name.trim().toLowerCase()
  if (n === 'title' || n === '标题') return 'title'
  if (n === 'subtitle' || n === '副标题') return 'subtitle'
  const heading = /^(heading|标题)\s*([1-9])$/.exec(n)
  if (heading !== null) return `h${heading[2]}`
  if (n === 'normal' || n === '正文') return 'p'
  if (n === 'quote' || n === '引用') return 'quote'
  return undefined
}

/** 解析 styles.xml：styleId -> { name, kind }，并给出 kind -> 首选 styleId。 */
function parseStyles(xmlText) {
  const byId = new Map()
  const preferred = new Map()
  if (typeof xmlText !== 'string' || xmlText === '') return { byId, preferred }

  const roots = parseXml(xmlText)
  const walk = (node) => {
    for (const child of node.children) {
      if (typeof child === 'string') continue
      if (child.local === 'style') {
        const type = attr(child, 'type')
        const styleId = attr(child, 'styleId')
        if (type === 'paragraph' && styleId !== undefined) {
          const nameNode = firstChild(child, 'name')
          const name = nameNode === undefined ? undefined : attr(nameNode, 'val')
          const kind = kindFromStyleName(name)
          byId.set(styleId, { name: name ?? styleId, kind })
          if (kind !== undefined && !preferred.has(kind)) preferred.set(kind, styleId)
        }
      }
      walk(child)
    }
  }
  for (const root of roots) {
    if (typeof root !== 'string') walk(root)
  }
  return { byId, preferred }
}

/** 读 w:rPr，返回「结构化 + 原始 XML」两部分。 */
function parseRunProps(rPr) {
  // 布尔一律写成显式 false：写回时模型是唯一权威，否则「取消加粗」会失效。
  const props = { bold: false, italic: false, underline: false, strike: false, caps: false }
  if (rPr === undefined) return props
  props.raw = serializeNode(rPr)

  const on = (name) => {
    const node = firstChild(rPr, name)
    if (node === undefined) return false
    const val = attr(node, 'val')
    if (val === undefined) return true
    return !(val === '0' || val === 'false' || val === 'none')
  }

  props.bold = on('b')
  props.italic = on('i')
  props.underline = on('u')
  props.strike = on('strike')
  props.caps = on('caps')

  const sz = firstChild(rPr, 'sz')
  if (sz !== undefined) {
    const val = Number.parseInt(attr(sz, 'val') ?? '', 10)
    if (Number.isFinite(val)) props.size = val / 2
  }
  const color = firstChild(rPr, 'color')
  if (color !== undefined) {
    const val = attr(color, 'val')
    if (val !== undefined && /^[0-9a-fA-F]{6}$/.test(val)) props.color = val.toLowerCase()
  }
  const fonts = firstChild(rPr, 'rFonts')
  if (fonts !== undefined) {
    const ascii = attr(fonts, 'ascii') ?? attr(fonts, 'hAnsi')
    if (ascii !== undefined) props.font = ascii
  }
  const highlight = firstChild(rPr, 'highlight')
  if (highlight !== undefined) {
    const val = attr(highlight, 'val')
    if (val !== undefined) props.highlight = val
  }
  return props
}

function parseParagraph(node) {
  const pPr = firstChild(node, 'pPr')
  const runs = []
  let kind
  let style
  let align
  let level
  let numId

  if (pPr !== undefined) {
    const pStyle = firstChild(pPr, 'pStyle')
    if (pStyle !== undefined) style = attr(pStyle, 'val')
    const jc = firstChild(pPr, 'jc')
    if (jc !== undefined) {
      const val = attr(jc, 'val')
      if (val === 'left' || val === 'center' || val === 'right' || val === 'both') {
        align = val === 'both' ? 'justify' : val
      }
    }
    const numPr = firstChild(pPr, 'numPr')
    if (numPr !== undefined) {
      const ilvl = firstChild(numPr, 'ilvl')
      level = ilvl === undefined ? 0 : Number.parseInt(attr(ilvl, 'val') ?? '0', 10)
      const num = firstChild(numPr, 'numId')
      if (num !== undefined) {
        const parsed = Number.parseInt(attr(num, 'val') ?? '', 10)
        if (Number.isFinite(parsed)) numId = parsed
      }
      kind = 'list'
    }
    const outline = firstChild(pPr, 'outlineLvl')
    if (outline !== undefined && kind === undefined) {
      const val = Number.parseInt(attr(outline, 'val') ?? '', 10)
      if (Number.isFinite(val) && val >= 0 && val <= 8) kind = `h${val + 1}`
    }
  }

  for (const child of node.children) {
    if (typeof child === 'string') continue
    if (child.local === 'r') {
      const props = parseRunProps(firstChild(child, 'rPr'))
      let text = ''
      for (const part of child.children) {
        if (typeof part === 'string') continue
        if (part.local === 't') text += textOf(part)
        else if (part.local === 'tab') text += '\t'
        else if (part.local === 'br' || part.local === 'cr') text += '\n'
        else if (part.local === 'sym') text += '·'
      }
      if (text === '') continue
      runs.push({ text, ...props })
    } else if (child.local === 'hyperlink') {
      // 超链接里的文字照样读出来，只是丢掉链接目标。
      for (const inner of childrenOf(child, 'r')) {
        const props = parseRunProps(firstChild(inner, 'rPr'))
        const text = textOf(inner)
        if (text !== '') runs.push({ text, ...props })
      }
    }
  }

  const paragraph = { type: 'p', kind: kind ?? 'p', runs }
  if (style !== undefined) paragraph.style = style
  if (align !== undefined) paragraph.align = align
  if (level !== undefined) paragraph.level = level
  if (numId !== undefined) paragraph.numId = numId
  if (pPr !== undefined) paragraph.rawPPr = serializeNode(pPr)
  return paragraph
}

function parseTable(node) {
  const grid = []
  const tblGrid = firstChild(node, 'tblGrid')
  if (tblGrid !== undefined) {
    for (const col of childrenOf(tblGrid, 'gridCol')) {
      const w = Number.parseInt(attr(col, 'w') ?? '', 10)
      if (Number.isFinite(w) && w > 0) grid.push(w)
    }
  }

  const rows = []
  for (const tr of childrenOf(node, 'tr')) {
    const cells = []
    for (const tc of childrenOf(tr, 'tc')) {
      const blocks = []
      for (const child of childrenOf(tc)) {
        if (child.local === 'p') blocks.push(parseParagraph(child))
        else if (child.local === 'tbl') blocks.push(parseTable(child))
      }
      const cell = { blocks: blocks.length > 0 ? blocks : [{ type: 'p', kind: 'p', runs: [] }] }
      const tcPr = firstChild(tc, 'tcPr')
      if (tcPr !== undefined) {
        const span = firstChild(tcPr, 'gridSpan')
        if (span !== undefined) {
          const val = Number.parseInt(attr(span, 'val') ?? '1', 10)
          if (Number.isFinite(val) && val > 1) cell.span = val
        }
      }
      cells.push(cell)
    }
    rows.push(cells)
  }

  const table = { type: 'table', rows }
  if (grid.length > 0) table.grid = grid
  const tblPr = firstChild(node, 'tblPr')
  if (tblPr !== undefined) table.rawTblPr = serializeNode(tblPr)
  return table
}

function parseBody(documentXml) {
  const roots = parseXml(documentXml)
  let body
  const findBody = (node) => {
    if (body !== undefined) return
    if (node.local === 'body') {
      body = node
      return
    }
    for (const child of node.children) if (typeof child !== 'string') findBody(child)
  }
  for (const root of roots) {
    if (typeof root !== 'string') findBody(root)
  }
  if (body === undefined) throw new Error('docx: document.xml 里找不到 <w:body>')

  const blocks = []
  let sectPr
  for (const child of body.children) {
    if (typeof child === 'string') continue
    if (child.local === 'p') blocks.push(parseParagraph(child))
    else if (child.local === 'tbl') blocks.push(parseTable(child))
    else if (child.local === 'sectPr') sectPr = serializeNode(child)
  }
  return { blocks, sectPr }
}

/**
 * 读一个 .docx。
 * @param {Buffer} buffer
 * @returns {object} 文档模型
 */
export function readDocx(buffer) {
  const { entries } = readZip(buffer)
  const documentXml = entries.get('word/document.xml')
  if (documentXml === undefined) throw new Error('docx: 包里没有 word/document.xml，可能不是 Word 文档')

  const stylesXml = entries.get('word/styles.xml')
  const styles = parseStyles(stylesXml === undefined ? '' : stylesXml.toString('utf8'))
  const { blocks, sectPr } = parseBody(documentXml.toString('utf8'))

  const annotate = (list) => {
    for (const block of list) {
      if (block.type === 'p') {
        const info = block.style === undefined ? undefined : styles.byId.get(block.style)
        const kind = info === undefined ? undefined : info.kind
        if (block.kind === 'p' && kind !== undefined) block.kind = kind
      } else if (block.type === 'table') {
        for (const row of block.rows) for (const cell of row) annotate(cell.blocks)
      }
    }
  }
  annotate(blocks)

  return {
    type: 'doc',
    blocks,
    ...(sectPr === undefined ? {} : { sectPr }),
    /** 写回时用的样式首选表：kind -> styleId，来自原文档自己的 styles.xml。 */
    styleIds: Object.fromEntries(styles.preferred),
    /** 原包里的部件清单，界面上可以据此提示「图片等存在但未显示」。 */
    parts: [...entries.keys()].sort(),
  }
}

/** 只要文字：给 agent 看的大纲 / 纯文本视图。 */
export function docToText(model) {
  const lines = []
  const cellText = (blocks) => {
    const parts = []
    for (const block of blocks) {
      if (block.type === 'p') parts.push(block.runs.map((r) => r.text).join(''))
      else if (block.type === 'table') {
        for (const row of block.rows) parts.push(row.map((c) => cellText(c.blocks)).join(' / '))
      }
    }
    return parts.join(' ').trim()
  }
  for (const block of model.blocks ?? []) {
    if (block.type === 'p') {
      const text = block.runs.map((r) => r.text).join('')
      const indent = block.kind === 'list' ? '  '.repeat(block.level ?? 0) + '- ' : ''
      lines.push(indent + text)
    } else if (block.type === 'table') {
      for (const row of block.rows) {
        lines.push('| ' + row.map((cell) => cellText(cell.blocks)).join(' | ') + ' |')
      }
    }
  }
  return lines.join('\n')
}
