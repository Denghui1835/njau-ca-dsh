/**
 * smoke-manju.mjs —— 漫剧柱的冒烟测试。
 *
 * 覆盖：插件契约 → 项目生命周期（新建/读/写/冲突）→ 分镜操作（增删改排序）
 *      → 数据修复（坏 JSON 救回来）→ 素材直出（含越界防护）→ 真 HTTP。
 *
 * 不依赖 dsh：node tests/smoke-manju.mjs
 */

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = join(ROOT, 'packages', 'manju', 'lib', 'index.js')

const problems = []
const check = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    problems.push(msg)
    console.log(`  ✗ ${msg}`)
  }
}

// ------------------------------------------------------------ 假 ctx

const dataRoot = mkdtempSync(join(tmpdir(), 'njau-manju-smoke-'))
process.env.NJAU_CA_DATA = dataRoot
writeFileSync(join(dataRoot, 'identity.json'), JSON.stringify({
  fullName: '南京农业大学计算机爱好者协会',
  shortName: '南农计协',
  schoolYear: '2026-2027',
}), 'utf8')

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

const manju = makeCtx()
const mod = await import(pathToFileURL(ENTRY).href)

console.log('--- 插件契约 ---')
check(mod.name === '@njau-ca/dsh-njau-manju', '插件 name')
check(mod.inject.includes('webServer'), 'inject 里有 webServer')
mod.apply(manju.ctx, {})
check(manju.tools.size === 6, `注册 6 个工具（实际 ${manju.tools.size}）`)
check(manju.routes.length === 1 && manju.routes[0].path === '/njau/api/manju', '注册了 /njau/api/manju')
check(manju.sections.length === 1, '加了一段系统提示词')

for (const [name, def] of manju.tools) {
  const bad = []
  if (!def.description) bad.push('description')
  if (def.parameters?.type !== 'object') bad.push('parameters.type')
  if (!Array.isArray(def.parameters?.required)) bad.push('required[]')
  if (typeof def.output?.render !== 'function') bad.push('output.render')
  if (typeof def.execute !== 'function') bad.push('execute')
  if (!['read', 'write', 'idempotent', 'destroy'].includes(def.behavior)) bad.push('behavior')
  check(bad.length === 0, `${name} ${bad.length ? '缺: ' + bad.join(',') : '契约 ok'}`)
}

// ------------------------------------------------------------ 真 HTTP

const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname
  const matched = manju.routes
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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json()
  return { status: response.status, data }
}

console.log('--- 项目生命周期 ---')
const health = await api('GET', '/njau/api/manju/health')
check(health.status === 200 && health.data.value.service === 'njau-manju', 'health 通')
check(health.data.value.base === join(dataRoot, 'media', 'manju'), 'base 指向 media/manju')

const empty = await api('GET', '/njau/api/manju/projects')
check(empty.status === 200 && empty.data.value.count === 0, '起初 0 个项目')

const created = await api('POST', '/njau/api/manju/new', { name: '招新宣传漫剧' })
check(created.status === 200 && created.data.value.name === '招新宣传漫剧', '新建项目 200')
check(existsSync(join(dataRoot, 'media', 'manju', '招新宣传漫剧', '剧本.md')), '剧本.md 落盘')
check(existsSync(join(dataRoot, 'media', 'manju', '招新宣传漫剧', 'storyboard.json')), 'storyboard.json 落盘')
const board0 = JSON.parse(readFileSync(join(dataRoot, 'media', 'manju', '招新宣传漫剧', 'storyboard.json'), 'utf8'))
check(board0.format === 'njau-manju/storyboard@1', '新项目带格式标记')
check(Array.isArray(board0.panels) && board0.panels.length === 0, 'panels 初始为空')

const dup = await api('POST', '/njau/api/manju/new', { name: '招新宣传漫剧' })
check(dup.status === 409 && dup.data.error.code === 'project/exists', '重名 → 409')

const evilName = await api('POST', '/njau/api/manju/new', { name: '../../evil' })
check(evilName.status === 200 && evilName.data.value.name === 'evil', '穿越名被清洗成 evil')
check(existsSync(join(dataRoot, 'media', 'manju', 'evil')), '落在 media/manju 里')

const read = await api('GET', `/njau/api/manju/project?name=${encodeURIComponent('招新宣传漫剧')}`)
check(read.status === 200, '读项目 200')
check(read.data.value.script.includes('# 招新宣传漫剧'), '剧本模板已就位')
check(typeof read.data.value.boardHash === 'string' && read.data.value.boardHash.length === 16, 'boardHash 16 位')
check(read.data.value.nextStep === '再拆分镜', `下一步 = ${read.data.value.nextStep}`)

console.log('--- 分镜编辑（HTTP 整表保存） ---')
const board = read.data.value.board
board.title = '招新宣传漫剧'
board.logline = '一个新生第一次走进机房'
board.panels.push({
  id: 'p1', shot: 1, desc: '机房里一排显示器，光线偏暗',
  dialogue: [{ who: '旁白', line: '九月的南京，还很热。', emotion: '' }],
  duration: 3, characters: [], asset: null, status: 'todo', notes: '',
})
const saved = await api('POST', '/njau/api/manju/board', {
  name: '招新宣传漫剧',
  board,
  baseHash: read.data.value.boardHash,
})
check(saved.status === 200, '保存分镜 200')
check(saved.data.value.boardHash !== read.data.value.boardHash, '保存后 hash 变了')

const conflict = await api('POST', '/njau/api/manju/board', {
  name: '招新宣传漫剧',
  board,
  baseHash: read.data.value.boardHash,
})
check(conflict.status === 409 && conflict.data.error.code === 'board/conflict', '过期 baseHash → 409')

console.log('--- 分镜操作（工具路径） ---')
const tool = (name, args) => manju.tools.get(name).execute(args ?? {})

const added = tool('njau_manju_edit', {
  name: '招新宣传漫剧',
  ops: [
    { op: 'add_panel', desc: '主角推门，逆光', duration: 2.5, dialogue: [{ who: '小明', line: '这就是机房？', emotion: '好奇' }] },
    { op: 'add_panel', desc: '学长回头，笑' },
    { op: 'set_panel', id: 'p3', status: 'drawn' },
    { op: 'set_field', field: 'title', value: '招新宣传漫剧（修订）' },
  ],
})
check(added.applied?.length === 4, `执行 ${added.applied?.length} 个操作`)
check(added.totalDuration === 8.5, `总时长 ${added.totalDuration} 秒（3 + 2.5 + 3）`)
check(added.outline.title === '招新宣传漫剧（修订）', 'set_field 生效')
check(added.outline.panels.length === 3, `现在 ${added.outline.panels.length} 格`)
check(added.outline.panels[2].status === 'drawn', 'set_panel 改状态生效')
check(added.outline.panels[0].gaps.join(',') === '画面', '第 1 格的缺口只有「画面」')

const moved = tool('njau_manju_edit', { name: '招新宣传漫剧', ops: [{ op: 'move_panel', id: 'p3', to: 1 }] })
check(moved.outline.panels[0].id === 'p3', 'move_panel 把 p3 移到第 1')
check(moved.outline.panels.map((p) => p.shot).join(',') === '1,2,3', '镜号按位置重排')

const deleted = tool('njau_manju_edit', { name: '招新宣传漫剧', ops: [{ op: 'delete_panel', id: 'p2' }] })
check(deleted.outline.panels.length === 2, 'delete_panel 后剩 2 格')
check(!deleted.outline.panels.some((p) => p.id === 'p2'), 'p2 已消失')
const nextId = tool('njau_manju_edit', { name: '招新宣传漫剧', ops: [{ op: 'add_panel', desc: '结尾定格' }] })
check(nextId.outline.panels.some((p) => p.id === 'p4'), '新格 id 不撞号（p4）')

const badOp = tool('njau_manju_edit', { name: '招新宣传漫剧', ops: [{ op: 'set_panel', id: 'nope', desc: 'x' }] })
check(badOp.ok === false && badOp.error.code === 'ops/failed', '未知 panel id → ops/failed')
const badStatus = tool('njau_manju_edit', { name: '招新宣传漫剧', ops: [{ op: 'set_panel', id: 'p1', status: 'drawing' }] })
check(badStatus.ok === false && badStatus.error.code === 'ops/failed', '非法 status → ops/failed')

console.log('--- 剧本与素材 ---')
const scriptWrite = tool('njau_manju_script_write', {
  name: '招新宣传漫剧',
  text: '# 招新宣传漫剧\n\n## 第 1 集\n小明第一次走进机房，学长在等他。\n',
})
check(scriptWrite.ok !== false && typeof scriptWrite.scriptHash === 'string', '剧本整篇写入成功')
const afterScript = tool('njau_manju_read', { name: '招新宣传漫剧' })
check(afterScript.script.includes('小明第一次走进机房'), '读回剧本内容')

// 造一张 1x1 PNG 当出图产物
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001' +
  '0d0a2db40000000049454e44ae426082',
  'hex',
)
mkdirSync(join(dataRoot, 'media', 'manju', '招新宣传漫剧', 'assets'), { recursive: true })
writeFileSync(join(dataRoot, 'media', 'manju', '招新宣传漫剧', 'assets', 'p1.png'), PNG)

const withAsset = tool('njau_manju_edit', {
  name: '招新宣传漫剧',
  ops: [{ op: 'set_panel', id: 'p1', asset: 'assets/p1.png', status: 'drawn' }],
})
const assetPanel = withAsset.outline.panels.find((panel) => panel.id === 'p1')
check(assetPanel?.asset === 'assets/p1.png', 'asset 已登记到分镜')
check(assetPanel?.gaps.length === 0, '这一格缺口清空')

const assetRes = await fetch(`${base}/njau/api/manju/asset?name=${encodeURIComponent('招新宣传漫剧')}&path=assets/p1.png`)
const assetBytes = Buffer.from(await assetRes.arrayBuffer())
check(assetRes.status === 200, '素材接口 200')
check(assetRes.headers.get('content-type') === 'image/png', 'content-type 是 image/png')
check(assetBytes.equals(PNG), `素材字节一致（${assetBytes.length} 字节）`)

const escape = await api('GET', `/njau/api/manju/asset?name=${encodeURIComponent('招新宣传漫剧')}&path=../evil/剧本.md`)
check(escape.status === 400 && escape.data.error.code === 'path/invalid', '素材路径穿越被拒')
const missingAsset = await api('GET', `/njau/api/manju/asset?name=${encodeURIComponent('招新宣传漫剧')}&path=assets/nope.png`)
check(missingAsset.status === 404 && missingAsset.data.error.code === 'asset/missing', '缺素材 → 404')
const badType = await api('GET', `/njau/api/manju/asset?name=${encodeURIComponent('招新宣传漫剧')}&path=storyboard.json`)
check(badType.status === 415 && badType.data.error.code === 'asset/unsupported', '非媒体文件 → 415')

console.log('--- 坏数据修复 ---')
const brokenDir = join(dataRoot, 'media', 'manju', '坏项目')
mkdirSync(brokenDir, { recursive: true })
writeFileSync(join(brokenDir, 'storyboard.json'), '{ "panels": [ { "desc": "只有描述" }, ', 'utf8')
const repaired = tool('njau_manju_read', { name: '坏项目' })
check(repaired.ok !== false, '坏 JSON 也能读（不抛）')
check(repaired.panels.length === 0, '坏 JSON 当作空分镜表')

writeFileSync(join(brokenDir, 'storyboard.json'), JSON.stringify({
  panels: [
    { desc: '缺 id 和 shot' },
    { id: 'dup', shot: 'x', duration: 'abc' },
    { id: 'dup', desc: '重复 id' },
  ],
}), 'utf8')
const normalized = tool('njau_manju_read', { name: '坏项目' })
check(normalized.panels.length === 3, '三格都保留（不丢东西）')
check(new Set(normalized.panels.map((p) => p.id)).size === 3, '重复 id 被消重')
check(normalized.panels.every((p) => Number.isFinite(p.duration) && p.duration > 0), '坏时长被兜成默认值')
check(normalized.panels.map((p) => p.shot).join(',') === '1,2,3', '镜号被补齐')

console.log('--- 列表与下一步 ---')
const list = tool('njau_manju_list')
check(list.count === 3, `列出 ${list.count} 个项目（招新宣传漫剧 / evil / 坏项目）`)
const main = list.projects.find((p) => p.name === '招新宣传漫剧')
check(main.panels === 3, `主项目 ${main.panels} 格`)
check(main.drawn === 1, `已出图 ${main.drawn} 格`)
check(main.nextStep === '2 格还没出图', `下一步 = ${main.nextStep}`)

const status = tool('njau_manju_status')
check(status.service === 'njau-manju' && status.tools.length === 5, 'status 工具列全')

console.log('--- 防呆 ---')
const unknown = await api('GET', '/njau/api/manju/nope')
check(unknown.status === 404 && unknown.data.error.code === 'route/unknown', '未知路由 404')
const noName = await api('GET', '/njau/api/manju/project')
check(noName.status === 400 && noName.data.error.code === 'name/invalid', '缺 name → 400')
const missingProject = await api('GET', '/njau/api/manju/project?name=没有这个项目')
check(missingProject.status === 404 && missingProject.data.error.code === 'project/missing', '不存在的项目 → 404')

check(effects.length >= 2, `注册 ${effects.length} 个 effect`)

await new Promise((resolve) => server.close(resolve))
rmSync(dataRoot, { recursive: true, force: true })

console.log('')
if (problems.length === 0) {
  console.log('✓ smoke-manju PASSED')
} else {
  console.log(`✗ ${problems.length} 项未通过：`)
  for (const problem of problems) console.log(`   - ${problem}`)
}
process.exitCode = problems.length > 0 ? 1 : 0
