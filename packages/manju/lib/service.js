/**
 * service.js —— 漫剧项目服务：面板（HTTP）与 agent（工具）共用的唯一操作层。
 *
 * 一个项目就是一个目录：
 *   <root>/media/manju/<项目>/
 *     剧本.md           人写的故事（Markdown，随便怎么排版）
 *     storyboard.json   机器读的分镜表（唯一真相，所有工序挂它）
 *     assets/           出图、音频、合成产物
 *
 * 约定：这里只做「读 → 改 → 原子写」。不做生成 —— 出图/配音/合成是后续柱内插件的事。
 */

import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import {
  FORMAT,
  applyOp,
  blankStoryboard,
  boardOutline,
  normalize,
  projectNextStep,
  totalDuration,
} from './storyboard.js'

const OK = (value) => ({ ok: true, value })
const FAIL = (code, message) => ({ ok: false, error: { code, message } })

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const MEDIA_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mp3', '.wav'])

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

/** 项目名清洗：剥掉路径分隔符与 Windows 非法字符，再去掉开头的点。 */
export function sanitizeName(name) {
  return String(name ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/^\.+/, '')
    .trim()
}

const SCRIPT_TEMPLATE = (title) => `# ${title}

> 一句话故事：

## 设定
- 时代 / 地点：
- 主角：
- 冲突：

## 分集
### 第 1 集
- 场景：
- 节拍：
- 结尾钩子：

## 对白
| 角色 | 台词 | 情绪 |
| --- | --- | --- |
|  |  |  |
`

export function createManjuService(ctx, config = {}) {
  const root = resolve(
    config.dataDir !== undefined && config.dataDir !== ''
      ? String(config.dataDir)
      : (process.env.NJAU_CA_DATA ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh', 'njau-ca')),
  )
  const base = join(root, 'media', 'manju')

  const projectDir = (name) => {
    const clean = sanitizeName(name)
    if (clean === '') throw new Error('项目名不能为空')
    return join(base, clean)
  }

  const readScript = (dir) => {
    const path = join(dir, '剧本.md')
    if (!existsSync(path)) return ''
    return readFileSync(path, 'utf8')
  }

  const readBoardRaw = (dir) => {
    const path = join(dir, 'storyboard.json')
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf8')
    if (raw.trim() === '') return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  const listFiles = (dir) => {
    const out = []
    const walk = (current, depth) => {
      if (depth > 3) return
      let entries
      try {
        entries = readdirSync(current, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const abs = join(current, entry.name)
        if (entry.isDirectory()) {
          walk(abs, depth + 1)
          continue
        }
        const stat = statSync(abs)
        out.push({
          name: entry.name,
          rel: relative(dir, abs).split(sep).join('/'),
          bytes: stat.size,
          mtime: stat.mtime.toISOString(),
        })
      }
    }
    walk(dir, 0)
    return out
  }

  return {
    root,
    base,

    /** 列项目。列表页要的就是「每条漫剧走到哪一步了」。 */
    list() {
      if (!existsSync(base)) return OK({ base, root, count: 0, projects: [] })
      const projects = []
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const dir = join(base, entry.name)
        const script = readScript(dir)
        const board = normalize(readBoardRaw(dir) ?? blankStoryboard(entry.name))
        const files = listFiles(dir)
        const assets = files.filter((file) => IMAGE_EXT.has(extname(file.name).toLowerCase()))
        const stat = statSync(dir)
        projects.push({
          name: entry.name,
          rel: relative(root, dir).split(sep).join('/'),
          title: board.title === '' ? entry.name : board.title,
          panels: board.panels.length,
          drawn: board.panels.filter((panel) => panel.asset !== null).length,
          assets: assets.length,
          duration: Math.round(totalDuration(board) * 10) / 10,
          hasScript: script.trim() !== '',
          nextStep: projectNextStep(board, script),
          updatedAt: stat.mtime.toISOString(),
        })
      }
      projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return OK({ base, root, count: projects.length, projects })
    },

    /** 新建项目：只搭骨架，内容由人和 agent 一起填。 */
    create(name) {
      let dir
      try {
        dir = projectDir(name)
      } catch (error) {
        return FAIL('name/invalid', error.message)
      }
      if (existsSync(dir)) return FAIL('project/exists', `项目已存在：${sanitizeName(name)}`)
      const clean = sanitizeName(name)
      try {
        mkdirSync(join(dir, 'assets'), { recursive: true })
        writeFileSync(join(dir, '剧本.md'), SCRIPT_TEMPLATE(clean), 'utf8')
        const board = blankStoryboard(clean)
        writeAtomic(join(dir, 'storyboard.json'), Buffer.from(`${JSON.stringify(board, null, 2)}\n`, 'utf8'))
        return OK({
          name: clean,
          dir,
          rel: relative(root, dir).split(sep).join('/'),
          created: ['剧本.md', 'storyboard.json', 'assets/'],
          format: FORMAT,
        })
      } catch (error) {
        return FAIL('project/create-failed', `创建失败：${error.message}`)
      }
    },

    /** 读一个项目：剧本 + 分镜 + 两个文件的 hash（保存时的并发凭据）。 */
    read(name) {
      let dir
      try {
        dir = projectDir(name)
      } catch (error) {
        return FAIL('name/invalid', error.message)
      }
      if (!existsSync(dir)) return FAIL('project/missing', `项目不存在：${sanitizeName(name)}`)
      try {
        const script = readScript(dir)
        const rawBoard = readBoardRaw(dir)
        const board = normalize(rawBoard ?? blankStoryboard(sanitizeName(name)))
        const boardBytes = readFileSync(join(dir, 'storyboard.json'))
        return OK({
          name: sanitizeName(name),
          dir,
          rel: relative(root, dir).split(sep).join('/'),
          script,
          scriptHash: hashOf(Buffer.from(script, 'utf8')),
          board,
          boardHash: hashOf(boardBytes),
          files: listFiles(dir),
          nextStep: projectNextStep(board, script),
          totalDuration: Math.round(totalDuration(board) * 10) / 10,
          /** 原本的 JSON 坏了会被 normalize 救回，这里明确告诉面板「救过」。 */
          repaired: rawBoard === null && existsSync(join(dir, 'storyboard.json')),
        })
      } catch (error) {
        return FAIL('project/read-failed', `读取失败：${error.message}`)
      }
    },

    /** 存分镜表。baseHash 用来发现「别人也改了这一步」。 */
    saveBoard(name, board, baseHash) {
      let dir
      try {
        dir = projectDir(name)
      } catch (error) {
        return FAIL('name/invalid', error.message)
      }
      if (!existsSync(dir)) return FAIL('project/missing', `项目不存在：${sanitizeName(name)}`)
      const path = join(dir, 'storyboard.json')
      if (existsSync(path) && typeof baseHash === 'string' && baseHash !== '') {
        const current = hashOf(readFileSync(path))
        if (current !== baseHash) {
          return FAIL('board/conflict', `分镜表已被改动（现有 ${current}，你打开的是 ${baseHash}）。先刷新再保存。`)
        }
      }
      try {
        const next = normalize(board)
        next.updatedAt = new Date().toISOString()
        const buffer = Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8')
        writeAtomic(path, buffer)
        return OK({ name: sanitizeName(name), boardHash: hashOf(buffer), bytes: buffer.length, updatedAt: next.updatedAt })
      } catch (error) {
        return FAIL('board/write-failed', `写入失败：${error.message}`)
      }
    },

    /** 存剧本.md。 */
    saveScript(name, text, baseHash) {
      let dir
      try {
        dir = projectDir(name)
      } catch (error) {
        return FAIL('name/invalid', error.message)
      }
      if (!existsSync(dir)) return FAIL('project/missing', `项目不存在：${sanitizeName(name)}`)
      if (typeof text !== 'string') return FAIL('script/invalid', 'text 必须是字符串')
      const path = join(dir, '剧本.md')
      if (existsSync(path) && typeof baseHash === 'string' && baseHash !== '') {
        const current = hashOf(readFileSync(path))
        if (current !== baseHash) {
          return FAIL('script/conflict', `剧本已被改动（现有 ${current}，你打开的是 ${baseHash}）。先刷新再保存。`)
        }
      }
      try {
        const buffer = Buffer.from(text, 'utf8')
        writeAtomic(path, buffer)
        return OK({ name: sanitizeName(name), scriptHash: hashOf(buffer), bytes: buffer.length })
      } catch (error) {
        return FAIL('script/write-failed', `写入失败：${error.message}`)
      }
    },

    /** 按操作改分镜（给 agent 用）：读 → 逐条 apply → 写。 */
    edit(name, ops) {
      if (!Array.isArray(ops) || ops.length === 0) return FAIL('ops/invalid', 'ops 必须是非空数组')
      const read = this.read(name)
      if (!read.ok) return read
      const board = read.value.board
      const applied = []
      for (const [index, op] of ops.entries()) {
        try {
          applied.push({ op: op?.op ?? '?', result: applyOp(board, op) })
        } catch (error) {
          return FAIL('ops/failed', `第 ${index + 1} 个操作失败（${op?.op ?? '?'}）：${error.message}`)
        }
      }
      const saved = this.saveBoard(name, board, read.value.boardHash)
      if (!saved.ok) return saved
      return OK({
        name: read.value.name,
        boardHash: saved.value.boardHash,
        totalDuration: Math.round(totalDuration(board) * 10) / 10,
        applied,
        outline: boardOutline(board),
      })
    },

    /** 分镜大纲（给 agent 读，不落盘）。 */
    outline(name) {
      const read = this.read(name)
      if (!read.ok) return read
      return OK({
        name: read.value.name,
        boardHash: read.value.boardHash,
        scriptHash: read.value.scriptHash,
        nextStep: read.value.nextStep,
        script: read.value.script,
        ...boardOutline(read.value.board),
      })
    },

    /** 解析项目内的素材路径，锁在项目目录里。 */
    assetPath(name, relPath) {
      let dir
      try {
        dir = projectDir(name)
      } catch (error) {
        return FAIL('name/invalid', error.message)
      }
      if (typeof relPath !== 'string' || relPath.trim() === '') {
        return FAIL('path/invalid', 'path 不能为空')
      }
      const cleaned = relPath.replace(/\\/g, '/')
      if (cleaned.split('/').includes('..')) return FAIL('path/invalid', 'path 不允许包含 ..')
      const abs = resolve(dir, cleaned)
      const rel = relative(dir, abs)
      if (rel === '' || rel.startsWith('..')) return FAIL('path/invalid', 'path 越出项目目录')
      if (!existsSync(abs)) return FAIL('asset/missing', `素材不存在：${cleaned}`)
      const ext = extname(abs).toLowerCase()
      if (!MEDIA_EXT.has(ext)) return FAIL('asset/unsupported', `不支持预览的格式：${ext}`)
      return OK({ abs, ext, rel: rel.split(sep).join('/'), isImage: IMAGE_EXT.has(ext) })
    },
  }
}
