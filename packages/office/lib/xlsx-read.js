/**
 * xlsx-read.js —— .xlsx → 表格模型。
 *
 * xlsx 和 docx 一样是「ZIP + XML」，但结构更规整：一个工作簿（workbook.xml）
 * 挂着若干工作表（worksheets/sheetN.xml），单元格要么内联字符串，
 * 要么是共享字符串表（sharedStrings.xml）里的下标。
 *
 * 建模原则与 docx 一致：**只建我们不认识的之外的部分，剩下的原样带走**。
 * 列宽、冻结窗格、合并单元格都抓成原始 XML 存着，写回时直接还原；
 * 条件格式、数据校验、图表、图片不建模，但也不破坏（只重建 sheetXML 的正文）。
 */

import { readZip } from './zip.js'
import { attr, childrenOf, firstChild, parseXml, serializeNode, textOf } from './xml.js'

const MAX_ROWS = 5000
const MAX_COLS = 64

/** "AB12" → { col: 27, row: 11 }（都从 0 开始）。 */
export function parseRef(ref) {
  const matched = /^([A-Z]+)(\d+)$/i.exec(String(ref ?? '').trim())
  if (matched === null) return null
  let col = 0
  for (const ch of matched[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col: col - 1, row: Number(matched[2]) - 1 }
}

/** 列号 → 字母（0 → A，25 → Z，26 → AA）。 */
export function colName(col) {
  let name = ''
  let n = col + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

export function cellRef(col, row) {
  return `${colName(col)}${row + 1}`
}

/** 共享字符串表：每个 <si> 可能由多个 <r><t> 组成。 */
function parseSharedStrings(xmlText) {
  if (typeof xmlText !== 'string' || xmlText === '') return []
  const roots = parseXml(xmlText)
  const values = []
  const walk = (node) => {
    for (const child of node.children) {
      if (typeof child === 'string') continue
      if (child.local === 'si') values.push(textOf(child))
      else walk(child)
    }
  }
  for (const root of roots) {
    if (typeof root !== 'string') walk(root)
  }
  return values
}

/** workbook.xml + rels → 工作表清单（name / part 路径）。 */
function parseWorkbook(entries) {
  const workbookXml = entries.get('xl/workbook.xml')
  if (workbookXml === undefined) throw new Error('xlsx: 包里没有 xl/workbook.xml')

  const relsXml = entries.get('xl/_rels/workbook.xml.rels')
  const rels = new Map()
  if (relsXml !== undefined) {
    const roots = parseXml(relsXml.toString('utf8'))
    const walk = (node) => {
      for (const child of node.children) {
        if (typeof child === 'string') continue
        if (child.local === 'Relationship') {
          const id = attr(child, 'Id')
          const target = attr(child, 'Target')
          if (id !== undefined && target !== undefined) rels.set(id, target)
        }
        walk(child)
      }
    }
    for (const root of roots) {
      if (typeof root !== 'string') walk(root)
    }
  }

  const sheets = []
  const roots = parseXml(workbookXml.toString('utf8'))
  const walk = (node) => {
    for (const child of node.children) {
      if (typeof child === 'string') continue
      if (child.local === 'sheet') {
        const name = attr(child, 'name') ?? `Sheet${sheets.length + 1}`
        // r:id 才是关系引用；sheetId 是另一回事（曾经踩过取错属性的坑）。
        const relId = attr(child, 'r:id') ?? attr(child, 'rId')
        const target = relId === undefined ? undefined : rels.get(relId)
        const part = target === undefined
          ? `xl/worksheets/sheet${sheets.length + 1}.xml`
          : (target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`)
        sheets.push({ name, part })
      }
      walk(child)
    }
  }
  for (const root of roots) {
    if (typeof root !== 'string') walk(root)
  }
  if (sheets.length === 0) throw new Error('xlsx: workbook.xml 里没有工作表')
  return sheets
}

/** 一个单元格 → { v, f, s, t }（v 一律是字符串，保留原始类型 t）。 */
function parseCell(node, sharedStrings) {
  const ref = parseRef(attr(node, 'r'))
  const t = attr(node, 't')
  const s = attr(node, 's')
  const formula = firstChild(node, 'f')
  let value = ''

  if (t === 'inlineStr') {
    const is = firstChild(node, 'is')
    value = is === undefined ? '' : textOf(is)
  } else {
    const v = firstChild(node, 'v')
    const raw = v === undefined ? '' : textOf(v)
    if (t === 's') {
      const index = Number.parseInt(raw, 10)
      value = Number.isFinite(index) ? (sharedStrings[index] ?? '') : ''
    } else {
      value = raw
    }
  }

  const cell = { v: value }
  if (t !== undefined && t !== 'n') cell.t = t
  if (formula !== undefined) cell.f = textOf(formula)
  if (s !== undefined && s !== '0') cell.s = s
  return { ref, cell }
}

function parseSheet(part, xmlText, sharedStrings) {
  const roots = parseXml(xmlText)
  let sheetData
  let sheetViews
  let cols
  let merges = []
  let dimension

  const walk = (node) => {
    for (const child of node.children) {
      if (typeof child === 'string') continue
      if (child.local === 'sheetData') sheetData = child
      else if (child.local === 'sheetViews') sheetViews = serializeNode(child)
      else if (child.local === 'cols') cols = serializeNode(child)
      else if (child.local === 'mergeCell') {
        const ref = attr(child, 'ref')
        if (ref !== undefined) merges.push(ref)
      } else if (child.local === 'dimension') {
        dimension = attr(child, 'ref')
      }
      walk(child)
    }
  }
  for (const root of roots) {
    if (typeof root !== 'string') walk(root)
  }
  if (sheetData === undefined) throw new Error(`xlsx: ${part} 里没有 sheetData`)

  const rows = []
  let maxCol = 0
  let maxRow = 0
  let truncated = false

  for (const rowNode of childrenOf(sheetData, 'row')) {
    const rowIndexAttr = Number.parseInt(attr(rowNode, 'r') ?? '', 10)
    const rowIndex = Number.isFinite(rowIndexAttr) ? rowIndexAttr - 1 : rows.length
    if (rowIndex >= MAX_ROWS) {
      truncated = true
      continue
    }
    const row = rows[rowIndex] ?? []
    for (const cellNode of childrenOf(rowNode, 'c')) {
      const parsed = parseCell(cellNode, sharedStrings)
      const ref = parsed.ref ?? { col: row.length, row: rowIndex }
      if (ref.col >= MAX_COLS) {
        truncated = true
        continue
      }
      row[ref.col] = parsed.cell
      maxCol = Math.max(maxCol, ref.col)
      maxRow = Math.max(maxRow, rowIndex)
    }
    rows[rowIndex] = row
  }

  // 补成规整矩形：编辑器与 agent 都不该处理「洞」
  const height = Math.min(MAX_ROWS, Math.max(maxRow + 1, rows.length, 1))
  const width = Math.min(MAX_COLS, Math.max(maxCol + 1, 1))
  const grid = []
  for (let r = 0; r < height; r += 1) {
    const source = rows[r] ?? []
    const line = []
    for (let c = 0; c < width; c += 1) line.push(source[c] ?? null)
    grid.push(line)
  }

  return {
    rows: grid,
    width,
    height,
    ...(dimension === undefined ? {} : { dimension }),
    ...(sheetViews === undefined ? {} : { rawSheetViews: sheetViews }),
    ...(cols === undefined ? {} : { rawCols: cols }),
    ...(merges.length > 0 ? { merges } : {}),
    ...(truncated ? { truncated } : {}),
  }
}

/**
 * 读一个 .xlsx。
 * @param {Buffer} buffer
 * @returns {{ sheets: Array<object>, parts: string[] }}
 */
export function readXlsx(buffer) {
  const { entries } = readZip(buffer)
  const sharedStrings = parseSharedStrings(
    entries.get('xl/sharedStrings.xml')?.toString('utf8') ?? '',
  )
  const list = parseWorkbook(entries)
  const sheets = list.map((sheet) => {
    const part = entries.get(sheet.part)
    if (part === undefined) throw new Error(`xlsx: 找不到工作表部件 ${sheet.part}`)
    const parsed = parseSheet(sheet.part, part.toString('utf8'), sharedStrings)
    return { name: sheet.name, part: sheet.part, ...parsed }
  })
  return { sheets, parts: [...entries.keys()].sort() }
}

/** 纯文本视图：给 agent 看的表格（制表符分隔，带行列号）。 */
export function sheetToText(sheet, options = {}) {
  const maxRows = Number.isInteger(options.maxRows) ? options.maxRows : 200
  const maxCols = Number.isInteger(options.maxCols) ? options.maxCols : sheet.width
  const lines = []
  for (let r = 0; r < Math.min(sheet.rows.length, maxRows); r += 1) {
    const cells = []
    for (let c = 0; c < Math.min(sheet.width, maxCols); c += 1) {
      const cell = sheet.rows[r][c]
      cells.push(cell === null || cell === undefined ? '' : String(cell.v ?? ''))
    }
    lines.push(`${r + 1}\t${cells.join('\t')}`)
  }
  if (sheet.rows.length > maxRows) lines.push(`… 还有 ${sheet.rows.length - maxRows} 行未显示`)
  return lines.join('\n')
}
