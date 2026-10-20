/**
 * env.js —— 工作坊自己的环境解析（数据根目录 + 身份卡）。
 *
 * 与办公柱各带一份，是刻意重复：生态铁律「业务插件不互相 import」。
 * 两边读的是同一份 identity.json、同一个 NJAU_CA_DATA —— 事实只有一份，
 * 代码各自独立。哪天要改路径约定，改的是这两份十行，而不是一圈耦合。
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

function expandHome(p) {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

/**
 * 当前学年。国内高校 9 月为学年起点。
 * 工作坊的归档、命名、交接都以它为准，所以只在这一处算。
 */
export function currentSchoolYear(now = new Date()) {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  return month >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`
}

export function createEnv(ctx, config = {}) {
  const raw = config.dataDir ?? process.env.NJAU_CA_DATA ?? join(homedir(), '.dsh', 'njau-ca')
  const root = resolve(expandHome(String(raw)))
  if (!existsSync(root)) mkdirSync(root, { recursive: true })

  let identity = null
  try {
    identity = JSON.parse(readFileSync(join(root, 'identity.json'), 'utf8'))
  } catch {
    identity = null
  }

  return {
    root,
    identity: identity ?? { fullName: '南京农业大学计算机爱好者协会', shortName: '南农计协', abbr: 'NJAU-CA' },
    schoolYear: config.schoolYear ?? identity?.schoolYear ?? currentSchoolYear(),
    logger: ctx?.logger,
  }
}
