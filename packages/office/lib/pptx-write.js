/**
 * pptx-write.js —— 幻灯片模型 → .pptx。
 *
 * 写回策略（docx / xlsx 的同一条原则）：
 *   1. 每张幻灯片**整棵树**重新序列化 —— 所以图片、表格、图表、SmartArt 都还在；
 *   2. 文字只重建我们模型里管的那些形状的 `a:p`，
 *      并且拿该形状原来的第一个 `a:p`（段落属性）与第一个 `a:r`（文字属性）当模板，
 *      所以字号、颜色、对齐、项目符号风格不会因为我们改了一行字而丢；
 *   3. 没动过的形状原样序列化。
 *
 * 不做的：新增 / 删除幻灯片（要同步改 presentation.xml、rels、content types，属下一版）。
 */

import { childrenOf, firstChild, parseXml, serializeNode } from './xml.js'
import { readZip, writeZip } from './zip.js'

const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function clone(node) {
  return JSON.parse(JSON.stringify(node))
}

function escapeText(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function mkNode(name, attrs = {}) {
  const local = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name
  return { name, local, attrs, children: [] }
}

/** 找到这张幻灯片里的文字形状（与 readShapes 完全同序）。 */
function textSpNodes(slideRoot) {
  const cSld = firstChild(slideRoot, 'cSld')
  const spTree = cSld === undefined ? undefined : firstChild(cSld, 'spTree')
  if (spTree === undefined) return []
  return childrenOf(spTree, 'sp').filter((sp) => firstChild(sp, 'txBody') !== undefined)
}

/** 从原 txBody 里取模板：bodyPr / lstStyle / 首个 a:p / 首个 a:r。 */
function templatesOf(txBody) {
  const paragraphs = childrenOf(txBody, 'p')
  const firstP = paragraphs[0]
  const firstR = firstP === undefined ? undefined : firstChild(firstP, 'r')
  return {
    bodyPr: firstChild(txBody, 'bodyPr'),
    lstStyle: firstChild(txBody, 'lstStyle'),
    pPr: firstP === undefined ? undefined : firstChild(firstP, 'pPr'),
    rPr: firstR === undefined ? undefined : firstChild(firstR, 'rPr'),
  }
}

/** 用模板造一个 a:p（文字可能含换行 → 用 a:br 分隔）。 */
function buildParagraph(text, level, templates) {
  const paragraph = mkNode('a:p')
  const pPr = templates.pPr === undefined ? mkNode('a:pPr') : clone(templates.pPr)
  if (level > 0) pPr.attrs.lvl = String(level)
  else delete pPr.attrs.lvl
  paragraph.children.push(pPr)

  const lines = String(text ?? '').split('\n')
  lines.forEach((line, index) => {
    if (index > 0) paragraph.children.push(mkNode('a:br'))
    if (line === '') return
    const run = mkNode('a:r')
    if (templates.rPr !== undefined) run.children.push(clone(templates.rPr))
    const t = mkNode('a:t')
    t.attrs['xml:space'] = 'preserve'
    t.children.push(line)
    run.children.push(t)
    paragraph.children.push(run)
  })

  if (paragraph.children.length === 1) {
    // 空段落：补一个 endParaRPr，PPT 里这行才不会塌成 0 高
    paragraph.children.push(mkNode('a:endParaRPr'))
  }
  return paragraph
}

/** 重建一张幻灯片的 XML：只替换文字形状的 txBody 段落。 */
export function buildSlideXml(originalXml, slideModel) {
  const roots = parseXml(originalXml)
  const root = roots.find((node) => typeof node !== 'string')
  if (root === undefined) throw new Error('pptx: 幻灯片 XML 解析失败')

  const spNodes = textSpNodes(root)
  slideModel.shapes.forEach((shape, index) => {
    const sp = spNodes[index]
    if (sp === undefined) return
    const txBody = firstChild(sp, 'txBody')
    if (txBody === undefined) return
    const templates = templatesOf(txBody)

    const rebuilt = []
    if (templates.bodyPr !== undefined) rebuilt.push(clone(templates.bodyPr))
    if (templates.lstStyle !== undefined) rebuilt.push(clone(templates.lstStyle))
    const paragraphs = (shape.paragraphs ?? []).length > 0
      ? shape.paragraphs
      : [{ text: '', level: 0 }]
    for (const paragraph of paragraphs) {
      rebuilt.push(buildParagraph(paragraph.text, paragraph.level ?? 0, templates))
    }
    txBody.children = rebuilt
  })

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${serializeNode(root)}`
}

// ---------------------------------------------------------------- 新演示文稿

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
  '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
  '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
  '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
  '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
  '</Types>'

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
  '</Relationships>'

function presentationXml() {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<p:presentation xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}">` +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>' +
    '<p:sldSz cx="12192000" cy="6858000"/>' +
    '<p:notesSz cx="6858000" cy="9144000"/>' +
    '</p:presentation>'
  )
}

const PRESENTATION_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
  '</Relationships>'

const EMPTY_TREE =
  '<p:spTree>' +
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
  '</p:spTree>'

function slideMasterXml() {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<p:sldMaster xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}">` +
    `<p:cSld>${EMPTY_TREE}</p:cSld>` +
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" ' +
    'accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
    '</p:sldMaster>'
  )
}

const MASTER_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>' +
  '</Relationships>'

function slideLayoutXml() {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<p:sldLayout xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}" type="titleAndBody" preserve="1">` +
    `<p:cSld name="Title and Content">${EMPTY_TREE}</p:cSld>` +
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>' +
    '</p:sldLayout>'
  )
}

const LAYOUT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>' +
  '</Relationships>'

const THEME_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<a:theme xmlns:a="${A_NS}" name="Office Theme"><a:themeElements>` +
  '<a:clrScheme name="Office">' +
  '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
  '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="44546A"/></a:dk2>' +
  '<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="4472C4"/></a:accent1>' +
  '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>' +
  '<a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>' +
  '<a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
  '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
  '</a:clrScheme>' +
  '<a:fontScheme name="Office">' +
  '<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>' +
  '</a:fontScheme>' +
  '<a:fmtScheme name="Office">' +
  '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
  '<a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
  '<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
  '<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst>' +
  '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle>' +
  '<a:effectStyle><a:effectLst/></a:effectStyle>' +
  '<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
  '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
  '</a:fmtScheme></a:themeElements></a:theme>'

const SLIDE_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
  '</Relationships>'

function placeholderShape(id, name, phType, x, y, cx, cy, text) {
  return (
    '<p:sp><p:nvSpPr>' +
    `<p:cNvPr id="${id}" name="${name}"/>` +
    '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
    `<p:nvPr><p:ph type="${phType}"/></p:nvPr>` +
    '</p:nvSpPr>' +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></p:spPr>` +
    '<p:txBody><a:bodyPr/><a:lstStyle/>' +
    `<a:p><a:r><a:t>${escapeText(text)}</a:t></a:r></a:p>` +
    '</p:txBody></p:sp>'
  )
}

function slideXml(title, lines) {
  const body = (lines.length > 0 ? lines : [{ text: '第一点', level: 0 }])
    .map((line) => (
      `<a:p>${line.level > 0 ? `<a:pPr lvl="${line.level}"/>` : ''}` +
      `<a:r><a:t>${escapeText(line.text)}</a:t></a:r></a:p>`
    ))
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<p:sld xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}">` +
    '<p:cSld><p:spTree>' +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr/>' +
    placeholderShape(2, 'Title 1', 'title', 838200, 365125, 10515600, 1325563, title) +
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
    '<p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="4351338"/></a:xfrm></p:spPr>' +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>` +
    '</p:spTree></p:cSld>' +
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>' +
    '</p:sld>'
  )
}

/** 从零生成一个 .pptx（一页：标题 + 要点）。 */
export function createPptx(model = {}) {
  const slides = Array.isArray(model.slides) && model.slides.length > 0
    ? model.slides
    : [{ title: model.title ?? '演示文稿', shapes: [{ paragraphs: [{ text: '第一点', level: 0 }] }] }]

  const files = [
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'ppt/presentation.xml', data: presentationXml() },
    { name: 'ppt/_rels/presentation.xml.rels', data: PRESENTATION_RELS },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: slideMasterXml() },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: MASTER_RELS },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: slideLayoutXml() },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: LAYOUT_RELS },
    { name: 'ppt/theme/theme1.xml', data: THEME_XML },
  ]

  const first = slides[0]
  const title = typeof first.title === 'string' ? first.title : '演示文稿'
  const lines = []
  for (const shape of first.shapes ?? []) {
    for (const paragraph of shape.paragraphs ?? []) {
      if (paragraph.text !== '') lines.push({ text: paragraph.text, level: paragraph.level ?? 0 })
    }
  }
  files.push({ name: 'ppt/slides/slide1.xml', data: slideXml(title, lines) })
  files.push({ name: 'ppt/slides/_rels/slide1.xml.rels', data: SLIDE_RELS })
  return writeZip(files)
}

/**
 * 把模型写回 .pptx。
 * @param {{ slides: Array<object> }} model
 * @param {Buffer} [original]
 */
export function writePptx(model, original) {
  if (!Buffer.isBuffer(original)) return createPptx(model)

  const { entries, order } = readZip(original)
  const byPart = new Map()
  for (const slide of model.slides ?? []) {
    if (typeof slide.part !== 'string') continue
    const raw = entries.get(slide.part)
    if (raw === undefined) continue
    byPart.set(slide.part, buildSlideXml(raw.toString('utf8'), slide))
  }

  const files = order.map((name) => ({ name, data: byPart.get(name) ?? entries.get(name) }))
  return writeZip(files)
}
