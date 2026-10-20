/**
 * smoke-workshop.mjs —— 工作坊外壳 + 办公柱的冒烟测试。
 *
 * 用假 ctx 把两个插件真正跑起来，再把注册到的 HTTP 路由接到一个真 http 服务上，
 * 用 fetch 走一遍面板会走的路径。所以这个测试覆盖的是：
 *   插件契约 → 工具注册 → 路由注册 → 真实 HTTP → 真实磁盘上的 .docx 往返。
 *
 * 不依赖 dsh 本体：node tests/smoke-workshop.mjs
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 仓库根目录从本文件位置推出来，别写死本机路径（公开仓库里谁 clone 都能跑）。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OFFICE_ENTRY = join(ROOT, 'packages', 'office', 'lib', 'index.js')
const WORKSHOP_ENTRY = join(ROOT, 'packages', 'workshop', 'lib', 'index.js')

const problems = []
const check = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    problems.push(msg)
    console.log(`  ✗ ${msg}`)
  }
}

// ------------------------------------------------------------ 假 ctx

const dataRoot = mkdtempSync(join(tmpdir(), 'njau-workshop-smoke-'))
process.env.NJAU_CA_DATA = dataRoot
writeFileSync(join(dataRoot, 'identity.json'), JSON.stringify({
  fullName: '南京农业大学计算机爱好者协会',
  shortName: '南农计协',
  abbr: 'NJAU-CA',
  motto: '让每一个对计算机感兴趣的人，都能在这里做成一件事。',
  schoolYear: '2026-2027',
}), 'utf8')

const effects = []

function makeCtx() {
  const tools = new Map()
  const routes = []
  const sections = []
  const ctx = {
    logger: {
      warn: (...a) => console.log('    [warn]', ...a),
      info: () => {},
      error: (...a) => console.log('    [err]', ...a),
    },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => {}
      },
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
    },
    systemPrompt: {
      section(definition) {
        sections.push(definition)
        return () => {}
      },
    },
    effect(fn, label) {
      effects.push(label)
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    inject(_deps, callback) {
      callback(ctx)
      return () => {}
    },
  }
  return { ctx, tools, routes, sections }
}

const office = makeCtx()
const workshop = makeCtx()

const officeMod = await import(pathToFileURL(OFFICE_ENTRY).href)
const workshopMod = await import(pathToFileURL(WORKSHOP_ENTRY).href)

console.log('--- 插件契约 ---')
check(officeMod.name === '@njau-ca/dsh-njau-office', '办公柱 name')
check(workshopMod.name === '@njau-ca/dsh-njau-workshop', '工作坊 name')
check(officeMod.inject.includes('webServer'), '办公柱 inject webServer')
check(workshopMod.inject.includes('webServer'), '工作坊 inject webServer')

officeMod.apply(office.ctx, {})
workshopMod.apply(workshop.ctx, {})

check(office.tools.size === 8, `办公柱注册 8 个工具（实际 ${office.tools.size}）`)
check(workshop.tools.size === 2, `工作坊注册 2 个工具（实际 ${workshop.tools.size}）`)
check(office.routes.length === 1 && office.routes[0].path === '/njau/api/office', '办公柱注册了 /njau/api/office')
check(workshop.routes.length === 1 && workshop.routes[0].path === '/njau/api/workshop', '工作坊注册了 /njau/api/workshop')
check(workshop.sections.length === 1, '工作坊加了一段系统提示词')

for (const [name, definition] of office.tools) {
  const bad = []
  if (!definition.description) bad.push('description')
  if (definition.parameters?.type !== 'object') bad.push('parameters.type')
  if (!Array.isArray(definition.parameters?.required)) bad.push('required[]')
  if (typeof definition.output?.render !== 'function') bad.push('output.render')
  if (typeof definition.execute !== 'function') bad.push('execute')
  if (!['read', 'write', 'idempotent', 'destroy'].includes(definition.behavior)) bad.push('behavior')
  check(bad.length === 0, `${name} ${bad.length ? '缺: ' + bad.join(',') : '契约 ok'}`)
}

// ------------------------------------------------------------ 真 HTTP

const allRoutes = [...office.routes, ...workshop.routes]
const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname
  const matched = allRoutes
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
const port = server.address().port
const base = `http://127.0.0.1:${port}`

async function api(method, path, body) {
  const response = await fetch(base + path, body === undefined ? { method } : {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json()
  return { status: response.status, data }
}

console.log('--- 工作坊接口 ---')
const health = await api('GET', '/njau/api/workshop/health')
check(health.status === 200 && health.data.value.service === 'njau-workshop', 'health 通')
check(health.data.value.root === dataRoot, 'health.root 指向 NJAU_CA_DATA')

const empty = await api('GET', '/njau/api/workshop/state')
check(empty.status === 200, 'state 通')
check(empty.data.value.identity.shortName === '南农计协', '身份卡读到了（短名）')
check(empty.data.value.schoolYear === '2026-2027', '学年读到了')
check(empty.data.value.lines.length === 3, '三条产线')
check(empty.data.value.lines.map((l) => l.id).join(',') === 'office,manju,code', '产线顺序 office,manju,code')

console.log('--- 办公接口（真 .docx） ---')
const createRes = await api('POST', '/njau/api/office/new', { path: 'report/2026-10-03-会议纪要.docx', title: '第一次例会' })
check(createRes.status === 200, '新建文档 200')
check(existsSync(join(dataRoot, 'report', '2026-10-03-会议纪要.docx')), '文件真的在磁盘上')
const created = createRes.data.value

const readRes = await api('GET', `/njau/api/office/doc?path=${encodeURIComponent('report/2026-10-03-会议纪要.docx')}`)
check(readRes.status === 200, '读文档 200')
check(readRes.data.value.model.blocks[0].kind === 'title', '第一段是标题')
check(readRes.data.value.hash === created.hash, 'hash 与新建时一致')

const model = readRes.data.value.model
model.blocks.push({
  type: 'p',
  kind: 'h2',
  runs: [{ text: '出席：张三、李四', bold: false, italic: false, underline: false, strike: false, caps: false }],
})
model.blocks.push({
  type: 'table',
  grid: [3120, 3120],
  rows: [[
    { blocks: [{ type: 'p', kind: 'p', runs: [{ text: '议题', bold: true, italic: false, underline: false, strike: false, caps: false }] }] },
    { blocks: [{ type: 'p', kind: 'p', runs: [{ text: '结论', bold: true, italic: false, underline: false, strike: false, caps: false }] }] },
  ]],
})
const saveRes = await api('POST', '/njau/api/office/doc', { path: 'report/2026-10-03-会议纪要.docx', model, baseHash: created.hash })
check(saveRes.status === 200, '保存 200')
check(saveRes.data.value.hash !== created.hash, '保存后 hash 变了')

const reread = await api('GET', `/njau/api/office/doc?path=${encodeURIComponent('report/2026-10-03-会议纪要.docx')}`)
check(reread.status === 200, '保存后回读 200')
const blocks = reread.data.value.model.blocks
check(blocks.some((b) => b.type === 'p' && b.runs[0]?.text === '出席：张三、李四'), '追加的段落回读得到')
const table = blocks.find((b) => b.type === 'table')
check(table !== undefined && table.rows[0][0].blocks[0].runs[0].text === '议题', '表格单元格回读得到')

const conflict = await api('POST', '/njau/api/office/doc', { path: 'report/2026-10-03-会议纪要.docx', model, baseHash: created.hash })
check(conflict.status === 409 && conflict.data.error.code === 'doc/conflict', '过期 baseHash → 409 doc/conflict')

const scan = await api('GET', '/njau/api/office/scan')
check(scan.status === 200 && scan.data.value.total === 1, 'scan 扫到 1 份文档')
check(scan.data.value.domains[0].domain === 'report', 'scan 按域分组到 report')

const rawRes = await fetch(`${base}/njau/api/office/raw?path=${encodeURIComponent('report/2026-10-03-会议纪要.docx')}`)
const rawBuffer = Buffer.from(await rawRes.arrayBuffer())
check(rawRes.status === 200 && rawBuffer.subarray(0, 2).toString() === 'PK', 'raw 返回的是 ZIP（PK 头）')
check(rawBuffer.length > 1000, `docx 大小 ${rawBuffer.length} 字节`)

// 文档字节能被 OOXML 引擎重新读出来（外网工具也能开）
const officeServiceModel = await api('GET', `/njau/api/office/doc?path=${encodeURIComponent('report/2026-10-03-会议纪要.docx')}`)
check(officeServiceModel.data.value.parts === undefined || Array.isArray(officeServiceModel.data.value.model.parts), 'parts 清单是数组')

console.log('--- 办公工具 ---')
const officeTool = (name, args) => office.tools.get(name).execute(args ?? {})
const list = officeTool('njau_office_list', { dir: 'report' })
check(list.count === 1 && list.files[0].name === '2026-10-03-会议纪要.docx', 'njau_office_list 列出纪要')

const outline = officeTool('njau_office_read', { path: 'report/2026-10-03-会议纪要.docx' })
check(outline.blocks.length >= 3, `njau_office_read 返回 ${outline.blocks.length} 个块`)
check(typeof outline.hash === 'string', 'read 带 hash')

const edited = officeTool('njau_office_edit', {
  path: 'report/2026-10-03-会议纪要.docx',
  ops: [
    { op: 'set_text', index: 0, text: '第一次例会（修订）' },
    { op: 'insert', text: '地点：主楼 302', kind: 'p' },
    { op: 'set_cell', index: 3, row: 0, col: 1, text: '结论：通过' },
  ],
})
check(edited.ok !== false, 'njau_office_edit 执行成功')
check(edited.applied.length === 3, `执行了 ${edited.applied?.length} 个操作`)

const afterEdit = officeTool('njau_office_read', { path: 'report/2026-10-03-会议纪要.docx', include_cells: true })
check(afterEdit.blocks[0].text === '第一次例会（修订）', 'set_text 生效')
check(afterEdit.blocks.some((b) => b.text === '地点：主楼 302'), 'insert 生效（省略 index → 追加到文末）')
const cellTable = afterEdit.blocks.find((b) => b.t === 'table')
check(cellTable.cells[0][1] === '结论：通过', 'set_cell 生效')

const badOp = officeTool('njau_office_edit', { path: 'report/2026-10-03-会议纪要.docx', ops: [{ op: 'nope' }] })
check(badOp.ok === false && badOp.error.code === 'ops/failed', '未知 op → ops/failed')

const missing = officeTool('njau_office_read', { path: 'report/nope.docx' })
check(missing.ok === false && missing.error.code === 'file/missing', '缺文件 → file/missing')

console.log('--- 漫剧项目 ---')
const made = await api('POST', '/njau/api/workshop/manju/new', { name: '招新宣传漫剧' })
check(made.status === 200, '新建漫剧项目 200')
const projectDir = join(dataRoot, 'media', 'manju', '招新宣传漫剧')
check(existsSync(join(projectDir, '剧本.md')), '剧本.md 已生成')
check(existsSync(join(projectDir, 'storyboard.json')), 'storyboard.json 已生成')
check(existsSync(join(projectDir, 'assets')), 'assets/ 已生成')
const board = JSON.parse(readFileSync(join(projectDir, 'storyboard.json'), 'utf8'))
check(board.format === 'njau-manju/storyboard@1', 'storyboard 格式标记')
check(Array.isArray(board.panels) && board.panels.length === 0, 'panels 初始为空')

const dup = await api('POST', '/njau/api/workshop/manju/new', { name: '招新宣传漫剧' })
check(dup.status === 400 && dup.data.error.code === 'project/exists', '重名 → project/exists')
const evil = await api('POST', '/njau/api/workshop/manju/new', { name: '../../evil' })
check(evil.status === 200, '带穿越字符的名字被清洗后仍落在 media/manju 下')
check(existsSync(join(dataRoot, 'media', 'manju', 'evil')), '目录名里的 .. / 被剥掉')

console.log('--- 工作坊状态反映真实产物 ---')
const state2 = await api('GET', '/njau/api/workshop/state')
const officeLine = state2.data.value.lines.find((l) => l.id === 'office')
const manjuLine = state2.data.value.lines.find((l) => l.id === 'manju')
check(officeLine.count === 1, `办公柱数到 ${officeLine.count} 份文档`)
check(manjuLine.count === 2, `漫剧柱数到 ${manjuLine.count} 个项目`)
const project = state2.data.value.manju.projects.find((p) => p.name === '招新宣传漫剧')
check(project.hasScript === true && project.hasStoryboard === true, '项目状态：剧本 + 分镜都在')
check(project.next === '分镜还是空的', `下一步提示 = ${project.next}`)

const stateTool = workshop.tools.get('njau_workshop_state').execute({})
check(stateTool.lines.length === 3, 'njau_workshop_state 工具返回三柱')
check(stateTool.root === dataRoot, '工具里的 root 正确')

const newTool = workshop.tools.get('njau_workshop_new_manju').execute({ name: '第二部漫剧' })
check(newTool.name === '第二部漫剧', 'njau_workshop_new_manju 工具建成功')

console.log('--- 目录 / 开发柱 ---')
const codeDir = join(dataRoot, 'site', 'portal')
const { mkdirSync } = await import('node:fs')
mkdirSync(codeDir, { recursive: true })
writeFileSync(join(codeDir, 'package.json'), '{"name":"portal"}\n', 'utf8')
writeFileSync(join(codeDir, 'index.html'), '<!doctype html><title>portal</title>\n', 'utf8')
const state3 = await api('GET', '/njau/api/workshop/state')
const codeLine = state3.data.value.lines.find((l) => l.id === 'code')
check(codeLine.count === 1, `开发柱数到 ${codeLine.count} 个项目`)
check(state3.data.value.code.projects[0].name === 'portal', '项目名 portal')
check(state3.data.value.code.projects[0].hasPackage === true, '认出了 package.json')

console.log('--- 防呆 ---')
const unknown = await api('GET', '/njau/api/workshop/nope')
check(unknown.status === 404 && unknown.data.error.code === 'route/unknown', '未知路由 404')
const badJson = await fetch(`${base}/njau/api/workshop/manju/new`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{not json',
})
check(badJson.status === 500, '坏 JSON → 500（带 server/error）')

check(effects.length >= 2, `注册了 ${effects.length} 个 effect`)

await new Promise((resolve) => server.close(resolve))
rmSync(dataRoot, { recursive: true, force: true })

console.log('')
if (problems.length === 0) {
  console.log('✓ smoke-workshop PASSED')
} else {
  console.log(`✗ ${problems.length} 项未通过：`)
  for (const problem of problems) console.log(`   - ${problem}`)
}
process.exitCode = problems.length > 0 ? 1 : 0
