/**
 * smoke-pptx.mjs —— 办公柱「幻灯片」能力的冒烟测试。
 *
 * 覆盖：契约 → 新建 .pptx → 读（页/形状/段落）→ 按操作改（标题/段落/加段落/删段落/层级）
 *      → 并发冲突 → 跨类型防呆 → 大纲 → 真 HTTP → 落盘后再读回。
 *
 * 不依赖 dsh、不依赖 PowerPoint：node tests/smoke-pptx.mjs
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

const dataRoot = mkdtempSync(join(tmpdir(), 'njau-pptx-smoke-'))
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
check(office.tools.has('njau_office_deck_read'), '有幻灯片读工具')
check(office.tools.has('njau_office_deck_edit'), '有幻灯片改工具')
check(office.tools.has('njau_office_deck_create'), '有幻灯片建工具')

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

console.log('--- 新建演示文稿 ---')
const created = await api('POST', '/njau/api/office/new-deck', { path: 'events/2026-招新宣讲.pptx', title: '招新宣讲' })
check(created.status === 200, '新建 200')
check(existsSync(join(dataRoot, 'events', '2026-招新宣讲.pptx')), '文件真的落盘')
check(created.data.value.title === '招新宣讲', `标题 ${created.data.value.title}`)

const dup = await api('POST', '/njau/api/office/new-deck', { path: 'events/2026-招新宣讲.pptx' })
check(dup.status === 409 && dup.data.error.code === 'file/exists', '重名 → 409')

console.log('--- 读 ---')
const read = await api('GET', `/njau/api/office/deck?path=${encodeURIComponent('events/2026-招新宣讲.pptx')}`)
check(read.status === 200, '读 200')
check(read.data.value.slides.length === 1, `1 页（${read.data.value.slides.length}）`)
check(read.data.value.size.width === 12192000, `画布宽 ${read.data.value.size.width} EMU`)
const slide0 = read.data.value.slides[0]
check(slide0.title === '招新宣讲', `第 1 页标题 ${slide0.title}`)
check(slide0.shapes.length === 2, `2 个文字形状（${slide0.shapes.length}）`)
check(typeof slide0.part === 'string' && slide0.part.startsWith('ppt/slides/'), `部件路径 ${slide0.part}`)

const wrongType = await api('GET', `/njau/api/office/deck?path=${encodeURIComponent('events/x.docx')}`)
check(wrongType.status === 400 && wrongType.data.error.code === 'path/invalid', '.docx 当幻灯片读 → 400')

console.log('--- 按操作改（工具路径） ---')
const tool = (name, args) => office.tools.get(name).execute(args ?? {})

const edited = tool('njau_office_deck_edit', {
  path: 'events/2026-招新宣讲.pptx',
  ops: [
    { op: 'set_title', slide: 0, text: '南农计协 2026 招新宣讲' },
    { op: 'set_text', slide: 0, shape: 1, index: 0, text: '我们是谁' },
    { op: 'add_paragraph', slide: 0, text: '成立于 2010 年', level: 1 },
    { op: 'add_paragraph', slide: 0, text: '现有成员 80+' },
    { op: 'set_level', slide: 0, shape: 1, index: 2, level: 1 },
  ],
})
check(edited.ok !== false, '5 个操作执行成功')
check(edited.applied.length === 5, `执行 ${edited.applied.length} 个操作`)
check(edited.outline.includes('南农计协 2026 招新宣讲'), '大纲里有新标题')
check(edited.outline.includes('成立于 2010 年'), '大纲里有新要点')

const reread = await api('GET', `/njau/api/office/deck?path=${encodeURIComponent('events/2026-招新宣讲.pptx')}`)
check(reread.status === 200, '保存后回读 200')
const after = reread.data.value.slides[0]
check(after.title === '南农计协 2026 招新宣讲', '标题落盘')
check(after.shapes[1].paragraphs.length === 3, `正文 ${after.shapes[1].paragraphs.length} 段`)
check(after.shapes[1].paragraphs[1].level === 1, '第 2 段层级 = 1')
check(after.shapes[1].paragraphs[2].text === '现有成员 80+', '第 3 段内容正确')

console.log('--- 删段落与冲突 ---')
const trimmed = tool('njau_office_deck_edit', {
  path: 'events/2026-招新宣讲.pptx',
  ops: [{ op: 'delete_paragraph', slide: 0, shape: 1, index: 2 }],
})
check(trimmed.ok !== false, '删段落成功')
check(trimmed.slides[0].shapes[1].paragraphs.length === 2, `删后 ${trimmed.slides[0].shapes[1].paragraphs.length} 段`)

const conflict = await api('POST', '/njau/api/office/deck', {
  path: 'events/2026-招新宣讲.pptx',
  model: { slides: after ? [{ part: after.part, shapes: after.shapes }] : [] },
  baseHash: read.data.value.hash,
})
check(conflict.status === 409 && conflict.data.error.code === 'deck/conflict', '过期 baseHash → 409')

console.log('--- 防呆 ---')
const badSlide = tool('njau_office_deck_edit', {
  path: 'events/2026-招新宣讲.pptx',
  ops: [{ op: 'set_title', slide: 9, text: 'x' }],
})
check(badSlide.ok === false && badSlide.error.code === 'ops/failed', '页下标越界 → ops/failed')
const badShape = tool('njau_office_deck_edit', {
  path: 'events/2026-招新宣讲.pptx',
  ops: [{ op: 'set_text', slide: 0, shape: 9, index: 0, text: 'x' }],
})
check(badShape.ok === false && badShape.error.code === 'ops/failed', '形状下标越界 → ops/failed')
const badExt = await api('POST', '/njau/api/office/new-deck', { path: 'events/x.xlsx' })
check(badExt.status === 400 && badExt.data.error.code === 'path/invalid', '扩展名不对 → 400')

console.log('--- 扫描与 status ---')
const scan = await api('GET', '/njau/api/office/scan')
check(scan.data.value.domains[0].files[0].kind === 'pptx', `scan kind=${scan.data.value.domains[0].files[0].kind}`)
const status = tool('njau_office_status')
check(status.tools.length === 10, `status 列了 ${status.tools.length} 个工具`)
check(effects.length >= 1, `注册 ${effects.length} 个 effect`)

await new Promise((resolve) => server.close(resolve))
rmSync(dataRoot, { recursive: true, force: true })

console.log('')
if (problems.length === 0) {
  console.log('✓ smoke-pptx PASSED')
} else {
  console.log(`✗ ${problems.length} 项未通过：`)
  for (const problem of problems) console.log(`   - ${problem}`)
}
process.exitCode = problems.length > 0 ? 1 : 0
