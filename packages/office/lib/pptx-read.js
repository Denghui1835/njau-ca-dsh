/**
 * pptx-read.js —— .pptx → 幻灯片模型。
 *
 * 一张幻灯片是「形状树」：p:spTree 下挂着一堆 p:sp，每个形状自己带几何、
 * 样式和文本框（p:txBody → a:p → a:r → a:t）。
 *
 * 这里只建模**文字**：每个带文本框的形状态 → { placeholder, paragraphs[] }。
 * 图片、表格、图表、SmartArt 不建模，但它们属于同一个形状树 ——
 * 写回时整棵树原样序列化，所以它们还在。
 *
 * 与 docx / xlsx 同一条原则：只重建我们改过的部分，其余一个字节都不动。
 */

import { readZip } from './zip.js'
import { attr, childrenOf, firstChild, parseXml, textOf } from './xml.js'

const MAX_SLIDES = 200
const MAX_PARAGRAPHS = 200

/** 段落水平（a:pPr 的 lvl），没有就是 0。 */
function levelOf(pPr) {
  if (pPr === undefined) return 0
  const value = Number.parseInt(attr(pPr, 'lvl') ?? '', 10)
  return Number.isFinite(value) && value >= 0 ? value : 0
}

/** 一段的纯文字（多截 a:r 拼起来，含 a:br 换行）。 */
function paragraphText(node) {
  let text = ''
  for (const child of node.children) {
    if (typeof child === 'string') continue
    if (child.local === 'r' || child.local === 'fld') text += textOf(child)
    else if (child.local === 'br') text += '\n'
  }
  return text
}

/** 占位符类型（title / ctrTitle / subTitle / body / obj …），没有就是 undefined。 */
function placeholderOf(sp) {
  const nvSpPr = firstChild(sp, 'nvSpPr')
  const nvPr = nvSpPr === undefined ? undefined : firstChild(nvSpPr, 'nvPr')
  const ph = nvPr === undefined ? undefined : firstChild(nvPr, 'ph')
  if (ph === undefined) return undefined
  const type = attr(ph, 'type')
  const idx = attr(ph, 'idx')
  if (type !== undefined) return type
  return idx === undefined ? 'body' : `idx-${idx}`
}

function nameOf(sp) {
  const nvSpPr = firstChild(sp, 'nvSpPr')
  const cNvPr = nvSpPr === undefined ? undefined : firstChild(nvSpPr, 'cNvPr')
  return cNvPr === undefined ? '' : (attr(cNvPr, 'name') ?? '')
}

/** 幻灯片里的文字形状（按出现顺序，数组下标就是模型的 ref）。 */
function readShapes(slideNode) {
  const cSld = firstChild(slideNode, 'cSld')
  const spTree = cSld === undefined ? undefined : firstChild(cSld, 'spTree')
  if (spTree === undefined) return []

  const shapes = []
  for (const sp of childrenOf(spTree, 'sp')) {
    const txBody = firstChild(sp, 'txBody')
    if (txBody === undefined) continue
    const placeholder = placeholderOf(sp)
    const paragraphs = childrenOf(txBody, 'p')
      .slice(0, MAX_PARAGRAPHS)
      .map((p) => ({
        text: paragraphText(p),
        level: levelOf(firstChild(p, 'pPr')),
      }))
    shapes.push({
      ref: shapes.length,
      name: nameOf(sp),
      ...(placeholder === undefined ? {} : { placeholder }),
      paragraphs,
    })
  }
  return shapes
}

/** presentation.xml + rels → 幻灯片部件路径（保持放映顺序）。 */
function parsePresentation(entries) {
  const presentationXml = entries.get('ppt/presentation.xml')
  if (presentationXml === undefined) throw new Error('pptx: 包里没有 ppt/presentation.xml')

  const relsXml = entries.get('ppt/_rels/presentation.xml.rels')
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
    for (const root of roots) if (typeof root !== 'string') walk(root)
  }

  const roots = parseXml(presentationXml.toString('utf8'))
  const parts = []
  let size
  const walk = (node) => {
    for (const child of node.children) {
      if (typeof child === 'string') continue
      if (child.local === 'sldSz') {
        size = {
          width: Number.parseInt(attr(child, 'cx') ?? '', 10),
          height: Number.parseInt(attr(child, 'cy') ?? '', 10),
        }
      } else if (child.local === 'sldId') {
        // 注意：<p:sldId id="256" r:id="rId2"/> 里 id 是页码标识，r:id 才是关系引用。
        // 先取 r:id —— 早先取 id 的写法会让所有页都「消失」。
        const relId = attr(child, 'r:id') ?? attr(child, 'rId')
        const target = relId === undefined ? undefined : rels.get(relId)
        const part = target === undefined
          ? undefined
          : (target.startsWith('/') ? target.slice(1) : `ppt/${target.replace(/^\.\//, '')}`)
        if (part !== undefined) parts.push(part)
      }
      walk(child)
    }
  }
  for (const root of roots) if (typeof root !== 'string') walk(root)

  return { parts: parts.slice(0, MAX_SLIDES), size }
}

/**
 * 读一个 .pptx。
 * @param {Buffer} buffer
 */
export function readPptx(buffer) {
  const { entries } = readZip(buffer)
  const { parts, size } = parsePresentation(entries)
  const slides = parts.map((part, index) => {
    const raw = entries.get(part)
    if (raw === undefined) throw new Error(`pptx: 找不到幻灯片部件 ${part}`)
    const roots = parseXml(raw.toString('utf8'))
    const root = roots.find((node) => typeof node !== 'string')
    if (root === undefined) throw new Error(`pptx: ${part} 解析不出根节点`)
    return { index, part, shapes: readShapes(root), _xml: raw.toString('utf8') }
  })

  return {
    slides: slides.map(({ _xml, ...slide }) => slide),
    size: size ?? { width: 12192000, height: 6858000 },
    parts: [...entries.keys()].sort(),
  }
}

/** 一张幻灯片的一行标题（取标题占位符或第一个文字形状）。 */
export function slideTitle(slide) {
  const title = slide.shapes.find((shape) => shape.placeholder === 'title' || shape.placeholder === 'ctrTitle')
  const source = title ?? slide.shapes[0]
  if (source === undefined) return ''
  return (source.paragraphs[0]?.text ?? '').trim()
}

/** 纯文本视图：给 agent 看的大纲。 */
export function deckToText(deck) {
  const lines = []
  deck.slides.forEach((slide, index) => {
    lines.push(`# 第 ${index + 1} 页  ${slideTitle(slide)}`)
    for (const shape of slide.shapes) {
      const isTitle = shape.placeholder === 'title' || shape.placeholder === 'ctrTitle'
      shape.paragraphs.forEach((paragraph, pIndex) => {
        if (isTitle && pIndex === 0) return
        if (paragraph.text === '') return
        lines.push(`${'  '.repeat(paragraph.level + 1)}- ${paragraph.text}`)
      })
    }
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}
