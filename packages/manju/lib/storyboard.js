/**
 * storyboard.js —— 漫剧的数据中枢。
 *
 * 一条漫剧的全部工序都挂在这一个文件上（`<项目>/storyboard.json`）：
 *
 *   剧本.md  ──写剧本──▶  panels[]  ──出图──▶  panels[].asset
 *                          │                    │
 *                          ├──台词──▶ dialogue  ├──配音字幕──▶ audio
 *                          └──时长──▶ duration  └──合成──▶ out.mp4
 *
 * 为什么用文件而不是数据库：每一步可能是不同插件、不同届的人做的，
 * 甚至是隔半年重开的项目。一个能 git diff 的 JSON，比任何 schema 都耐用。
 *
 * 这个模块只做纯函数（normalize / applyOp），不碰磁盘 —— 好在测试里直接断言。
 */

export const FORMAT = 'njau-manju/storyboard@1'

/** 一格的工序状态。顺序即推进方向，别乱改顺序（界面上按它画进度）。 */
export const PANEL_STATUS = ['todo', 'drawn', 'voiced', 'done']

export const STATUS_LABEL = {
  todo: '待出图',
  drawn: '已出图',
  voiced: '已配音',
  done: '已完成',
}

const DEFAULT_DURATION = 3

/** 一整格的空白模板。 */
function blankPanel(id, shot) {
  return {
    id,
    shot,
    desc: '',
    dialogue: [],
    duration: DEFAULT_DURATION,
    characters: [],
    asset: null,
    status: 'todo',
    notes: '',
  }
}

export function blankStoryboard(title = '') {
  return {
    format: FORMAT,
    title,
    logline: '',
    style: { look: 'manga', palette: 'warm', aspect: '9:16' },
    cast: [],
    panels: [],
    audio: { narration: null, bgm: null },
    updatedAt: new Date().toISOString(),
  }
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeDialogue(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    if (typeof item === 'string') return { who: '', line: item, emotion: '' }
    return {
      who: asString(item?.who),
      line: asString(item?.line),
      emotion: asString(item?.emotion),
    }
  }).filter((item) => item.line !== '' || item.who !== '')
}

/**
 * 把任意来源的内容收敛成规范结构。
 * 手写过的、老版本写的、agent 写坏的 storyboard 都要能被救回来 ——
 * 所以这里只做加法（补默认值），几乎不丢东西。
 */
export function normalize(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const board = blankStoryboard(asString(source.title))
  board.format = FORMAT // 认领格式标记：老文件也升到当前格式
  board.logline = asString(source.logline)
  const style = source.style !== null && typeof source.style === 'object' ? source.style : {}
  board.style = {
    look: asString(style.look, 'manga'),
    palette: asString(style.palette, 'warm'),
    aspect: asString(style.aspect, '9:16'),
  }
  board.cast = Array.isArray(source.cast)
    ? source.cast.map((person, index) => ({
      id: asString(person?.id, `c${index + 1}`),
      name: asString(person?.name),
      desc: asString(person?.desc),
    }))
    : []
  board.audio = {
    narration: typeof source.audio?.narration === 'string' ? source.audio.narration : null,
    bgm: typeof source.audio?.bgm === 'string' ? source.audio.bgm : null,
  }

  const seenIds = new Set()
  const panels = Array.isArray(source.panels) ? source.panels : []
  board.panels = panels.map((panel, index) => {
    const entry = blankPanel('', index + 1)
    let id = asString(panel?.id)
    if (id === '' || seenIds.has(id)) id = `p${index + 1}`
    seenIds.add(id)
    entry.id = id
    entry.shot = Math.max(1, Math.round(asNumber(panel?.shot, index + 1)))
    entry.desc = asString(panel?.desc)
    entry.dialogue = normalizeDialogue(panel?.dialogue)
    entry.duration = Math.max(0.2, asNumber(panel?.duration, DEFAULT_DURATION))
    entry.characters = Array.isArray(panel?.characters)
      ? panel.characters.map((c) => asString(c)).filter((c) => c !== '')
      : []
    entry.asset = typeof panel?.asset === 'string' && panel.asset !== '' ? panel.asset : null
    entry.status = PANEL_STATUS.includes(panel?.status) ? panel.status : 'todo'
    entry.notes = asString(panel?.notes)
    return entry
  })

  board.updatedAt = typeof source.updatedAt === 'string' ? source.updatedAt : new Date().toISOString()
  return board
}

/** 下一格的 id：取现有 p<n> 的最大 n 再加一，避免删了中间那格之后撞号。 */
function nextPanelId(panels) {
  let max = 0
  for (const panel of panels) {
    const matched = /^p(\d+)$/.exec(panel.id)
    if (matched !== null) max = Math.max(max, Number(matched[1]))
  }
  return `p${max + 1}`
}

function requirePanel(board, id) {
  const index = board.panels.findIndex((panel) => panel.id === id)
  if (index < 0) {
    throw new Error(`没有这一格：${id}（现有 ${board.panels.map((p) => p.id).join(', ') || '空'}）`)
  }
  return index
}

/**
 * 执行一个编辑操作。纯函数：改的是传进来的 board，返回一句人能看懂的回执。
 * 出错就 throw，由上层包成 { ok:false, error } —— 不静默吞掉。
 */
export function applyOp(board, op) {
  if (op === null || typeof op !== 'object') throw new Error('操作必须是对象')
  switch (op.op) {
    case 'set_field': {
      const allowed = ['title', 'logline', 'aspect', 'look', 'palette', 'narration', 'bgm']
      if (!allowed.includes(op.field)) {
        throw new Error(`field 只能是 ${allowed.join(' / ')}`)
      }
      const value = asString(op.value)
      if (op.field === 'aspect' || op.field === 'look' || op.field === 'palette') {
        board.style[op.field] = value === '' ? board.style[op.field] : value
      } else if (op.field === 'narration' || op.field === 'bgm') {
        board.audio[op.field] = value === '' ? null : value
      } else {
        board[op.field] = value
      }
      return `${op.field} 已更新`
    }
    case 'add_panel': {
      const after = op.after === undefined ? board.panels.length - 1 : Number(op.after)
      const at = Number.isInteger(after) ? Math.min(board.panels.length, Math.max(0, after + 1)) : board.panels.length
      const panel = blankPanel(nextPanelId(board.panels), 0)
      panel.desc = asString(op.desc)
      panel.dialogue = normalizeDialogue(op.dialogue)
      panel.duration = Math.max(0.2, asNumber(op.duration, DEFAULT_DURATION))
      panel.characters = Array.isArray(op.characters) ? op.characters.map((c) => asString(c)) : []
      board.panels.splice(at, 0, panel)
      renumber(board)
      return `在第 ${at + 1} 格插入 ${panel.id}`
    }
    case 'set_panel': {
      const index = requirePanel(board, asString(op.id))
      const panel = board.panels[index]
      if (op.desc !== undefined) panel.desc = asString(op.desc)
      if (op.notes !== undefined) panel.notes = asString(op.notes)
      if (op.duration !== undefined) panel.duration = Math.max(0.2, asNumber(op.duration, panel.duration))
      if (op.characters !== undefined) {
        panel.characters = Array.isArray(op.characters) ? op.characters.map((c) => asString(c)) : []
      }
      if (op.dialogue !== undefined) panel.dialogue = normalizeDialogue(op.dialogue)
      if (op.asset !== undefined) {
        panel.asset = typeof op.asset === 'string' && op.asset !== '' ? op.asset : null
      }
      if (op.status !== undefined) {
        if (!PANEL_STATUS.includes(op.status)) {
          throw new Error(`status 只能是 ${PANEL_STATUS.join(' / ')}`)
        }
        panel.status = op.status
      }
      return `${panel.id} 已更新`
    }
    case 'delete_panel': {
      const index = requirePanel(board, asString(op.id))
      const [removed] = board.panels.splice(index, 1)
      renumber(board)
      return `删除 ${removed.id}（还剩 ${board.panels.length} 格）`
    }
    case 'move_panel': {
      const index = requirePanel(board, asString(op.id))
      const target = Math.round(asNumber(op.to, index + 1)) - 1
      if (!Number.isInteger(target)) throw new Error('to 必须是目标位置（从 1 开始）')
      const clamped = Math.min(board.panels.length - 1, Math.max(0, target))
      const [panel] = board.panels.splice(index, 1)
      board.panels.splice(clamped, 0, panel)
      renumber(board)
      return `${panel.id} 移到第 ${clamped + 1} 格`
    }
    case 'clear_panels': {
      const count = board.panels.length
      board.panels = []
      return `清空 ${count} 格`
    }
    default:
      throw new Error(
        `未知操作 ${op.op}，可用：set_field / add_panel / set_panel / delete_panel / move_panel / clear_panels`,
      )
  }
}

/** 镜号永远等于位置：改了顺序，镜号要跟着走，否则台词和时间轴全对不上。 */
function renumber(board) {
  board.panels.forEach((panel, index) => {
    panel.shot = index + 1
  })
}

/** 这一格还缺什么 —— 界面上和给 agent 的提示都靠它。 */
export function panelGaps(panel) {
  const gaps = []
  if (panel.desc.trim() === '') gaps.push('画面描述')
  if (panel.asset === null) gaps.push('画面')
  if (panel.dialogue.length === 0) gaps.push('台词')
  return gaps
}

/** 整条产线的下一步：先说最靠前的那件事，一次只说一件。 */
export function projectNextStep(board, scriptText) {
  if (typeof scriptText === 'string' && scriptText.trim().length < 20) return '先写剧本'
  if (board.panels.length === 0) return '再拆分镜'
  const missingDesc = board.panels.filter((panel) => panel.desc.trim() === '')
  if (missingDesc.length > 0) return `${missingDesc.length} 格还缺画面描述`
  const undrawn = board.panels.filter((panel) => panel.asset === null)
  if (undrawn.length > 0) return `${undrawn.length} 格还没出图`
  const unvoiced = board.panels.filter((panel) => panel.status !== 'voiced' && panel.status !== 'done')
  if (unvoiced.length > 0) return `${unvoiced.length} 格还没配音`
  return '可以合成了'
}

/** 总时长（秒），配音与合成都要用。 */
export function totalDuration(board) {
  return board.panels.reduce((sum, panel) => sum + panel.duration, 0)
}

/** 给 agent 看的分镜清单：紧凑、带 id、带缺口提示。 */
export function boardOutline(board, options = {}) {
  const maxChars = Number.isInteger(options.maxChars) ? options.maxChars : 160
  const clip = (text) => (text.length > maxChars ? `${text.slice(0, maxChars)}…` : text)
  return {
    title: board.title,
    logline: board.logline,
    style: board.style,
    totalDuration: Math.round(totalDuration(board) * 10) / 10,
    panels: board.panels.map((panel) => ({
      id: panel.id,
      shot: panel.shot,
      desc: clip(panel.desc),
      dialogue: panel.dialogue.map((line) => `${line.who}${line.emotion === '' ? '' : `(${line.emotion})`}: ${line.line}`),
      duration: panel.duration,
      asset: panel.asset,
      status: panel.status,
      gaps: panelGaps(panel),
    })),
  }
}
