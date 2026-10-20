/**
 * sheet-ops.js —— 表格的结构化编辑操作（给 agent 用）。
 *
 * 面板是把整张表读出来改完再存（模型在客户端），
 * 但 agent 不该整表重写 —— 那既费 token 又容易把别人的修改冲掉。
 * 所以这里提供「按单元格/按行」的小动作，和文档那边的 ops 一个思路。
 *
 * 定位方式两种：
 *   - ref："B3" 这种 A1 记法（推荐，和 Excel 里看到的一致）
 *   - row + col：都从 0 开始（给程序算出来的坐标用）
 */

import { cellRef, parseRef } from './xlsx-read.js'

const MAX_ROWS = 5000
const MAX_COLS = 64

function ensureShape(sheet, rows, cols) {
  while (sheet.rows.length < rows) {
    sheet.rows.push([])
  }
  for (const row of sheet.rows) {
    while (row.length < cols) row.push(null)
  }
  sheet.height = Math.max(sheet.height ?? 0, sheet.rows.length)
  sheet.width = Math.max(sheet.width ?? 0, cols)
}

function locate(op) {
  if (typeof op.ref === 'string' && op.ref.trim() !== '') {
    const parsed = parseRef(op.ref)
    if (parsed === null) throw new Error(`ref 不是合法的 A1 记法：${op.ref}`)
    return parsed
  }
  const row = Number(op.row)
  const col = Number(op.col)
  if (!Number.isInteger(row) || row < 0) throw new Error('row 必须是非负整数（从 0 开始）')
  if (!Number.isInteger(col) || col < 0) throw new Error('col 必须是非负整数（从 0 开始）')
  return { row, col }
}

/**
 * 执行一个表格操作。纯函数：改的是传进来的 sheet，返回人能看懂的回执。
 * @param {object} sheet 工作表模型
 * @param {object} op
 */
export function applySheetOp(sheet, op) {
  if (op === null || typeof op !== 'object') throw new Error('操作必须是对象')
  switch (op.op) {
    case 'set_cell': {
      const { row, col } = locate(op)
      if (row >= MAX_ROWS || col >= MAX_COLS) {
        throw new Error(`超出上限（${MAX_ROWS} 行 × ${MAX_COLS} 列）：${cellRef(col, row)}`)
      }
      ensureShape(sheet, row + 1, col + 1)
      const previous = sheet.rows[row][col]
      const cell = {}
      const value = op.value === undefined || op.value === null ? '' : String(op.value)
      if (value !== '') cell.v = value
      else cell.v = ''
      if (typeof op.formula === 'string' && op.formula !== '') {
        cell.f = op.formula.replace(/^=/, '')
      }
      if (op.style !== undefined && op.style !== null) cell.s = String(op.style)
      else if (previous?.s !== undefined) cell.s = previous.s
      sheet.rows[row][col] = cell.v === '' && cell.f === undefined ? null : cell
      return `${cellRef(col, row)} = ${cell.f === undefined ? value : `=${cell.f}`}`
    }
    case 'clear_cell': {
      const { row, col } = locate(op)
      ensureShape(sheet, row + 1, col + 1)
      sheet.rows[row][col] = null
      return `${cellRef(col, row)} 已清空`
    }
    case 'insert_row': {
      const at = op.index === undefined ? sheet.rows.length : Number(op.index)
      if (!Number.isInteger(at) || at < 0 || at > sheet.rows.length) {
        throw new Error(`插入行位置越界：${at}（0..${sheet.rows.length}）`)
      }
      const width = sheet.width ?? 1
      sheet.rows.splice(at, 0, Array.from({ length: width }, () => null))
      sheet.height = sheet.rows.length
      return `在第 ${at + 1} 行插入空行`
    }
    case 'delete_row': {
      const at = Number(op.index)
      if (!Number.isInteger(at) || at < 0 || at >= sheet.rows.length) {
        throw new Error(`删除行位置越界：${at}（0..${sheet.rows.length - 1}）`)
      }
      sheet.rows.splice(at, 1)
      sheet.height = Math.max(1, sheet.rows.length)
      return `删除第 ${at + 1} 行`
    }
    case 'set_row': {
      const at = Number(op.index)
      if (!Number.isInteger(at) || at < 0) throw new Error('index 必须是非负整数')
      const values = Array.isArray(op.values) ? op.values : null
      if (values === null) throw new Error('set_row 需要 values 数组')
      ensureShape(sheet, at + 1, Math.max(sheet.width ?? 1, values.length))
      const row = sheet.rows[at] ?? []
      values.forEach((value, col) => {
        const text = value === undefined || value === null ? '' : String(value)
        row[col] = text === '' ? null : { v: text }
      })
      sheet.rows[at] = row
      return `第 ${at + 1} 行写入 ${values.length} 个值`
    }
    case 'set_sheet_name': {
      const name = String(op.name ?? '').trim()
      if (name === '') throw new Error('name 不能为空')
      if (name.length > 31) throw new Error('工作表名不能超过 31 个字符')
      const previous = sheet.name
      sheet.name = name
      return `工作表「${previous}」改名为「${name}」`
    }
    default:
      throw new Error(
        `未知操作 ${op.op}，可用：set_cell / clear_cell / insert_row / delete_row / set_row / set_sheet_name`,
      )
  }
}

/** 找工作表：不传名字就第一张。 */
export function findSheet(model, name) {
  if (!Array.isArray(model.sheets) || model.sheets.length === 0) throw new Error('这个表格没有工作表')
  if (name === undefined || name === null || name === '') return model.sheets[0]
  const found = model.sheets.find((sheet) => sheet.name === name)
  if (found === undefined) {
    throw new Error(`没有工作表「${name}」（现有 ${model.sheets.map((s) => s.name).join(', ')}）`)
  }
  return found
}
