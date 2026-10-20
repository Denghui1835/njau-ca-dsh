/**
 * xlsx-write.js —— 表格模型 → .xlsx。
 *
 * 与 docx 同一套路：**只重建我们建模的部分**。写回时按原来每个工作表的
 * 部件路径替换 sheet XML，其余部件（样式表、主题、sharedStrings、图片、图表）
 * 原样搬过去。所以「改一个单元格」不会顺手把别人的格式、数据校验、图表清掉。
 *
 * 单元格写回策略：
 *   - 有公式：写 <f>，能算就带缓存值 <v>；
 *   - 数字：写 <v>；
 *   - 其它：写 inlineStr（不重排共享字符串表，最不容易出错）；
 *   - 原来的 s（样式下标）原样保留 —— 表头加粗之类的观感不会丢。
 */

import { escapeXml, parseXml, serializeNode } from './xml.js'
import { readZip, writeZip } from './zip.js'
import { cellRef } from './xlsx-read.js'

const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'

const NUMERIC = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/

function escapeText(text) {
  return escapeXml(String(text ?? ''))
}

function looksNumeric(cell) {
  if (cell.t !== undefined && cell.t !== 'n') return false
  return NUMERIC.test(String(cell.v ?? '').trim())
}

function buildCell(cell, col, row) {
  const ref = cellRef(col, row)
  if (cell === null || cell === undefined) return ''
  const attrs = [`r="${ref}"`]
  if (cell.s !== undefined && cell.s !== null && String(cell.s) !== '0') attrs.push(`s="${cell.s}"`)

  if (typeof cell.f === 'string' && cell.f !== '') {
    const formula = cell.f.replace(/^=/, '')
    const cached = String(cell.v ?? '')
    if (cached === '' || looksNumeric({ v: cached, t: 'n' })) {
      return `<c ${attrs.join(' ')}><f>${escapeText(formula)}</f>${cached === '' ? '' : `<v>${escapeText(cached)}</v>`}</c>`
    }
    attrs.push('t="str"')
    return `<c ${attrs.join(' ')}><f>${escapeText(formula)}</f><v>${escapeText(cached)}</v></c>`
  }

  if (cell.t === 'b') {
    const on = String(cell.v) === '1' || String(cell.v).toLowerCase() === 'true'
    attrs.push('t="b"')
    return `<c ${attrs.join(' ')}><v>${on ? '1' : '0'}</v></c>`
  }
  if (cell.t === 'e') {
    attrs.push('t="e"')
    return `<c ${attrs.join(' ')}><v>${escapeText(cell.v)}</v></c>`
  }

  const value = String(cell.v ?? '')
  if (value === '') return `<c ${attrs.join(' ')}/>`
  if (looksNumeric(cell)) return `<c ${attrs.join(' ')}><v>${escapeText(value)}</v></c>`

  attrs.push('t="inlineStr"')
  return `<c ${attrs.join(' ')}><is><t xml:space="preserve">${escapeText(value)}</t></is></c>`
}

function buildSheetXml(sheet) {
  const rows = sheet.rows ?? []
  const width = Math.max(1, sheet.width ?? Math.max(...rows.map((row) => row.length), 1))
  const height = Math.max(1, rows.length)
  const dimension = `A1:${cellRef(width - 1, height - 1)}`

  const rowXml = []
  rows.forEach((row, rowIndex) => {
    const cells = []
    for (let col = 0; col < width; col += 1) {
      const built = buildCell(row?.[col] ?? null, col, rowIndex)
      if (built !== '') cells.push(built)
    }
    if (cells.length > 0) rowXml.push(`<row r="${rowIndex + 1}">${cells.join('')}</row>`)
  })

  const parts = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<worksheet xmlns="${SPREADSHEET_NS}" xmlns:r="${REL_NS}">`,
    `<dimension ref="${dimension}"/>`,
  ]
  if (typeof sheet.rawSheetViews === 'string') parts.push(sheet.rawSheetViews)
  if (typeof sheet.rawCols === 'string') parts.push(sheet.rawCols)
  parts.push(`<sheetData>${rowXml.join('')}</sheetData>`)
  if (Array.isArray(sheet.merges) && sheet.merges.length > 0) {
    parts.push(`<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${escapeText(ref)}"/>`).join('')}</mergeCells>`)
  }
  parts.push('</worksheet>')
  return parts.join('')
}

// ---------------------------------------------------------------- 新工作簿

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>'

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<Relationships xmlns="${PKG_REL_NS}">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>'

const WORKBOOK_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<Relationships xmlns="${PKG_REL_NS}">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>'

function workbookXml(sheetName) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<workbook xmlns="${SPREADSHEET_NS}" xmlns:r="${REL_NS}">` +
    `<sheets><sheet name="${escapeText(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
    '</workbook>'
  )
}

/** 最小样式表：默认字体 + 一个加粗（表头可用 styleId 1）。 */
const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<styleSheet xmlns="${SPREADSHEET_NS}">` +
  '<fonts count="2">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '</cellXfs>' +
  '</styleSheet>'

/** 从零生成一个 .xlsx（单表）。 */
export function createXlsx(model = {}) {
  const name = typeof model.sheetName === 'string' && model.sheetName !== '' ? model.sheetName : 'Sheet1'
  const sheet = { name, width: 8, height: 1, rows: [[]], ...(model.sheet ?? {}) }
  return writeZip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'xl/workbook.xml', data: workbookXml(name) },
    { name: 'xl/_rels/workbook.xml.rels', data: WORKBOOK_RELS },
    { name: 'xl/styles.xml', data: STYLES_XML },
    { name: 'xl/worksheets/sheet1.xml', data: buildSheetXml(sheet) },
  ])
}

/**
 * 把模型写回 .xlsx。
 * @param {{ sheets: Array<object> }} model
 * @param {Buffer} [original] 原文件字节；给了就保留除工作表正文外的所有部件
 */
export function writeXlsx(model, original) {
  const sheets = model.sheets ?? []
  if (sheets.length === 0) throw new Error('xlsx: 至少要有一个工作表')

  if (!Buffer.isBuffer(original)) {
    return createXlsx({ sheetName: sheets[0].name, sheet: sheets[0] })
  }

  const { entries, order } = readZip(original)
  const byPart = new Map()
  for (const sheet of sheets) {
    if (typeof sheet.part !== 'string') continue
    byPart.set(sheet.part, buildSheetXml(sheet))
  }

  const files = []
  for (const name of order) {
    files.push({ name, data: byPart.get(name) ?? entries.get(name) })
  }

  // 工作表名改了 → workbook.xml 里的 name 也得跟着改（内容不变，只换名字）
  const workbookXmlText = entries.get('xl/workbook.xml')?.toString('utf8')
  if (workbookXmlText !== undefined) {
    const patched = renameSheets(workbookXmlText, sheets)
    if (patched !== null) {
      const index = files.findIndex((file) => file.name === 'xl/workbook.xml')
      if (index >= 0) files[index] = { name: 'xl/workbook.xml', data: patched }
    }
  }

  return writeZip(files)
}

/** 按顺序把 workbook.xml 里 sheet 的 name 换成模型里的新名字。 */
function renameSheets(xmlText, sheets) {
  const roots = parseXml(xmlText)
  const root = roots.find((node) => typeof node !== 'string')
  if (root === undefined) return null

  let index = 0
  let changed = false
  const walk = (node) => {
    for (const child of node.children) {
      if (typeof child === 'string') continue
      if (child.local === 'sheet') {
        const target = sheets[index]
        if (target !== undefined && typeof target.name === 'string' && target.name !== '') {
          const current = child.attrs.name
          if (current !== target.name) {
            child.attrs.name = target.name
            changed = true
          }
        }
        index += 1
      }
      walk(child)
    }
  }
  walk(root)
  if (!changed) return null
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${serializeNode(root)}`
}
