/**
 * verify-live.mjs —— 对一个**正在运行的** DSH 实例做端到端体检。
 *
 * 冒烟测试（tests/smoke-*.mjs）验的是代码；这个脚本验的是「装进 profile 之后真的能用」：
 * 插件加载了吗、HTTP 路由通不通、写下去的文件在不在磁盘上、素材能不能直出。
 *
 * 用法：
 *   node scripts/verify-live.mjs http://127.0.0.1:12345
 *
 * 它会建一个临时漫剧项目、写一格分镜、塞一张假图、走一遍素材接口，
 * 最后**把临时项目删掉**，不给协会数据留垃圾。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const base = (process.argv[2] ?? '').replace(/\/+$/, '')
if (base === '') {
  console.error('用法: node scripts/verify-live.mjs http://127.0.0.1:<port>')
  process.exit(2)
}

const problems = []
const check = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    problems.push(msg)
    console.log(`  ✗ ${msg}`)
  }
}

async function api(method, path, body) {
  const response = await fetch(base + path, body === undefined ? { method } : {
    method,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text.slice(0, 200) }
  }
  return { status: response.status, data }
}

const tempName = `_verify-${Date.now().toString(36)}`
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001' +
  '0d0a2db40000000049454e44ae426082',
  'hex',
)

console.log(`目标实例：${base}\n`)

console.log('--- 四条柱都在吗 ---')
const office = await api('GET', '/njau/api/office/health')
check(office.status === 200 && office.data.value?.service === 'njau-office', '办公柱 /njau/api/office/health')
const manju = await api('GET', '/njau/api/manju/health')
check(manju.status === 200 && manju.data.value?.service === 'njau-manju', '漫剧柱 /njau/api/manju/health')
const workshop = await api('GET', '/njau/api/workshop/health')
check(workshop.status === 200 && workshop.data.value?.service === 'njau-workshop', '工作坊 /njau/api/workshop/health')

console.log('\n--- 工作坊首页数据 ---')
const stateBefore = await api('GET', '/njau/api/workshop/state')
check(stateBefore.status === 200, 'state 可读')
check(Array.isArray(stateBefore.data.value?.lines) && stateBefore.data.value.lines.length === 3, '三条产线')
check(typeof stateBefore.data.value?.identity?.shortName === 'string', `身份：${stateBefore.data.value?.identity?.shortName}`)

console.log('\n--- 漫剧柱端到端（临时项目） ---')
const created = await api('POST', '/njau/api/manju/new', { name: tempName })
check(created.status === 200, `新建临时项目 ${tempName}`)
const manjuBase = manju.data.value.base
const projectDir = join(manjuBase, tempName)
check(existsSync(join(projectDir, '剧本.md')), '磁盘上真有 剧本.md')
check(existsSync(join(projectDir, 'storyboard.json')), '磁盘上真有 storyboard.json')

const read = await api('GET', `/njau/api/manju/project?name=${encodeURIComponent(tempName)}`)
check(read.status === 200, '读项目 200')
const board = read.data.value.board
board.panels = [{
  id: 'p1', shot: 1, desc: '机房逆光，主角推门', duration: 2.5,
  dialogue: [{ who: '小明', line: '这就是机房？', emotion: '好奇' }],
  characters: [], asset: 'assets/p1.png', status: 'drawn', notes: '',
}]
const saved = await api('POST', '/njau/api/manju/board', {
  name: tempName,
  board,
  baseHash: read.data.value.boardHash,
})
check(saved.status === 200, '保存分镜 200')

mkdirSync(join(projectDir, 'assets'), { recursive: true })
writeFileSync(join(projectDir, 'assets', 'p1.png'), PNG)
const asset = await fetch(`${base}/njau/api/manju/asset?name=${encodeURIComponent(tempName)}&path=assets/p1.png`)
const bytes = Buffer.from(await asset.arrayBuffer())
check(asset.status === 200, '素材直出 200')
check(asset.headers.get('content-type') === 'image/png', 'content-type 是 image/png')
check(bytes.equals(PNG), `素材字节一致（${bytes.length} 字节）`)

const traversal = await api('GET', `/njau/api/manju/asset?name=${encodeURIComponent(tempName)}&path=../evil.md`)
check(traversal.status === 400, '路径越界被拒（400）')

const stateAfter = await api('GET', '/njau/api/workshop/state')
const manjuLine = stateAfter.data.value.lines.find((line) => line.id === 'manju')
const manjuBefore = stateBefore.data.value.lines.find((line) => line.id === 'manju')
check(manjuLine.count === manjuBefore.count + 1, `工作坊数到了新项目（${manjuBefore.count} → ${manjuLine.count}）`)

const list = await api('GET', '/njau/api/manju/projects')
const mine = list.data.value.projects.find((project) => project.name === tempName)
check(mine !== undefined, '项目出现在列表里')
check(mine?.panels === 1, `列表显示 ${mine?.panels} 格`)
check(mine?.drawn === 1, '已出图 1 格')

console.log('\n--- 开发柱端到端（临时项目） ---')
const codeHealth = await api('GET', '/njau/api/code/health')
check(codeHealth.status === 200 && codeHealth.data.value?.service === 'njau-code', '开发柱 /njau/api/code/health')
check(Array.isArray(codeHealth.data.value?.roots) && codeHealth.data.value.roots.length === 2, '两个项目根（site / learning）')

const dataRoot = join(manjuBase, '..', '..')
const codeName = `_verify-code-${Date.now().toString(36)}`
const codeDir = join(dataRoot, 'site', codeName)
mkdirSync(join(codeDir, 'src'), { recursive: true })
mkdirSync(join(codeDir, 'node_modules', 'noise'), { recursive: true })
writeFileSync(join(codeDir, 'package.json'), JSON.stringify({
  name: codeName,
  version: '0.0.1',
  scripts: { echo: 'node echo.js' },
}, null, 2), 'utf8')
writeFileSync(join(codeDir, 'echo.js'), "console.log('verify-live ok')\n", 'utf8')
writeFileSync(join(codeDir, 'index.html'), '<!doctype html><title>verify</title>\n', 'utf8')
writeFileSync(join(codeDir, 'src', 'app.js'), "const a = 1\nconsole.log(a)\n", 'utf8')

const codeProjects = await api('GET', '/njau/api/code/projects')
const mineCode = codeProjects.data.value?.projects?.find((item) => item.id === `site/${codeName}`)
check(mineCode !== undefined, `项目被发现：site/${codeName}`)
check(mineCode?.scripts?.includes('echo') === true, `scripts 读到：${mineCode?.scripts?.join(',')}`)

const codeTree = await api('GET', `/njau/api/code/tree?project=${encodeURIComponent(`site/${codeName}`)}`)
check(codeTree.status === 200, '文件树 200')
const treeNames = (codeTree.data.value?.nodes ?? []).map((node) => node.name)
check(treeNames.includes('src'), '文件树里有 src')
check(!treeNames.includes('node_modules'), 'node_modules 被跳过')

const codeFile = await api('GET', `/njau/api/code/file?project=${encodeURIComponent(`site/${codeName}`)}&path=src%2Fapp.js`)
check(codeFile.status === 200 && codeFile.data.value.language === 'javascript', '读文件 + 语言识别')

const nextSource = "const a = 42\nconsole.log(a)\n"
const codeSaved = await api('POST', '/njau/api/code/file', {
  project: `site/${codeName}`, path: 'src/app.js', text: nextSource, baseHash: codeFile.data.value.hash,
})
check(codeSaved.status === 200, '保存文件 200')
check(readFileSync(join(codeDir, 'src', 'app.js'), 'utf8') === nextSource, '磁盘内容已更新')

const codeRun = await api('POST', '/njau/api/code/run', { project: `site/${codeName}`, action: 'npm:run:echo' })
check(codeRun.status === 200, 'npm:run:echo 200')
check(codeRun.data.value?.code === 0, `退出码 ${codeRun.data.value?.code}`)
check(codeRun.data.value?.stdout?.includes('verify-live ok') === true, '脚本输出被捕获')

const codeDenied = await api('POST', '/njau/api/code/run', { project: `site/${codeName}`, action: 'rm -rf /' })
check(codeDenied.status === 400, '任意命令被拒（400）')

const stateCode = await api('GET', '/njau/api/workshop/state')
const codeLine = stateCode.data.value.lines.find((line) => line.id === 'code')
check(codeLine.count >= 1, `工作坊数到了开发项目（${codeLine.count}）`)

console.log('\n--- 办公柱能列目录吗 ---')
const scan = await api('GET', '/njau/api/office/scan')
check(scan.status === 200, '办公 scan 200')
check(typeof scan.data.value?.total === 'number', `办公文档总数 ${scan.data.value?.total}`)

// 清理：临时项目不给协会数据留垃圾
try {
  rmSync(projectDir, { recursive: true, force: true })
  check(!existsSync(projectDir), '临时漫剧项目已清理')
} catch (error) {
  check(false, `临时漫剧项目清理失败：${error.message}`)
}
try {
  rmSync(codeDir, { recursive: true, force: true })
  check(!existsSync(codeDir), '临时开发项目已清理')
} catch (error) {
  check(false, `临时开发项目清理失败：${error.message}`)
}

console.log('')
if (problems.length === 0) {
  console.log('✓ verify-live PASSED —— 这个实例是真能用的')
} else {
  console.log(`✗ ${problems.length} 项未通过：`)
  for (const problem of problems) console.log(`   - ${problem}`)
}
process.exitCode = problems.length > 0 ? 1 : 0
