/**
 * service.js —— 开发柱的服务：项目、文件树、文件读写、白名单运行。
 *
 * 边界（有意为之，不是没做完）：
 *   - 只认数据目录下的 site/ 与 learning/ 两个根，不碰整台机器；
 *   - 文件路径必须落在项目目录内（`..` 一律拒）；
 *   - 只能「跑」两类东西：项目 `package.json` 里自己声明的 scripts，
 *     以及 git 的只读命令。不做任意 shell —— 那是 DSH 终端的事，不是这个面板的。
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'

const OK = (value) => ({ ok: true, value })
const FAIL = (code, message) => ({ ok: false, error: { code, message } })

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.cache',
  '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'coverage', '.turbo',
])

const MAX_FILE_BYTES = 1024 * 1024
const MAX_TREE_ENTRIES = 1500
const MAX_OUTPUT_CHARS = 200_000
const DEFAULT_TIMEOUT_MS = 60_000

const LANGUAGE = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.json': 'json', '.jsonc': 'json',
  '.md': 'markdown', '.markdown': 'markdown',
  '.html': 'html', '.htm': 'html', '.vue': 'html', '.svelte': 'html',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.py': 'python', '.sh': 'shell', '.bash': 'shell', '.ps1': 'powershell',
  '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.xml': 'xml', '.svg': 'xml',
  '.sql': 'sql', '.txt': 'text', '.gitignore': 'text', '.env': 'text',
}

/** 只读 git 子命令白名单：能看，不能改。 */
const GIT_ACTIONS = {
  'git:status': ['status', '--short', '--branch'],
  'git:log': ['log', '--oneline', '-10'],
  'git:diff-stat': ['diff', '--stat'],
}

const SCRIPT_NAME = /^[A-Za-z0-9:_-]{1,64}$/

function hashOf(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 16)
}

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

function looksBinary(buffer) {
  const window = buffer.subarray(0, Math.min(buffer.length, 8000))
  for (let i = 0; i < window.length; i += 1) {
    if (window[i] === 0) return true
  }
  return false
}

function languageOf(name) {
  return LANGUAGE[extname(name).toLowerCase()] ?? LANGUAGE[name.toLowerCase()] ?? 'text'
}

/** 统一在 cmd.exe 里跑：Windows 上 .cmd 才能被正确解析，且命令串已由白名单拼出。 */
function runCommand(cwd, commandLine, timeoutMs) {
  return new Promise((resolvePromise) => {
    const started = Date.now()
    const child = spawn(process.env.COMSPEC ?? 'cmd.exe', ['/d', '/s', '/c', commandLine], {
      cwd,
      windowsHide: true,
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        /* 已经退出了 */
      }
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolvePromise({
        command: commandLine,
        code: null,
        stdout,
        stderr: `${stderr}${error.message}`,
        durationMs: Date.now() - started,
        timedOut,
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({
        command: commandLine,
        code,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
      })
    })
  })
}

export function createCodeService(ctx, config = {}) {
  const root = resolve(
    config.dataDir !== undefined && config.dataDir !== ''
      ? String(config.dataDir)
      : (process.env.NJAU_CA_DATA ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh', 'njau-ca')),
  )
  const projectDirs = Array.isArray(config.projectDirs) && config.projectDirs.length > 0
    ? config.projectDirs.map(String)
    : ['site', 'learning']
  const roots = projectDirs.map((dir) => ({ dir, base: join(root, dir) }))
  const rootPaths = roots.map((entry) => entry.base)
  const timeoutMs = Number(config.runTimeoutMs) > 0 ? Number(config.runTimeoutMs) : DEFAULT_TIMEOUT_MS

  /** 项目 id = 相对数据根的 posix 路径（如 site/portal）。 */
  function resolveProject(id) {
    const clean = String(id ?? '').replace(/\\/g, '/').trim()
    if (clean === '') throw new Error('project 不能为空')
    if (clean.split('/').includes('..')) throw new Error('project 不允许包含 ..')
    const abs = resolve(root, clean)
    const rel = relative(root, abs).split(sep).join('/')
    const allowed = roots.some((entry) => rel === entry.dir || rel.startsWith(`${entry.dir}/`))
    if (!allowed) {
      throw new Error(`项目必须在 ${projectDirs.join(' / ')} 之下，收到：${clean}`)
    }
    if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`项目不存在：${clean}`)
    return { id: rel, dir: abs }
  }

  function resolveInside(dir, filePath) {
    const clean = String(filePath ?? '').replace(/\\/g, '/').trim()
    if (clean === '') throw new Error('path 不能为空')
    if (clean.split('/').includes('..')) throw new Error('path 不允许包含 ..')
    const abs = resolve(dir, clean)
    const rel = relative(dir, abs)
    if (rel === '' || rel.startsWith('..')) throw new Error('path 越出项目目录')
    return { abs, rel: rel.split(sep).join('/') }
  }

  function readPackageJson(dir) {
    const path = join(dir, 'package.json')
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      return null
    }
  }

  function detectPackageManager(dir) {
    if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
    if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
    if (existsSync(join(dir, 'package-lock.json'))) return 'npm'
    return 'npm'
  }

  function walk(dir, depth) {
    const nodes = []
    let count = 0
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return nodes
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const entry of entries) {
      if (count >= MAX_TREE_ENTRIES) break
      if (entry.name.startsWith('.') && entry.name !== '.gitignore' && entry.name !== '.env') continue
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        const children = depth > 0 ? walk(abs, depth - 1) : []
        nodes.push({ name: entry.name, type: 'dir', children })
        count += 1 + children.length
      } else {
        const stat = statSync(abs)
        nodes.push({
          name: entry.name,
          type: 'file',
          bytes: stat.size,
          language: languageOf(entry.name),
        })
        count += 1
      }
    }
    return nodes
  }

  return {
    root,
    projectDirs,
    roots: rootPaths,

    /** 列项目：site/ 与 learning/ 下看起来像个项目的目录。 */
    list() {
      const projects = []
      for (const { dir, base } of roots) {
        if (!existsSync(base)) continue
        for (const entry of readdirSync(base, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.name.startsWith('.')) continue
          const abs = join(base, entry.name)
          const pkg = readPackageJson(abs)
          const hasIndex = existsSync(join(abs, 'index.html'))
          const hasGit = existsSync(join(abs, '.git'))
          if (pkg === null && !hasIndex && !hasGit) continue
          const stat = statSync(abs)
          projects.push({
            id: `${dir}/${entry.name}`,
            name: pkg?.name ?? entry.name,
            dir: abs,
            rel: `${dir}/${entry.name}`,
            root: dir,
            hasPackage: pkg !== null,
            hasGit,
            packageManager: pkg !== null ? detectPackageManager(abs) : null,
            scripts: pkg?.scripts !== null && typeof pkg?.scripts === 'object' ? Object.keys(pkg.scripts) : [],
            version: typeof pkg?.version === 'string' ? pkg.version : null,
            updatedAt: stat.mtime.toISOString(),
          })
        }
      }
      projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return OK({ root, roots: rootPaths, count: projects.length, projects })
    },

    /** 文件树（跳过 node_modules 等噪音目录）。 */
    tree(id) {
      let project
      try {
        project = resolveProject(id)
      } catch (error) {
        return FAIL('project/invalid', error.message)
      }
      try {
        const pkg = readPackageJson(project.dir)
        return OK({
          id: project.id,
          dir: project.dir,
          nodes: walk(project.dir, 4),
          hasPackage: pkg !== null,
          packageManager: pkg !== null ? detectPackageManager(project.dir) : null,
          scripts: pkg?.scripts !== null && typeof pkg?.scripts === 'object' ? Object.keys(pkg.scripts) : [],
          hasGit: existsSync(join(project.dir, '.git')),
        })
      } catch (error) {
        return FAIL('tree/failed', `读取目录失败：${error.message}`)
      }
    },

    /** 读文本文件。二进制与超大文件明确拒绝，不给面板塞垃圾。 */
    readFile(id, filePath) {
      let project
      try {
        project = resolveProject(id)
      } catch (error) {
        return FAIL('project/invalid', error.message)
      }
      let target
      try {
        target = resolveInside(project.dir, filePath)
      } catch (error) {
        return FAIL('path/invalid', error.message)
      }
      if (!existsSync(target.abs)) return FAIL('file/missing', `文件不存在：${target.rel}`)
      const stat = statSync(target.abs)
      if (stat.isDirectory()) return FAIL('file/is-dir', `${target.rel} 是目录`)
      if (stat.size > MAX_FILE_BYTES) {
        return FAIL('file/too-large', `文件 ${stat.size} 字节，超过 ${MAX_FILE_BYTES} 上限`)
      }
      const buffer = readFileSync(target.abs)
      if (looksBinary(buffer)) return FAIL('file/binary', `${target.rel} 看起来是二进制文件`)
      const text = buffer.toString('utf8')
      return OK({
        project: project.id,
        path: target.rel,
        text,
        language: languageOf(target.rel),
        bytes: stat.size,
        lines: text === '' ? 0 : text.split('\n').length,
        hash: hashOf(buffer),
        mtime: stat.mtime.toISOString(),
      })
    },

    /** 存文本文件。baseHash 用来发现「别人也改了」。 */
    writeFile(id, filePath, text, baseHash) {
      let project
      try {
        project = resolveProject(id)
      } catch (error) {
        return FAIL('project/invalid', error.message)
      }
      let target
      try {
        target = resolveInside(project.dir, filePath)
      } catch (error) {
        return FAIL('path/invalid', error.message)
      }
      if (typeof text !== 'string') return FAIL('file/invalid', 'text 必须是字符串')
      if (existsSync(target.abs)) {
        const stat = statSync(target.abs)
        if (stat.isDirectory()) return FAIL('file/is-dir', `${target.rel} 是目录`)
        if (typeof baseHash === 'string' && baseHash !== '') {
          const current = hashOf(readFileSync(target.abs))
          if (current !== baseHash) {
            return FAIL('file/conflict', `文件已被改动（现有 ${current}，你打开的是 ${baseHash}）。先刷新再保存。`)
          }
        }
      }
      try {
        const buffer = Buffer.from(text, 'utf8')
        writeAtomic(target.abs, buffer)
        return OK({ project: project.id, path: target.rel, hash: hashOf(buffer), bytes: buffer.length })
      } catch (error) {
        return FAIL('file/write-failed', `写入失败：${error.message}`)
      }
    },

    /**
     * 白名单运行：
     *   npm:run:<script> / pnpm:run:<script> / yarn:run:<script>
     *   git:status / git:log / git:diff-stat
     * 只跑项目自己声明的 script，或只读 git 命令。其它一律拒。
     */
    async run(id, action) {
      let project
      try {
        project = resolveProject(id)
      } catch (error) {
        return FAIL('project/invalid', error.message)
      }
      const kind = String(action ?? '')

      if (GIT_ACTIONS[kind] !== undefined) {
        if (!existsSync(join(project.dir, '.git'))) {
          return FAIL('run/no-git', `${project.id} 不是 git 仓库`)
        }
        const result = await runCommand(project.dir, `git ${GIT_ACTIONS[kind].join(' ')}`, timeoutMs)
        return OK({ ...result, action: kind })
      }

      const matched = /^(npm|pnpm|yarn):run:(.+)$/.exec(kind)
      if (matched === null) {
        return FAIL('run/unsupported', `不支持的动作：${kind}。可用：<包管理器>:run:<script>、git:status、git:log、git:diff-stat`)
      }
      const [, tool, script] = matched
      if (!SCRIPT_NAME.test(script)) return FAIL('run/invalid-script', `script 名不合法：${script}`)

      const pkg = readPackageJson(project.dir)
      if (pkg === null) return FAIL('run/no-package', `${project.id} 没有 package.json`)
      const declared = pkg.scripts !== null && typeof pkg.scripts === 'object' ? Object.keys(pkg.scripts) : []
      if (!declared.includes(script)) {
        return FAIL('run/unknown-script', `${project.id} 没有声明 script「${script}」，现有：${declared.join(', ') || '无'}`)
      }

      const result = await runCommand(project.dir, `${tool} run ${script}`, timeoutMs)
      return OK({ ...result, action: kind, script })
    },
  }
}
