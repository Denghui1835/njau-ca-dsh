/**
 * smoke-code.mjs —— 开发柱的冒烟测试。
 *
 * 覆盖：插件契约 → 项目发现 → 文件树（跳过噪音目录）→ 读/写/冲突/越界/二进制
 *      → 白名单运行（真跑一次 npm script）→ 拒绝任意命令 → 真 HTTP。
 *
 * 不依赖 dsh：node tests/smoke-code.mjs
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = join(ROOT, 'packages', 'code', 'lib', 'index.js')

const problems = []
const check = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    problems.push(msg)
    console.log(`  ✗ ${msg}`)
  }
}

// ------------------------------------------------------------ 造一个真项目

const dataRoot = mkdtempSync(join(tmpdir(), 'njau-code-smoke-'))
process.env.NJAU_CA_DATA = dataRoot
writeFileSync(join(dataRoot, 'identity.json'), JSON.stringify({ fullName: '南京农业大学计算机爱好者协会', shortName: '南农计协' }), 'utf8')

const projectDir = join(dataRoot, 'site', 'portal')
mkdirSync(join(projectDir, 'src'), { recursive: true })
mkdirSync(join(projectDir, 'node_modules', 'left-pad'), { recursive: true })
mkdirSync(join(dataRoot, 'media', 'manju'), { recursive: true })

writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
  name: 'portal',
  version: '0.1.0',
  scripts: { build: 'node build.js', ping: 'node build.js' },
}, null, 2), 'utf8')
writeFileSync(join(projectDir, 'build.js'), "console.log('built ok')\n", 'utf8')
writeFileSync(join(projectDir, 'index.html'), '<!doctype html><title>portal</title>\n', 'utf8')
writeFileSync(join(projectDir, 'src', 'app.js'), "const greeting = 'hello'\nconsole.log(greeting)\n", 'utf8')
writeFileSync(join(projectDir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1\n', 'utf8')
writeFileSync(join(projectDir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]), 'utf8')

// 静态页项目（没有 package.json）也要能被发现
mkdirSync(join(dataRoot, 'site', 'landing'), { recursive: true })
writeFileSync(join(dataRoot, 'site', 'landing', 'index.html'), '<!doctype html><title>landing</title>\n', 'utf8')

// 一个真 git 仓库，用来测只读 git 命令
const gitDir = join(dataRoot, 'learning', 'git-demo')
mkdirSync(gitDir, { recursive: true })
writeFileSync(join(gitDir, 'README.md'), '# git demo\n', 'utf8')
let gitReady = false
try {
  execFileSync('git', ['init', '-q'], { cwd: gitDir })
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '.'], { cwd: gitDir })
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: gitDir })
  gitReady = true
} catch {
  gitReady = false
}

// ------------------------------------------------------------ 假 ctx

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

const code = makeCtx()
const mod = await import(pathToFileURL(ENTRY).href)

console.log('--- 插件契约 ---')
check(mod.name === '@njau-ca/dsh-njau-code', '插件 name')
check(mod.inject.includes('webServer'), 'inject 里有 webServer')
mod.apply(code.ctx, {})
check(code.tools.size === 6, `注册 6 个工具（实际 ${code.tools.size}）`)
check(code.routes.length === 1 && code.routes[0].path === '/njau/api/code', '注册了 /njau/api/code')
check(code.sections.length === 1, '加了一段系统提示词')

for (const [name, def] of code.tools) {
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
  const matched = code.routes
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

console.log('--- 项目发现 ---')
const health = await api('GET', '/njau/api/code/health')
check(health.status === 200 && health.data.value.service === 'njau-code', 'health 通')
check(health.data.value.roots.length === 2, '两个项目根（site / learning）')

const projects = await api('GET', '/njau/api/code/projects')
check(projects.status === 200, 'projects 200')
check(projects.data.value.count === 3, `扫到 ${projects.data.value.count} 个项目（portal / landing / git-demo）`)
const portal = projects.data.value.projects.find((p) => p.id === 'site/portal')
check(portal?.hasPackage === true, 'portal 认出了 package.json')
check(portal?.scripts.includes('build') === true, `portal scripts: ${portal?.scripts.join(',')}`)
check(portal?.packageManager === 'npm', `包管理器 ${portal?.packageManager}`)
const landing = projects.data.value.projects.find((p) => p.id === 'site/landing')
check(landing?.hasPackage === false, 'landing 是静态页项目（无 package.json）')
check(landing !== undefined, '没有 package.json 的项目也能被发现')

console.log('--- 文件树 ---')
const tree = await api('GET', '/njau/api/code/tree?project=site%2Fportal')
check(tree.status === 200, 'tree 200')
const names = tree.data.value.nodes.map((node) => node.name)
check(names.includes('src'), '有 src 目录')
check(names.includes('package.json'), '有 package.json')
check(!names.includes('node_modules'), 'node_modules 被跳过')
check(tree.data.value.hasGit === false, 'portal 不是 git 仓库')
const srcDir = tree.data.value.nodes.find((node) => node.name === 'src')
check(srcDir?.children?.some((child) => child.name === 'app.js' && child.language === 'javascript'), 'src/app.js 识别为 javascript')

console.log('--- 读写文件 ---')
const filePath = 'src/app.js'
const read = await api('GET', `/njau/api/code/file?project=site%2Fportal&path=${encodeURIComponent(filePath)}`)
check(read.status === 200, '读文件 200')
check(read.data.value.text.includes("const greeting = 'hello'"), '内容正确')
check(read.data.value.language === 'javascript', `语言 ${read.data.value.language}`)
// 行数按「换行分段」算：文件以 \n 结尾时末尾还有一个空行 —— 和编辑器里光标能落到那一行一致。
check(read.data.value.lines === 3, `行数 ${read.data.value.lines}（两行内容 + 末尾空行）`)
check(typeof read.data.value.hash === 'string' && read.data.value.hash.length === 16, 'hash 16 位')

const newText = "const greeting = '你好'\nconsole.log(greeting)\nexport default greeting\n"
const saved = await api('POST', '/njau/api/code/file', {
  project: 'site/portal', path: filePath, text: newText, baseHash: read.data.value.hash,
})
check(saved.status === 200, '保存 200')
check(readFileSync(join(projectDir, 'src', 'app.js'), 'utf8') === newText, '磁盘内容已更新')

const conflict = await api('POST', '/njau/api/code/file', {
  project: 'site/portal', path: filePath, text: 'x', baseHash: read.data.value.hash,
})
check(conflict.status === 409 && conflict.data.error.code === 'file/conflict', '过期 baseHash → 409')

const newFile = await api('POST', '/njau/api/code/file', {
  project: 'site/portal', path: 'src/deep/new-file.ts', text: 'export const x = 1\n',
})
check(newFile.status === 200 && existsSync(join(projectDir, 'src', 'deep', 'new-file.ts')), '可建新文件（自动建目录）')

console.log('--- 越界与诡异文件 ---')
const traversal = await api('GET', `/njau/api/code/file?project=site%2Fportal&path=${encodeURIComponent('../../../identity.json')}`)
check(traversal.status === 400 && traversal.data.error.code === 'path/invalid', '路径穿越被拒')
const outside = await api('GET', '/njau/api/code/tree?project=media%2Fmanju')
check(outside.status === 400 && outside.data.error.code === 'project/invalid', 'site/learning 之外的项目被拒')
const binary = await api('GET', `/njau/api/code/file?project=site%2Fportal&path=logo.png`)
check(binary.status === 415 && binary.data.error.code === 'file/binary', '二进制文件被拒（415）')
const missing = await api('GET', `/njau/api/code/file?project=site%2Fportal&path=nope.js`)
check(missing.status === 404 && missing.data.error.code === 'file/missing', '缺文件 → 404')

console.log('--- 白名单运行 ---')
const runBuild = await api('POST', '/njau/api/code/run', { project: 'site/portal', action: 'npm:run:build' })
check(runBuild.status === 200, 'npm:run:build 200')
check(runBuild.data.value.code === 0, `退出码 ${runBuild.data.value.code}`)
check(runBuild.data.value.stdout.includes('built ok'), `输出含 built ok（${JSON.stringify(runBuild.data.value.stdout.trim())}）`)
check(runBuild.data.value.durationMs >= 0, `耗时 ${runBuild.data.value.durationMs}ms`)

const badScript = await api('POST', '/njau/api/code/run', { project: 'site/portal', action: 'npm:run:deploy' })
check(badScript.status === 400 && badScript.data.error.code === 'run/unknown-script', '未声明的 script → 400')
const arbitrary = await api('POST', '/njau/api/code/run', { project: 'site/portal', action: 'rm -rf /' })
check(arbitrary.status === 400 && arbitrary.data.error.code === 'run/unsupported', '任意命令被拒（run/unsupported）')
const noGit = await api('POST', '/njau/api/code/run', { project: 'site/portal', action: 'git:status' })
check(noGit.status === 400 && noGit.data.error.code === 'run/no-git', '非 git 项目跑 git → 400')
const staticProj = await api('POST', '/njau/api/code/run', { project: 'site/landing', action: 'npm:run:build' })
check(staticProj.status === 400 && staticProj.data.error.code === 'run/no-package', '静态页项目跑 script → 400')

if (gitReady) {
  const gitStatus = await api('POST', '/njau/api/code/run', { project: 'learning/git-demo', action: 'git:status' })
  check(gitStatus.status === 200 && gitStatus.data.value.code === 0, 'git:status 在真仓库上跑通')
  check(/on branch|##/i.test(gitStatus.data.value.stdout), `git 输出像正常 status（${JSON.stringify(gitStatus.data.value.stdout.slice(0, 40))}）`)
  const gitLog = await api('POST', '/njau/api/code/run', { project: 'learning/git-demo', action: 'git:log' })
  check(gitLog.data.value.stdout.includes('init'), 'git:log 能读到提交')
} else {
  console.log('  - 跳过 git 检查（本机 git 初始化失败）')
}

console.log('--- 工具路径 ---')
const tool = (name, args) => code.tools.get(name).execute(args ?? {})
const toolProjects = tool('njau_code_projects')
check(toolProjects.count === 3, `工具 list 到 ${toolProjects.count} 个项目`)
const toolRead = tool('njau_code_read', { project: 'site/portal', path: 'package.json' })
check(JSON.parse(toolRead.text).name === 'portal', '工具 read 能读 package.json')
const toolTree = tool('njau_code_tree', { project: 'site/portal' })
check(toolTree.nodes.length > 0, '工具 tree 有节点')
const toolWrite = tool('njau_code_write', { project: 'site/portal', path: 'src/from-tool.txt', text: 'hello\n' })
check(existsSync(join(projectDir, 'src', 'from-tool.txt')), '工具 write 真写盘')
const toolStatus = tool('njau_code_status')
check(toolStatus.service === 'njau-code' && toolStatus.actions.length === 6, 'status 工具列全动作')

console.log('--- 防呆 ---')
const unknownRoute = await api('GET', '/njau/api/code/nope')
check(unknownRoute.status === 404 && unknownRoute.data.error.code === 'route/unknown', '未知路由 404')
const noProjectArg = await api('GET', '/njau/api/code/tree')
check(noProjectArg.status === 400, '缺 project → 400')
check(effects.length >= 2, `注册 ${effects.length} 个 effect`)

await new Promise((resolve) => server.close(resolve))
rmSync(dataRoot, { recursive: true, force: true })

console.log('')
if (problems.length === 0) {
  console.log('✓ smoke-code PASSED')
} else {
  console.log(`✗ ${problems.length} 项未通过：`)
  for (const problem of problems) console.log(`   - ${problem}`)
}
process.exitCode = problems.length > 0 ? 1 : 0
