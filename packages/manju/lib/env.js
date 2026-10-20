/**
 * env.js —— 漫剧柱自己的环境解析（数据根目录 + 身份卡）。
 *
 * 与其它柱各带一份，是刻意重复：生态铁律「业务插件不互相 import」。
 * 读的是同一份 identity.json、同一个 NJAU_CA_DATA。
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

function expandHome(p) {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
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

  return { root, identity, logger: ctx?.logger }
}
