/**
 * env.js —— 办公柱自己的环境解析（数据根目录 + 身份卡）。
 *
 * 为什么不 import @njau-ca/dsh-njau-core：
 *   生态的铁律是「业务插件不互相 import」。core 的 store.js 里那套路径约定
 *   只有十几行，在这里抄一份的成本，远低于让办公柱依赖内核插件的加载状态。
 *   两边读的是同一份 identity.json / 同一个 NJAU_CA_DATA，事实仍然只有一份。
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
