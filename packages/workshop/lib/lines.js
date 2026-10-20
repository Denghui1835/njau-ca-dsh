/**
 * lines.js —— 三条产线的工作坊视图。
 *
 * 这一层只做一件事：**把磁盘上真实存在的东西数清楚，并说清楚每条产线现在
 * 缺什么**。外壳不该假装自己会出图、会剪片子；它负责让你一眼看到
 * 「办公有 12 份文档、漫剧有 1 个项目还在写剧本、开发有 2 个站」。
 *
 * 产线定义刻意写成数据（LINES），加一条产线只改这一处。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/** 三条产线：id / 名称 / 一句话 / 归属的业务域目录。 */
export const LINES = [
  {
    id: 'office',
    zh: '办公',
    glyph: '文',
    desc: '表格、纪要、立项书、报销单、年审材料',
    domains: ['report', 'finance', 'compliance', 'recruit', 'events', 'org', 'school'],
    panel: 'njau-office',
  },
  {
    id: 'manju',
    zh: '漫剧',
    glyph: '漫',
    desc: '剧本 → 分镜 → 出图 → 配音字幕 → 合成',
    domains: ['media'],
    panel: null,
  },
  {
    id: 'code',
    zh: '开发',
    glyph: '码',
    desc: '协会网站、工具、脚本',
    domains: ['site', 'learning'],
    panel: null,
  },
]

const MAX_RECENT = 5

function safeStat(path) {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function walkFiles(base, options = {}) {
  const out = []
  const skip = options.skip ?? new Set(['node_modules', '.git', '.DS_Store'])
  const walk = (dir, depth) => {
    if (depth > (options.maxDepth ?? 4)) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (skip.has(entry.name) || entry.name.startsWith('.')) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs, depth + 1)
        continue
      }
      const stat = safeStat(abs)
      if (stat === null) continue
      out.push({ name: entry.name, path: abs, bytes: stat.size, mtime: stat.mtime.toISOString() })
    }
  }
  if (existsSync(base)) walk(base, 0)
  return out
}

/** 漫剧项目：<root>/media/manju/<项目名>/，认 剧本.md + storyboard.json + assets/。 */
function readManjuProjects(root) {
  const base = join(root, 'media', 'manju')
  if (!existsSync(base)) return { dir: base, projects: [] }
  const projects = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = join(base, entry.name)
    const stat = safeStat(dir)
    const files = walkFiles(dir, { maxDepth: 2 })
    const assets = files.filter((f) => /\.(png|jpe?g|webp|mp4|wav|mp3)$/i.test(f.name))
    const script = files.find((f) => f.name === '剧本.md')
    const board = files.find((f) => f.name === 'storyboard.json')
    let panels = 0
    if (board !== undefined) {
      try {
        const parsed = JSON.parse(readFileSync(board.path, 'utf8'))
        panels = Array.isArray(parsed.panels) ? parsed.panels.length : 0
      } catch {
        panels = 0
      }
    }
    projects.push({
      name: entry.name,
      dir,
      rel: relative(root, dir).split(/[\\/]/).join('/'),
      updatedAt: stat === null ? null : stat.mtime.toISOString(),
      hasScript: script !== undefined,
      hasStoryboard: board !== undefined,
      panels,
      assets: assets.length,
      files: files.length,
      /** 下一步该干什么：外壳只提示，不代做。 */
      next: script === undefined
        ? '先写剧本'
        : board === undefined
          ? '再拆分镜'
          : panels === 0
            ? '分镜还是空的'
            : assets === 0
              ? '该出图了'
              : '可以配音 / 合成',
    })
  }
  projects.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
  return { dir: base, projects }
}

/** 开发项目：site/ 和 learning/ 下带 package.json 或 index.html 的目录都算一个。 */
function readCodeProjects(root) {
  const projects = []
  for (const domain of ['site', 'learning']) {
    const base = join(root, domain)
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const dir = join(base, entry.name)
      const files = walkFiles(dir, { maxDepth: 2 })
      const hasPackage = files.some((f) => f.name === 'package.json')
      const hasIndex = files.some((f) => f.name === 'index.html')
      if (!hasPackage && !hasIndex) continue
      const stat = safeStat(dir)
      projects.push({
        name: entry.name,
        dir,
        rel: relative(root, dir).split(/[\\/]/).join('/'),
        domain,
        updatedAt: stat === null ? null : stat.mtime.toISOString(),
        hasPackage,
        hasIndex,
        files: files.length,
        next: hasPackage ? '可以跑 dev / 构建' : hasIndex ? '静态页，可直接预览' : '先搭骨架',
      })
    }
  }
  projects.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
  return projects
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

const STORYBOARD_TEMPLATE = (title) => JSON.stringify({
  format: 'njau-manju/storyboard@1',
  title,
  logline: '',
  style: { look: 'manga', palette: 'warm', aspect: '9:16' },
  cast: [],
  panels: [],
  audio: { narration: null, bgm: null },
  updatedAt: new Date().toISOString(),
}, null, 2) + '\n'

export function createWorkshop(env) {
  const { root } = env

  /** 办公柱：整个数据根目录里所有 .docx，按业务域分组。 */
  function scanOffice() {
    const groups = []
    let total = 0
    for (const domain of LINES[0].domains) {
      const files = walkFiles(join(root, domain), { maxDepth: 3 })
        .filter((f) => f.name.toLowerCase().endsWith('.docx'))
      if (files.length === 0) continue
      files.sort((a, b) => b.mtime.localeCompare(a.mtime))
      total += files.length
      groups.push({
        domain,
        count: files.length,
        files: files.map((f) => ({ ...f, rel: relative(root, f.path).split(/[\\/]/).join('/') })),
      })
    }
    groups.sort((a, b) => b.files[0].mtime.localeCompare(a.files[0].mtime))
    return { total, groups }
  }

  function state() {
    const office = scanOffice()
    const manju = readManjuProjects(root)
    const code = readCodeProjects(root)

    const lines = [
      {
        ...LINES[0],
        count: office.total,
        unit: '份文档',
        recent: office.groups.slice(0, MAX_RECENT).map((group) => ({
          label: group.files[0].name,
          detail: `${group.domain} · ${group.count} 份`,
          path: group.files[0].path,
        })),
      },
      {
        ...LINES[1],
        count: manju.projects.length,
        unit: '个项目',
        recent: manju.projects.slice(0, MAX_RECENT).map((project) => ({
          label: project.name,
          detail: project.next,
          path: project.dir,
        })),
      },
      {
        ...LINES[2],
        count: code.length,
        unit: '个项目',
        recent: code.slice(0, MAX_RECENT).map((project) => ({
          label: project.name,
          detail: `${project.domain} · ${project.next}`,
          path: project.dir,
        })),
      },
    ]

    return {
      root,
      identity: env.identity,
      schoolYear: env.schoolYear,
      lines,
      office: office.groups,
      manju: { dir: manju.dir, projects: manju.projects },
      code: { projects: code },
    }
  }

  /** 新建漫剧项目：只搭骨架，内容由人和 agent 一起填。 */
  function createManju(name) {
    // 清洗分两步：先剥掉路径分隔符与 Windows 非法字符，再剥掉开头的点
    // （否则 '../../evil' 会变成 '....evil' —— 逃不出去，但会变成隐藏目录）。
    const clean = String(name ?? '')
      .trim()
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/^\.+/, '')
      .trim()
    if (clean === '') return { ok: false, error: { code: 'name/invalid', message: '项目名不能为空（不能只有点和斜杠）' } }
    const dir = join(root, 'media', 'manju', clean)
    if (existsSync(dir)) {
      return { ok: false, error: { code: 'project/exists', message: `项目已存在：${clean}` } }
    }
    mkdirSync(join(dir, 'assets'), { recursive: true })
    writeFileSync(join(dir, '剧本.md'), SCRIPT_TEMPLATE(clean), 'utf8')
    writeFileSync(join(dir, 'storyboard.json'), STORYBOARD_TEMPLATE(clean), 'utf8')
    return {
      ok: true,
      value: { name: clean, dir, rel: relative(root, dir).split(/[\\/]/).join('/'), created: ['剧本.md', 'storyboard.json', 'assets/'] },
    }
  }

  return { root, state, scanOffice, readManjuProjects: () => readManjuProjects(root), readCodeProjects: () => readCodeProjects(root), createManju }
}
