/**
 * docx-write.js -- 文档模型 -> .docx。
 *
 * 两条原则：
 *   1. **只改我们懂的那部分。** 原包里的其他部件（图片、样式表、页眉、设置）
 *      原样搬过去；document.xml 里我们重新生成的只有段落和表格。
 *   2. **没动过的排版要留住。** 每一段 / 每个 run 都带着读取时抓下来的
 *      w:pPr / w:rPr 原文，写回时以它为底，只覆盖模型里明确给出的字段。
 *      所以「只改了一个字」不会顺手把缩进、行距、编号清空。
 */

import { parseXml, serializeNode } from './xml.js'
import { readZip, writeZip } from './zip.js'

/** OOXML 里 rPr / pPr 子元素有固定顺序，插错位置 Word 会挑刺。 */
const RPR_ORDER = [
  'rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike',
  'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden',
  'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect',
  'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout',
  'specVanish', 'oMath',
]
const PPR_ORDER = [
  'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr',
  'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap',
  'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd',
  'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap',
  'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId',
  'cnfStyle', 'rPr', 'sectPr', 'pPrChange',
]

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function escapeText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function mkNode(name, attrs = {}) {
  const local = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name
  return { name, local, attrs, children: [] }
}

/** 按规范顺序放子元素；已存在就复用（先删再插）。 */
function upsertChild(parent, node, order) {
  parent.children = parent.children.filter(
    (c) => typeof c === 'string' || c.local !== node.local,
  )
  const index = order.indexOf(node.local)
  if (index < 0) {
    parent.children.push(node)
    return
  }
  let insertAt = parent.children.length
  for (let i = 0; i < parent.children.length; i += 1) {
    const child = parent.children[i]
    if (typeof child === 'string') continue
    const childIndex = order.indexOf(child.local)
    if (childIndex > index) {
      insertAt = i
      break
    }
  }
  parent.children.splice(insertAt, 0, node)
}

function removeChild(parent, local) {
  parent.children = parent.children.filter((c) => typeof c === 'string' || c.local !== local)
}

function hasChild(parent, local) {
  return parent.children.some((c) => typeof c !== 'string' && c.local === local)
}

function parsePropsNode(raw, fallbackName) {
  if (typeof raw === 'string' && raw !== '') {
    const roots = parseXml(raw)
    if (roots.length > 0 && typeof roots[0] !== 'string') return roots[0]
  }
  return mkNode(fallbackName)
}

// ---------------------------------------------------------------- run

function buildRPr(run) {
  const rPr = parsePropsNode(run.raw, 'w:rPr')

  // 显式布尔：一律以模型为准（读的时候已补成 false，所以「取消加粗」能落地）
  const flags = [
    ['bold', 'b'],
    ['italic', 'i'],
    ['underline', 'u'],
    ['strike', 'strike'],
    ['caps', 'caps'],
  ]
  for (const [key, tag] of flags) {
    if (run[key] === true) {
      upsertChild(rPr, mkNode(`w:${tag}`), RPR_ORDER)
      if (tag === 'u') {
        const u = rPr.children.find((c) => typeof c !== 'string' && c.local === 'u')
        if (u !== undefined) u.attrs = {}
      }
    } else if (run[key] === false) {
      removeChild(rPr, tag)
    }
  }

  if (typeof run.size === 'number' && Number.isFinite(run.size)) {
    const half = String(Math.max(2, Math.round(run.size * 2)))
    upsertChild(rPr, mkNode('w:sz', { 'w:val': half }), RPR_ORDER)
    upsertChild(rPr, mkNode('w:szCs', { 'w:val': half }), RPR_ORDER)
  }
  if (typeof run.color === 'string' && /^[0-9a-fA-F]{6}$/.test(run.color)) {
    upsertChild(rPr, mkNode('w:color', { 'w:val': run.color.toLowerCase() }), RPR_ORDER)
  }
  if (typeof run.font === 'string' && run.font !== '') {
    upsertChild(
      rPr,
      mkNode('w:rFonts', { 'w:ascii': run.font, 'w:hAnsi': run.font, 'w:eastAsia': run.font }),
      RPR_ORDER,
    )
  }
  if (typeof run.highlight === 'string' && run.highlight !== '') {
    upsertChild(rPr, mkNode('w:highlight', { 'w:val': run.highlight }), RPR_ORDER)
  }

  if (rPr.children.length === 0) return ''
  return serializeNode(rPr)
}

function buildRun(run) {
  const rPr = buildRPr(run)
  const pieces = []
  const segments = String(run.text ?? '').split('\n')
  segments.forEach((segment, index) => {
    if (index > 0) pieces.push('<w:br/>')
    if (segment !== '') pieces.push(`<w:t xml:space="preserve">${escapeText(segment)}</w:t>`)
  })
  return `<w:r>${rPr}${pieces.join('')}</w:r>`
}

// ---------------------------------------------------------------- paragraph

const ALIGN_TO_JC = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'both',
}

function buildPPr(paragraph, styleIds) {
  const pPr = parsePropsNode(paragraph.rawPPr, 'w:pPr')

  const styleId = paragraph.style ?? styleIds[paragraph.kind]
  if (styleId !== undefined && styleId !== '') {
    upsertChild(pPr, mkNode('w:pStyle', { 'w:val': styleId }), PPR_ORDER)
  }

  if (paragraph.align !== undefined) {
    const jc = ALIGN_TO_JC[paragraph.align]
    if (jc === undefined) removeChild(pPr, 'jc')
    else upsertChild(pPr, mkNode('w:jc', { 'w:val': jc }), PPR_ORDER)
  }

  if (paragraph.kind === 'list' && !hasChild(pPr, 'numPr')) {
    const numPr = mkNode('w:numPr')
    numPr.children.push(mkNode('w:ilvl', { 'w:val': String(paragraph.level ?? 0) }))
    numPr.children.push(mkNode('w:numId', { 'w:val': String(paragraph.numId ?? 1) }))
    upsertChild(pPr, numPr, PPR_ORDER)
  }

  if (pPr.children.length === 0) return ''
  return serializeNode(pPr)
}

function buildParagraph(paragraph, styleIds) {
  const pPr = buildPPr(paragraph, styleIds)
  const runs = (paragraph.runs ?? []).map(buildRun).join('')
  return `<w:p>${pPr}${runs}</w:p>`
}

// ---------------------------------------------------------------- table

const DEFAULT_GRID = [2340, 2340, 2340, 2340]

function buildTable(table, styleIds) {
  const grid = Array.isArray(table.grid) && table.grid.length > 0 ? table.grid : undefined
  const columns = grid ?? DEFAULT_GRID
  const total = columns.reduce((sum, w) => sum + w, 0)

  const parts = []
  if (typeof table.rawTblPr === 'string' && table.rawTblPr !== '') {
    parts.push(table.rawTblPr)
  } else {
    parts.push(
      '<w:tblPr>' +
        `<w:tblW w:w="${total}" w:type="dxa"/>` +
        '<w:tblBorders>' +
        ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
          .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`)
          .join('') +
        '</w:tblBorders>' +
        '<w:tblLayout w:type="fixed"/>' +
        '</w:tblPr>',
    )
  }

  parts.push(
    '<w:tblGrid>' + columns.map((w) => `<w:gridCol w:w="${w}"/>`).join('') + '</w:tblGrid>',
  )

  for (const row of table.rows ?? []) {
    const cells = []
    for (const cell of row) {
      const span = Number.isFinite(cell.span) && cell.span > 1 ? cell.span : 1
      const tcPr = span > 1 ? `<w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr>` : ''
      const content = (cell.blocks ?? []).map((block) => {
        if (block.type === 'table') return buildTable(block, styleIds)
        return buildParagraph(block, styleIds)
      }).join('') || '<w:p/>'
      cells.push(`<w:tc>${tcPr}${content}</w:tc>`)
    }
    parts.push(`<w:tr>${cells.join('')}</w:tr>`)
  }

  return `<w:tbl>${parts.join('')}</w:tbl>`
}

// ---------------------------------------------------------------- document

const DEFAULT_SECT_PR =
  '<w:sectPr>' +
  '<w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0"/>' +
  '</w:sectPr>'

export function buildDocumentXml(model) {
  const styleIds = model.styleIds ?? {}
  const blocks = (model.blocks ?? []).map((block) => {
    if (block.type === 'table') return buildTable(block, styleIds)
    return buildParagraph(block, styleIds)
  })
  const sectPr = typeof model.sectPr === 'string' && model.sectPr !== '' ? model.sectPr : DEFAULT_SECT_PR
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}">` +
    `<w:body>${blocks.join('')}${sectPr}</w:body>` +
    '</w:document>'
  )
}

// ---------------------------------------------------------------- 新文档

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '</Types>'

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>'

const DOC_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>'

function headingStyle(level) {
  const id = `Heading${level}`
  const size = String(Math.max(20, 32 - level * 2))
  return (
    `<w:style w:type="paragraph" w:styleId="${id}">` +
    `<w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>` +
    '<w:qFormat/><w:pPr><w:keepNext/>' +
    `<w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>` +
    '</w:style>'
  )
}

function defaultStylesXml() {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:styles xmlns:w="${W_NS}">` +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体" w:cs="Times New Roman"/>' +
    '<w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/>' +
    '</w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    '</w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>' +
    '<w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr>' +
    '<w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:jc w:val="center"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:ind w:left="720"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr></w:pPr>' +
    '<w:rPr><w:color w:val="595959"/></w:rPr></w:style>' +
    [1, 2, 3, 4, 5, 6].map(headingStyle).join('') +
    '</w:styles>'
  )
}

const DEFAULT_STYLE_IDS = {
  title: 'Title',
  subtitle: 'Subtitle',
  quote: 'Quote',
  h1: 'Heading1',
  h2: 'Heading2',
  h3: 'Heading3',
  h4: 'Heading4',
  h5: 'Heading5',
  h6: 'Heading6',
}

/** 从零生成一个空 .docx（正文 + 样式表）。 */
export function createDocx(model = {}) {
  const withStyles = {
    blocks: [],
    ...model,
    styleIds: { ...DEFAULT_STYLE_IDS, ...(model.styleIds ?? {}) },
  }
  return writeZip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'word/_rels/document.xml.rels', data: DOC_RELS },
    { name: 'word/document.xml', data: buildDocumentXml(withStyles) },
    { name: 'word/styles.xml', data: defaultStylesXml() },
  ])
}

/**
 * 把模型写回 .docx。
 * @param {object} model 文档模型
 * @param {Buffer} [original] 原文件字节；给了就保留除 document.xml 外的所有部件
 * @returns {Buffer}
 */
export function writeDocx(model, original) {
  if (!Buffer.isBuffer(original)) return createDocx(model)

  const { entries, order } = readZip(original)
  const xml = buildDocumentXml(model)
  const files = []
  const seen = new Set()
  for (const name of order) {
    if (name === 'word/document.xml') {
      files.push({ name, data: xml })
    } else {
      files.push({ name, data: entries.get(name) })
    }
    seen.add(name)
  }
  if (!seen.has('word/document.xml')) files.push({ name: 'word/document.xml', data: xml })
  return writeZip(files)
}
