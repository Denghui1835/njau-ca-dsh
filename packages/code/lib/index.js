/**
 * index.js —— 计协工作坊「开发柱」的 host 入口。
 *
 * 这一柱做什么：项目列表、文件树、文本文件读写、白名单运行。
 * 不做什么：不当 IDE（DSH 自带终端与文件面板）、不跑任意 shell、不碰 site/ 与 learning/ 之外的目录。
 */

import { createEnv } from './env.js'
import { createCodeService } from './service.js'
import { registerHttp } from './http.js'
import { registerTools } from './tools.js'

export const name = '@njau-ca/dsh-njau-code'

export const inject = ['webServer']

export function apply(ctx, config = {}) {
  const env = createEnv(ctx, config)
  const service = createCodeService(ctx, { ...config, dataDir: env.root })

  ctx.effect(() => {
    const disposers = registerHttp(ctx, service)
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'njau-code: /njau/api/code routes')

  ctx.inject(['systemPrompt'], (scoped) => {
    const sp = scoped.systemPrompt
    if (sp === undefined || typeof sp.section !== 'function') return
    try {
      const disposer = sp.section({
        name: 'njau-code:projects',
        order: 670,
        text:
          `[开发] 协会的代码项目在 ${service.roots.join(' 与 ')} 下，项目 id 是相对数据根的路径（如 site/portal）。\n` +
          '用 njau_code_projects 看有哪些项目、njau_code_tree 看结构、njau_code_read / njau_code_write 读写文本文件；' +
          '要跑构建就 njau_code_run（只能跑 package.json 里声明过的 script 与只读 git 命令）。\n' +
          '改完代码要把「改了什么、为什么」写进项目自己的 README 或 CHANGELOG —— 下届要能看懂。',
      })
      if (typeof disposer === 'function') {
        scoped.effect(() => disposer, 'njau-code: prompt section')
      }
    } catch (error) {
      env.logger?.warn?.('[njau-code] 系统提示词段落注册失败：' + String(error))
    }
  })

  let toolCount = 0
  ctx.inject(['tools'], (scoped) => {
    toolCount = registerTools(scoped, service)
    const line =
      `[njau-code] 已加载｜项目根 ${service.roots.join(' / ')}` +
      `｜接口 /njau/api/code｜工具 ${toolCount}`
    scoped.logger?.info?.(line)
    console.log(line)
  })
}

export default { name, inject, apply }
