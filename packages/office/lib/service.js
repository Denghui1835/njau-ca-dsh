/**
 * service.js —— 文档服务：面板（HTTP）和 agent（工具）共用的唯一操作层。
 *
 * 为什么必须只有一层：同一件事有两个人调（用户点保存、模型调工具）。
 * 各自写一份逻辑迟早会分叉；这里只放一份，两边都调它，
 * 失败也统一返回 { ok:false, error:{ code, message } }。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { readDocx, docToText } from './docx-read.js'
import { createDocx, writeDocx } from './docx-write.js'
import { readXlsx, sheetToText } from './xlsx-read.js'
import { createXlsx, writeXlsx } from './xlsx-write.js'
import { applySheetOp, findSheet } from './sheet-ops.js'

const OK = (value) => ({ ok: true, value })
const FAIL = (code, message) => ({ ok: false, error: { code, message } })

/** 办公柱管的两类文件：Word 文档与 Excel 表格。 */
const DOC_EXT = new Set(['.docx', '.doc'])
const SHEET_EXT = new Set(['.xlsx', '.xlsm'])
const OFFICE_EXT = new Set([...DOC_EXT, ...SHEET_EXT])

const kindOf = (name) => {
  const ext = extname(name).toLowerCase()
  if (SHEET_EXT.has(ext)) return 'xlsx'
  if (DOC_EXT.has(ext)) return 'docx'
  return 'other'
}

function hashOf(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 16)
}

/** 原子写：先写临时文件再 rename，断电也不会留半截文档。 */
function writeAtomic(path, buffer) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, buffer)
    renameSync(tmp, path)
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      /* 清理失败不影响主错误 */
    }
    throw error
  }
}

function assertDocPath(path) {
  if (typeof path !== 'string' || path.trim() === '') throw new Error('path 不能为空')
  const ext = extname(path).toLowerCase()
  if (!DOC_EXT.has(ext)) throw new Error(`只支持 .docx（收到 ${ext || '无扩展名'}）`)
}

function assertSheetPath(path) {
  if (typeof path !== 'string' || path.trim() === '') throw new Error('path 不能为空')
  const ext = extname(path).toLowerCase()
  if (!SHEET_EXT.has(ext)) throw new Error(`只支持 .xlsx（收到 ${ext || '无扩展名'}）`)
}

export function createDocService(ctx, config = {}) {
  const root = typeof config.root === 'string' && config.root !== '' ? resolve(config.root) : process.cwd()
  const logger = ctx.logger

  /** 允许的路径：绝对路径直接用；相对路径相对 root。 */
  const resolvePath = (path) => (isAbsolute(path) ? resolve(path) : resolve(root, path))

  return {
    root,

    /** 把相对路径解析成绝对路径（面板下载原始字节时用）。 */
    resolve(path) {
      return resolvePath(path)
    },

    /** 轻量状态：只回 hash/大小/时间，给面板轮询「有没有被改动」用。 */
    stat(path) {
      const abs = resolvePath(String(path ?? ''))
      if (path === undefined || path === null || path === '') return FAIL('path/invalid', 'path 不能为空')
      if (!existsSync(abs)) return FAIL('file/missing', `文件不存在：${abs}`)
      const st = statSync(abs)
      const buffer = readFileSync(abs)
      return OK({ path: abs, hash: hashOf(buffer), bytes: st.size, mtime: st.mtime.toISOString() })
    },

    /** 列出某个目录下的办公文件（.docx 与 .xlsx，默认 root）。 */
    list(dir) {
      const base = dir === undefined || dir === '' ? root : resolvePath(dir)
      if (!existsSync(base)) return FAIL('dir/missing', `目录不存在：${base}`)
      const out = []
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (!entry.isFile()) continue
        if (!OFFICE_EXT.has(extname(entry.name).toLowerCase())) continue
        const abs = join(base, entry.name)
        const stat = statSync(abs)
        out.push({
          name: entry.name,
          path: abs,
          rel: relative(root, abs).split(/[\\/]/).join('/'),
          kind: kindOf(entry.name),
          bytes: stat.size,
          mtime: stat.mtime.toISOString(),
        })
      }
      out.sort((a, b) => b.mtime.localeCompare(a.mtime))
      return OK({ root, dir: base, count: out.length, files: out })
    },

    /**
     * 扫一遍整棵数据目录：按一级目录（业务域）分组列出办公文件。
     * 协会文档天然按域归档，所以不需要谁再手工建索引。
     */
    scan() {
      const groups = new Map()
      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.')) continue
          const abs = join(dir, entry.name)
          if (entry.isDirectory()) {
            walk(abs)
            continue
          }
          if (!OFFICE_EXT.has(extname(entry.name).toLowerCase())) continue
          const rel = relative(root, abs).split(/[\\/]/)
          const domain = rel.length > 1 ? rel[0] : '(根目录)'
          const stat = statSync(abs)
          const bucket = groups.get(domain) ?? []
          bucket.push({
            name: entry.name,
            path: abs,
            rel: rel.join('/'),
            kind: kindOf(entry.name),
            bytes: stat.size,
            mtime: stat.mtime.toISOString(),
          })
          groups.set(domain, bucket)
        }
      }
      if (existsSync(root)) walk(root)
      const domains = [...groups.entries()].map(([domain, files]) => {
        files.sort((a, b) => b.mtime.localeCompare(a.mtime))
        return { domain, count: files.length, files }
      }).sort((a, b) => b.files[0].mtime.localeCompare(a.files[0].mtime))
      return OK({ root, domains, total: domains.reduce((sum, d) => sum + d.count, 0) })
    },

    // ---------------------------------------------------------------- 表格

    /** 读表格模型（所有工作表）。 */
    readSheet(path) {
      try {
        assertSheetPath(path)
      } catch (error) {
        return FAIL('path/invalid', error.message)
      }
      const abs = resolvePath(path)
      if (!existsSync(abs)) return FAIL('file/missing', `文件不存在：${abs}`)
      try {
        const buffer = readFileSync(abs)
        const { sheets, parts } = readXlsx(buffer)
        return OK({
          path: abs,
          name: abs.split(/[\\/]/).pop(),
          kind: 'xlsx',
          hash: hashOf(buffer),
          bytes: buffer.length,
          sheets,
          parts,
        })
      } catch (error) {
        return FAIL('xlsx/parse-failed', `解析失败：${error.message}`)
      }
    },

    /** 存表格模型（sheet 数量不能比原文件多 —— 新增工作表不在这一版范围）。 */
    saveSheet(path, model, baseHash) {
      try {
        assertSheetPath(path)
      } catch (error) {
        return FAIL('path/invalid', error.message)
      }
      const abs = resolvePath(path)
      if (model === null || typeof model !== 'object' || !Array.isArray(model.sheets) || model.sheets.length === 0) {
        return FAIL('model/invalid', 'model.sheets 必须是非空数组')
      }
      let original
      if (existsSync(abs)) {
        original = readFileSync(abs)
        const current = hashOf(original)
        if (typeof baseHash === 'string' && baseHash !== '' && baseHash !== current) {
          return FAIL('sheet/conflict', `文件已被改动（现有 ${current}，你打开的是 ${baseHash}）。先刷新再保存。`)
        }
      }
      try {
        const buffer = writeXlsx(model, original)
        writeAtomic(abs, buffer)
        return OK({ path: abs, hash: hashOf(buffer), bytes: buffer.length })
      } catch (error) {
        return FAIL('xlsx/write-failed', `写入失败：${error.message}`)
      }
    },

    /** 新建一个表格（单工作表，已存在则拒绝）。 */
    createSheet(path, sheetName) {
      try {
        assertSheetPath(path)
      } catch (error) {
        return FAIL('path/invalid', error.message)
      }
      const abs = resolvePath(path)
      if (existsSync(abs)) return FAIL('file/exists', `文件已存在：${abs}`)
      try {
        const name = typeof sheetName === 'string' && sheetName.trim() !== '' ? sheetName.trim() : 'Sheet1'
        const buffer = createXlsx({ sheetName: name })
        writeAtomic(abs, buffer)
        return OK({ path: abs, hash: hashOf(buffer), bytes: buffer.length, sheetName: name })
      } catch (error) {
        return FAIL('xlsx/create-failed', `创建失败：${error.message}`)
      }
    },

    /** 按操作改表格（给 agent 用）：读 → 逐条 apply → 写。 */
    editSheet(path, ops, sheetName) {
      if (!Array.isArray(ops) || ops.length === 0) return FAIL('ops/invalid', 'ops 必须是非空数组')
      const read = this.readSheet(path)
      if (!read.ok) return read
      const model = { sheets: read.value.sheets }
      let sheet
      try {
        sheet = findSheet(model, sheetName)
      } catch (error) {
        return FAIL('sheet/not-found', error.message)
      }
      const applied = []
      for (const [index, op] of ops.entries()) {
        try {
          applied.push({ op: op?.op ?? '?', result: applySheetOp(sheet, op) })
        } catch (error) {
          return FAIL('ops/failed', `第 ${index + 1} 个操作失败（${op?.op ?? '?'}）：${error.message}`)
        }
      }
      const saved = this.saveSheet(path, model, read.value.hash)
      if (!saved.ok) return saved
      return OK({
        path: saved.value.path,
        hash: saved.value.hash,
        sheet: sheet.name,
        width: sheet.width,
        height: sheet.height,
        applied,
        preview: sheetToText(sheet, { maxRows: 20 }),
      })
    },
    sheetText(path, sheetName) {
      const read = this.readSheet(path)
      if (!read.ok) return read
      const sheet = sheetName === undefined
        ? read.value.sheets[0]
        : read.value.sheets.find((item) => item.name === sheetName)
      if (sheet === undefined) {
        return FAIL('sheet/not-found', `没有工作表：${sheetName}（现有 ${read.value.sheets.map((s) => s.name).join(', ')}）`)
      }
      return OK({
        path: read.value.path,
        name: sheet.name,
        width: sheet.width,
        height: sheet.height,
        ...(sheet.truncated === true ? { truncated: true } : {}),
        text: sheetToText(sheet),
      })
    },

    /** 读文档模型。 */
    read(path) {
      try {
        assertDocPath(path)
      } catch (error) {
        return FAIL('path/invalid', error.message)
      }
      const abs = resolvePath(path)
      if (!existsSync(abs)) return FAIL('file/missing', `文件不存在：${abs}`)
      try {
        const buffer = readFileSync(abs)
        const model = readDocx(buffer)
        return OK({
          path: abs,
          name: abs.split(/[\\/]/).pop(),
          hash: hashOf(buffer),
          bytes: buffer.length,
          model,
        })
      } catch (error) {
        return FAIL('docx/parse-failed', `解析失败：${error.message}`)
      }
    },

    /** 存文档模型。baseHash 用于发现「别人也改了」。 */
    save(path, model, baseHash) {
      try {
        assertDocPath(path)
      } catch (error) {
        return FAIL('path/invalid', error.message)
      }
      const abs = resolvePath(path)
      if (model === null || typeof model !== 'object' || !Array.isArray(model.blocks)) {
        return FAIL('model/invalid', 'model.blocks 必须是数组')
      }
      let original
      let currentHash
      if (existsSync(abs)) {
        original = readFileSync(abs)
        currentHash = hashOf(original)
        if (typeof baseHash === 'string' && baseHash !== '' && baseHash !== currentHash) {
          return FAIL(
            'doc/conflict',
            `文件已被改动（现有 ${currentHash}，你打开的是 ${baseHash}）。先刷新再保存，避免覆盖别人的修改。`,
          )
        }
      }
      try {
        const buffer = writeDocx(model, original)
        writeAtomic(abs, buffer)
        return OK({ path: abs, hash: hashOf(buffer), bytes: buffer.length })
      } catch (error) {
        return FAIL('docx/write-failed', `写入失败：${error.message}`)
      }
    },

    /** 新建一个空文档（已存在则拒绝，避免覆盖）。 */
    create(path, title) {
      try {
        assertDocPath(path)
      } catch (error) {
        return FAIL('path/invalid', error.message)
      }
      const abs = resolvePath(path)
      if (existsSync(abs)) return FAIL('file/exists', `文件已存在：${abs}`)
      const blocks = []
      if (typeof title === 'string' && title.trim() !== '') {
        blocks.push({ type: 'p', kind: 'title', runs: [{ text: title.trim(), bold: false, italic: false, underline: false, strike: false, caps: false }] })
      }
      blocks.push({ type: 'p', kind: 'p', runs: [{ text: '', bold: false, italic: false, underline: false, strike: false, caps: false }] })
      try {
        const buffer = createDocx({ blocks })
        writeAtomic(abs, buffer)
        return OK({ path: abs, hash: hashOf(buffer), bytes: buffer.length })
      } catch (error) {
        return FAIL('docx/create-failed', `创建失败：${error.message}`)
      }
    },

    /** 纯文本视图（给 agent 快速看内容）。 */
    text(path) {
      const result = this.read(path)
      if (!result.ok) return result
      return OK({ path: result.value.path, text: docToText(result.value.model) })
    },

    /**
     * 结构化编辑：读 → 改 → 写。所有 op 都是「按位置定位」的小动作，
     * 比让模型重写整篇更省 token，也不会顺手改坏别的段。
     */
    edit(path, ops) {
      if (!Array.isArray(ops) || ops.length === 0) return FAIL('ops/invalid', 'ops 必须是非空数组')
      const read = this.read(path)
      if (!read.ok) return read
      const { model, hash } = read.value

      const results = []
      for (const [index, op] of ops.entries()) {
        try {
          results.push(applyOp(model, op))
        } catch (error) {
          return FAIL('ops/failed', `第 ${index + 1} 个操作失败（${op?.op ?? '?'}）：${error.message}`)
        }
      }

      const saved = this.save(path, model, hash)
      if (!saved.ok) return saved
      return OK({ path: saved.value.path, hash: saved.value.hash, applied: results })
    },
  }
}

// ---------------------------------------------------------------- 编辑操作

const BLANK_RUN = { text: '', bold: false, italic: false, underline: false, strike: false, caps: false }

function cloneRunFormat(run) {
  const { text, bold, italic, underline, strike, caps, size, color, font, highlight } = run ?? {}
  const out = { text: '', bold: bold ?? false, italic: italic ?? false, underline: underline ?? false, strike: strike ?? false, caps: caps ?? false }
  if (size !== undefined) out.size = size
  if (color !== undefined) out.color = color
  if (font !== undefined) out.font = font
  if (highlight !== undefined) out.highlight = highlight
  return out
}

function paragraphText(block) {
  return (block.runs ?? []).map((run) => run.text).join('')
}

function requireIndex(model, index, what = '段落') {
  if (!Number.isInteger(index) || index < 0 || index >= model.blocks.length) {
    throw new Error(`${what}下标越界：${index}（当前 ${model.blocks.length} 个顶层块，从 0 开始）`)
  }
}

function parseKind(kind) {
  const allowed = ['p', 'title', 'subtitle', 'quote', 'list', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']
  if (kind === undefined) return 'p'
  if (!allowed.includes(kind)) throw new Error(`未知段落类型 ${kind}，可用：${allowed.join(' / ')}`)
  return kind
}

function applyOp(model, op) {
  if (op === null || typeof op !== 'object') throw new Error('操作必须是对象')
  switch (op.op) {
    case 'set_text': {
      requireIndex(model, op.index)
      const block = model.blocks[op.index]
      if (block.type !== 'p') throw new Error('set_text 只能用于段落（表格请用 set_cell）')
      const format = cloneRunFormat(block.runs[0])
      format.text = String(op.text ?? '')
      block.runs = format.text === '' ? [] : [format]
      return { op: 'set_text', index: op.index, text: format.text }
    }
    case 'set_runs': {
      requireIndex(model, op.index)
      const block = model.blocks[op.index]
      if (block.type !== 'p') throw new Error('set_runs 只能用于段落')
      if (!Array.isArray(op.runs)) throw new Error('runs 必须是数组')
      block.runs = op.runs.map((run) => ({ ...BLANK_RUN, ...run, text: String(run.text ?? '') }))
      return { op: 'set_runs', index: op.index, runs: block.runs.length }
    }
    case 'set_kind': {
      requireIndex(model, op.index)
      const block = model.blocks[op.index]
      if (block.type !== 'p') throw new Error('set_kind 只能用于段落')
      block.kind = parseKind(op.kind)
      if (block.kind === 'list' && op.level !== undefined) block.level = Number(op.level) || 0
      delete block.style
      return { op: 'set_kind', index: op.index, kind: block.kind }
    }
    case 'set_align': {
      requireIndex(model, op.index)
      const block = model.blocks[op.index]
      if (block.type !== 'p') throw new Error('set_align 只能用于段落')
      const allowed = ['left', 'center', 'right', 'justify', 'none']
      if (!allowed.includes(op.align)) throw new Error(`align 可用值：${allowed.join(' / ')}`)
      if (op.align === 'none') delete block.align
      else block.align = op.align
      return { op: 'set_align', index: op.index, align: op.align }
    }
    case 'insert': {
      const at = op.index === undefined ? model.blocks.length : op.index
      if (!Number.isInteger(at) || at < 0 || at > model.blocks.length) {
        throw new Error(`插入位置越界：${at}（0..${model.blocks.length}）`)
      }
      const paragraph = {
        type: 'p',
        kind: parseKind(op.kind),
        runs: [{ ...BLANK_RUN, text: String(op.text ?? '') }],
      }
      model.blocks.splice(at, 0, paragraph)
      return { op: 'insert', index: at, kind: paragraph.kind }
    }
    case 'delete': {
      requireIndex(model, op.index)
      const [removed] = model.blocks.splice(op.index, 1)
      return { op: 'delete', index: op.index, removed: removed.type === 'p' ? paragraphText(removed) : '[表格]' }
    }
    case 'set_cell': {
      requireIndex(model, op.index, '表格')
      const table = model.blocks[op.index]
      if (table.type !== 'table') throw new Error('set_cell 的目标必须是表格')
      const row = Number(op.row)
      const col = Number(op.col)
      if (!Number.isInteger(row) || row < 0 || row >= table.rows.length) {
        throw new Error(`行号越界：${row}（该表 ${table.rows.length} 行）`)
      }
      const line = table.rows[row]
      if (!Number.isInteger(col) || col < 0 || col >= line.length) {
        throw new Error(`列号越界：${col}（该行 ${line.length} 列）`)
      }
      const cell = line[col]
      const first = cell.blocks.find((b) => b.type === 'p')
      const format = cloneRunFormat(first?.runs?.[0])
      format.text = String(op.text ?? '')
      cell.blocks = [{ type: 'p', kind: 'p', runs: format.text === '' ? [] : [format] }]
      return { op: 'set_cell', index: op.index, row, col, text: format.text }
    }
    case 'replace_text': {
      const find = String(op.find ?? '')
      if (find === '') throw new Error('find 不能为空')
      const replace = String(op.replace ?? '')
      const limit = Number.isInteger(op.limit) ? op.limit : Number.POSITIVE_INFINITY
      let count = 0
      const visit = (blocks) => {
        for (const block of blocks) {
          if (count >= limit) return
          if (block.type === 'p') {
            for (const run of block.runs) {
              if (count >= limit) break
              if (!run.text.includes(find)) continue
              const parts = run.text.split(find)
              count += parts.length - 1
              run.text = parts.join(replace)
            }
          } else if (block.type === 'table') {
            for (const line of block.rows) for (const cell of line) visit(cell.blocks)
          }
        }
      }
      visit(model.blocks)
      return { op: 'replace_text', find, replace, count }
    }
    case 'append_table': {
      const rows = Number(op.rows)
      const cols = Number(op.cols)
      if (!Number.isInteger(rows) || rows < 1 || rows > 200) throw new Error('rows 必须是 1..200 的整数')
      if (!Number.isInteger(cols) || cols < 1 || cols > 30) throw new Error('cols 必须是 1..30 的整数')
      const gridWidth = Math.floor(9360 / cols)
      const created = {
        type: 'table',
        grid: Array.from({ length: cols }, () => gridWidth),
        rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({
          blocks: [{ type: 'p', kind: 'p', runs: [] }],
        }))),
      }
      model.blocks.push(created)
      return { op: 'append_table', index: model.blocks.length - 1, rows, cols }
    }
    default:
      throw new Error(`未知操作 ${op.op}，可用：set_text / set_runs / set_kind / set_align / insert / delete / set_cell / replace_text / append_table`)
  }
}

export { OK, FAIL, paragraphText, hashOf }
