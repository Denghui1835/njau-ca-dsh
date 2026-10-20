/**
 * check.mjs —— 不装 DSH 也能跑的最小自检。
 *
 * 做两件事：
 *   1. 真正 import 每个 host 入口（解析 + 加载，等于验证语法与 import 图）；
 *   2. 只解析浏览器侧文件（它们在顶层就摸 window，不能真加载）——
 *      用 new Function 编译一遍，语法错会当场抛。
 *
 * 用法：node scripts/check.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = join(ROOT, 'packages')

const problems = []
const listFiles = (dir) => {
  let out = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const stat = statSync(abs)
    if (stat.isDirectory()) out = out.concat(listFiles(abs))
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(abs)
  }
  return out
}

const packages = readdirSync(PACKAGES).filter((name) => {
  try {
    return statSync(join(PACKAGES, name)).isDirectory()
  } catch {
    return false
  }
})

console.log(`packages: ${packages.join(', ')}\n`)

for (const name of packages) {
  const dir = join(PACKAGES, name)

  const entry = join(dir, 'lib', 'index.js')
  try {
    const mod = await import(pathToFileURL(entry).href)
    if (typeof mod.apply !== 'function') problems.push(`${name}: lib/index.js 没有导出 apply`)
    if (typeof mod.name !== 'string') problems.push(`${name}: lib/index.js 没有导出 name`)
    console.log(`  ✓ host  ${name} -> ${mod.name}`)
  } catch (error) {
    problems.push(`${name}: host 入口加载失败 —— ${error.message}`)
    console.log(`  ✗ host  ${name}: ${error.message}`)
  }

  const clientDir = join(dir, 'client')
  let clientFiles = []
  try {
    clientFiles = listFiles(clientDir)
  } catch {
    clientFiles = []
  }
  for (const file of clientFiles) {
    const source = readFileSync(file, 'utf8')
    try {
      // 只编译不执行：浏览器侧在顶层就访问 window，真跑会炸。
      // eslint-disable-next-line no-new-func
      new Function(source)
      console.log(`  ✓ client ${relative(ROOT, file)}`)
    } catch (error) {
      problems.push(`${relative(ROOT, file)}: 语法错误 —— ${error.message}`)
      console.log(`  ✗ client ${relative(ROOT, file)}: ${error.message}`)
    }
  }

  // 清单与实际文件必须一致：声明了 dsh.client，exports["./client"] 指向的文件就得真在，
  // 而且是合法 JS。路径不写死 —— brand 用 lib/client.js，新包用 client/client.js，
  // 两种都合法，以 package.json 的 exports 为准。
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  if (manifest.dsh?.client !== undefined) {
    const exported = manifest.exports?.['./client']
    const target = typeof exported === 'string'
      ? exported
      : exported?.default
    if (typeof target !== 'string') {
      problems.push(`${name}: 声明了 dsh.client，但 exports["./client"] 缺失`)
    } else {
      const clientFile = join(dir, target)
      try {
        new Function(readFileSync(clientFile, 'utf8'))
        console.log(`  ✓ client ${relative(ROOT, clientFile)}（按 exports["./client"]）`)
      } catch (error) {
        problems.push(`${name}: ${target} 有问题 —— ${error.message}`)
      }
    }
  }
  if (manifest.dsh?.bundle?.patch !== undefined) {
    try {
      statSync(join(dir, 'cordis.patch.yml'))
    } catch {
      problems.push(`${name}: 声明了 dsh.bundle.patch，但 cordis.patch.yml 不存在`)
    }
  }
  if (typeof manifest.license !== 'string') {
    problems.push(`${name}: package.json 缺 license 字段（本仓库统一 MIT）`)
  }
}

console.log('')
if (problems.length === 0) {
  console.log('✓ check PASSED')
} else {
  console.log(`✗ ${problems.length} 项问题：`)
  for (const problem of problems) console.log(`   - ${problem}`)
}
process.exitCode = problems.length === 0 ? 0 : 1
