/**
 * deck-ops.js —— 演示文稿的结构化编辑操作（给 agent 用）。
 *
 * 定位方式：slide 是**页下标**（0 开始），shape 是**该页文字形状的序号**（0 开始，
 * 与 njau_office_deck_read 返回的顺序一致）。标题占位符通常是 shape 0。
 *
 * 不做「增删页」：那要同步 presentation.xml、rels 与 content types 三处，
 * 漏一处 PowerPoint 就说文件损坏。这一版明确不做，而不是做得半对。
 */

function requireSlide(deck, index) {
  const slides = deck.slides ?? []
  if (!Number.isInteger(index) || index < 0 || index >= slides.length) {
    throw new Error(`页下标越界：${index}（共 ${slides.length} 页，从 0 开始）`)
  }
  return slides[index]
}

function requireShape(slide, index) {
  const shapes = slide.shapes ?? []
  if (!Number.isInteger(index) || index < 0 || index >= shapes.length) {
    throw new Error(`形状下标越界：${index}（第 ${(slide.index ?? 0) + 1} 页共 ${shapes.length} 个文字形状）`)
  }
  return shapes[index]
}

/** 标题形状：优先 title / ctrTitle 占位符，否则第一个文字形状。 */
export function titleShapeOf(slide) {
  const shapes = slide.shapes ?? []
  return shapes.find((shape) => shape.placeholder === 'title' || shape.placeholder === 'ctrTitle') ?? shapes[0]
}

/** 正文形状：第一个非标题的文字形状。 */
export function bodyShapeOf(slide) {
  const shapes = slide.shapes ?? []
  const title = titleShapeOf(slide)
  return shapes.find((shape) => shape !== title) ?? title
}

function shapeIndex(slide, shape) {
  return (slide.shapes ?? []).indexOf(shape)
}

export function applyDeckOp(deck, op) {
  if (op === null || typeof op !== 'object') throw new Error('操作必须是对象')
  switch (op.op) {
    case 'set_title': {
      const slide = requireSlide(deck, Number(op.slide))
      const shape = titleShapeOf(slide)
      if (shape === undefined) throw new Error(`第 ${Number(op.slide) + 1} 页没有文字形状`)
      const text = String(op.text ?? '')
      if (shape.paragraphs.length === 0) shape.paragraphs.push({ text: '', level: 0 })
      shape.paragraphs[0].text = text
      return `第 ${Number(op.slide) + 1} 页标题 = ${text}`
    }
    case 'set_text': {
      const slide = requireSlide(deck, Number(op.slide))
      const shape = requireShape(slide, Number(op.shape ?? 0))
      const index = Number(op.index ?? 0)
      if (!Number.isInteger(index) || index < 0 || index >= shape.paragraphs.length) {
        throw new Error(`段落下标越界：${index}（形状 ${op.shape ?? 0} 共 ${shape.paragraphs.length} 段）`)
      }
      const text = String(op.text ?? '')
      shape.paragraphs[index].text = text
      return `第 ${Number(op.slide) + 1} 页 · 形状 ${op.shape ?? 0} · 第 ${index + 1} 段 = ${text}`
    }
    case 'add_paragraph': {
      const slide = requireSlide(deck, Number(op.slide))
      const shapes = slide.shapes ?? []
      let shape
      if (op.shape !== undefined && op.shape !== null) shape = requireShape(slide, Number(op.shape))
      else shape = bodyShapeOf(slide)
      if (shape === undefined) throw new Error(`第 ${Number(op.slide) + 1} 页没有可写的文字形状`)
      const level = Number.isInteger(op.level) && op.level > 0 ? Math.min(8, op.level) : 0
      shape.paragraphs.push({ text: String(op.text ?? ''), level })
      return `第 ${Number(op.slide) + 1} 页加了一段（${shapes.indexOf(shape) >= 0 ? `形状 ${shapes.indexOf(shape)}` : '正文'}）`
    }
    case 'delete_paragraph': {
      const slide = requireSlide(deck, Number(op.slide))
      const shape = requireShape(slide, Number(op.shape ?? 0))
      const index = Number(op.index)
      if (!Number.isInteger(index) || index < 0 || index >= shape.paragraphs.length) {
        throw new Error(`段落下标越界：${index}（共 ${shape.paragraphs.length} 段）`)
      }
      if (shape.paragraphs.length <= 1) throw new Error('一个形状至少要留一段（PPT 里空文本框会塌）')
      const [removed] = shape.paragraphs.splice(index, 1)
      return `删掉第 ${Number(op.slide) + 1} 页的第 ${index + 1} 段（${removed.text.slice(0, 20)}）`
    }
    case 'set_level': {
      const slide = requireSlide(deck, Number(op.slide))
      const shape = requireShape(slide, Number(op.shape ?? 0))
      const index = Number(op.index ?? 0)
      if (shape.paragraphs[index] === undefined) throw new Error(`段落下标越界：${index}`)
      const level = Number(op.level)
      if (!Number.isInteger(level) || level < 0 || level > 8) throw new Error('level 必须是 0..8')
      shape.paragraphs[index].level = level
      return `第 ${Number(op.slide) + 1} 页第 ${index + 1} 段缩进 = ${level}`
    }
    default:
      throw new Error(
        `未知操作 ${op.op}，可用：set_title / set_text / add_paragraph / delete_paragraph / set_level`,
      )
  }
}
