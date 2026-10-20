/**
 * smoke-sheet.mjs —— 办公柱「表格」能力的冒烟测试。
 *
 * 覆盖：契约 → 新建 .xlsx → 按操作改单元格/行/表名 → 并发冲突 → 跨类型防呆
 *      → 文本视图 → 真 HTTP → 落盘后再读回（引擎往返）。
 *
 * 不依赖 dsh：node tests/smoke-sheet.mjs
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = join(ROOT, 'packages', 'office', 'lib', 'index.js')

const problems = []
const check = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    problems.push(msg)
    console.log(`  ✗ ${msg}`)
  }
}

const dataRoot = mkdtempSync(join(tmpdir(), 'njau-sheet-smoke-'))
process.env.NJAU_CA_DATA = dataRoot
writeFileSync(join(dataRoot, 'identity.json'), JSON.stringify({ shortName: '南农计协' }), 'utf8')

const effects = []
const makeCtx = () => {
  const tools = new Map()
  const routes = []
  const sections = []
  const ctx = {
    logger: { warn: (...a) => console.log('    [warn]', ...a), info: () => {}, error: (...a) => console.log('    [err]', ...a) },
    tools: { register(def) { tools.set(def.name, def); return () => {} } },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
    },
    systemPrompt: { section(def) { sections.push(def); return () => {} } },
    effect(fn, label) {
      effects.push(label)
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    inject(_deps, callback) { callback(ctx); return () => {} },
  }
  return { ctx, tools, routes, sections }
}

const office = makeCtx()
const mod = await import(pathToFileURL(ENTRY).href)

console.log('--- 插件契约 ---')
check(mod.name === '@njau-ca/dsh-njau-office', '插件 name')
mod.apply(office.ctx, {})
check(office.tools.size === 11, `注册 11 个工具（实际 ${office.tools.size}）`)
check(office.routes.length === 1 && office.routes[0].path === '/njau/api/office', '注册了 /njau/api/office')
check(office.tools.has('njau_office_sheet_read'), '有表格读工具')
check(office.tools.has('njau_office_sheet_edit'), '有表格改工具')
check(office.tools.has('njau_office_sheet_create'), '有表格建工具')

// ------------------------------------------------------------ 真 HTTP

const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname
  const matched = office.routes
    .filter((route) => pathname === route.path || pathname.startsWith(`${route.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (matched === undefined) {
    res.writeHead(404)
    res.end('no route')
    return
  }
  void matched.handler(req, res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

async function api(method, path, body) {
  const response = await fetch(base + path, body === undefined ? { method } : {
    method,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  })
  const data = await response.json()
  return { status: response.status, data }
}

console.log('--- 新建表格 ---')
const created = await api('POST', '/njau/api/office/new-sheet', { path: 'finance/2026-10-报销单.xlsx', sheetName: '报销单' })
check(created.status === 200, '新建表格 200')
check(existsSync(join(dataRoot, 'finance', '2026-10-报销单.xlsx')), '文件真的落盘')
check(created.data.value.sheetName === '报销单', `表名 ${created.data.value.sheetName}`)

const dup = await api('POST', '/njau/api/office/new-sheet', { path: 'finance/2026-10-报销单.xlsx' })
check(dup.status === 409 && dup.data.error.code === 'file/exists', '重名 → 409')

const badExt = await api('POST', '/njau/api/office/new-sheet', { path: 'finance/x.docx' })
check(badExt.status === 400 && badExt.data.error.code === 'path/invalid', '扩展名不对 → 400')

console.log('--- 读表格 ---')
const read = await api('GET', `/njau/api/office/sheet?path=${encodeURIComponent('finance/2026-10-报销单.xlsx')}`)
check(read.status === 200, '读表格 200')
check(read.data.value.sheets.length === 1, `单表（${read.data.value.sheets.length}）`)
const sheet = read.data.value.sheets[0]
check(sheet.name === '报销单', `表名 ${sheet.name}`)
check(sheet.width === 1 && sheet.height === 1, `初始尺寸 ${sheet.width}x${sheet.height}`)
check(typeof read.data.value.hash === 'string', '带 hash')

const wrongType = await api('GET', `/njau/api/office/sheet?path=${encodeURIComponent('finance/nope.xlsx')}`)
check(wrongType.status === 404, '缺文件 → 404')
const docAsSheet = await api('GET', `/njau/api/office/sheet?path=${encodeURIComponent('finance/x.docx')}`)
check(docAsSheet.status === 400 && docAsSheet.data.error.code === 'path/invalid', '.docx 当表格读 → 400')

console.log('--- 按操作改单元格（工具路径） ---')
const tool = (name, args) => office.tools.get(name).execute(args ?? {})

const edited = tool('njau_office_sheet_edit', {
  path: 'finance/2026-10-报销单.xlsx',
  sheet: '报销单',
  ops: [
    { op: 'set_row', index: 0, values: ['项目', '金额', '备注'] },
    { op: 'set_row', index: 1, values: ['打印费', '38.5', '招新海报'] },
    { op: 'set_cell', ref: 'B3', value: '120', },
    { op: 'set_cell', ref: 'A3', value: '场地费' },
    { op: 'set_cell', ref: 'B4', formula: 'SUM(B2:B3)' },
    { op: 'set_sheet_name', name: '报销明细' },
  ],
})
check(edited.ok !== false, '6 个操作执行成功')
check(edited.applied.length === 6, `执行 ${edited.applied.length} 个操作`)
check(edited.sheet === '报销明细', `表名改成 ${edited.sheet}`)
check(edited.width === 3 && edited.height === 4, `尺寸 ${edited.width}x${edited.height}`)
check(edited.preview.includes('打印费'), '预览里有数据')

const reread = await api('GET', `/njau/api/office/sheet?path=${encodeURIComponent('finance/2026-10-报销单.xlsx')}`)
check(reread.status === 200, '保存后回读 200')
const after = reread.data.value.sheets[0]
check(after.name === '报销明细', '改名落盘了')
check(after.rows[0][0].v === '项目' && after.rows[0][2].v === '备注', '表头写入正确')
check(after.rows[1][1].v === '38.5', '数字单元格保留原文')
check(after.rows[3][1].f === 'SUM(B2:B3)', `公式保留（${after.rows[3][1].f}）`)

console.log('--- 冲突与越界 ---')
const conflict = await api('POST', '/njau/api/office/sheet', {
  path: 'finance/2026-10-报销单.xlsx',
  model: { sheets: after ? [after] : [] },
  baseHash: read.data.value.hash,
})
check(conflict.status === 409 && conflict.data.error.code === 'sheet/conflict', '过期 baseHash → 409')

const badOp = tool('njau_office_sheet_edit', {
  path: 'finance/2026-10-报销单.xlsx',
  ops: [{ op: 'set_cell', ref: '不是单元格', value: 'x' }],
})
check(badOp.ok === false && badOp.error.code === 'ops/failed', '非法 ref → ops/failed')

const noSheet = tool('njau_office_sheet_edit', {
  path: 'finance/2026-10-报销单.xlsx',
  sheet: '不存在的表',
  ops: [{ op: 'set_cell', ref: 'A1', value: 'x' }],
})
check(noSheet.ok === false && noSheet.error.code === 'sheet/not-found', '不存在的表 → sheet/not-found')

console.log('--- 读文本视图 ---')
const text = tool('njau_office_sheet_read', { path: 'finance/2026-10-报销单.xlsx' })
check(text.sheet === '报销明细', `读到 ${text.sheet}`)
check(text.text.split('\n')[0].startsWith('1\t项目'), `首行：${JSON.stringify(text.text.split('\n')[0])}`)
check(text.sheets.length === 1, '返回表清单')

console.log('--- 整表保存（面板路径） ---')
const model = { sheets: reread.data.value.sheets }
model.sheets[0].rows[1][2] = { v: '招新海报（已付）' }
const savedWhole = await api('POST', '/njau/api/office/sheet', {
  path: 'finance/2026-10-报销单.xlsx',
  model,
  baseHash: reread.data.value.hash,
})
check(savedWhole.status === 200, '整表保存 200')
const finalRead = await api('GET', `/njau/api/office/sheet?path=${encodeURIComponent('finance/2026-10-报销单.xlsx')}`)
check(finalRead.data.value.sheets[0].rows[1][2].v === '招新海报（已付）', '面板改的内容落盘')

console.log('--- 扫描把 xlsx 也数进去 ---')
const scan = await api('GET', '/njau/api/office/scan')
check(scan.status === 200 && scan.data.value.total === 1, `scan 扫到 ${scan.data.value.total} 个文件`)
check(scan.data.value.domains[0].files[0].kind === 'xlsx', `kind=${scan.data.value.domains[0].files[0].kind}`)

const list = await api('GET', '/njau/api/office/files')
check(list.data.value.files.every((file) => file.kind === 'xlsx'), '文件列表带 kind')

console.log('--- 防呆 ---')
const unknown = await api('GET', '/njau/api/office/nope')
check(unknown.status === 404, '未知路由 404')
const status = tool('njau_office_status')
check(status.tools.length === 10, `status 列了 ${status.tools.length} 个工具`)
check(effects.length >= 1, `注册 ${effects.length} 个 effect`)

await new Promise((resolve) => server.close(resolve))
rmSync(dataRoot, { recursive: true, force: true })

console.log('')
if (problems.length === 0) {
  console.log('✓ smoke-sheet PASSED')
} else {
  console.log(`✗ ${problems.length} 项未通过：`)
  for (const problem of problems) console.log(`   - ${problem}`)
}
process.exitCode = problems.length > 0 ? 1 : 0
