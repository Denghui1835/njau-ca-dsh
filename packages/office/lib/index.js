/**
 * index.js —— 计协工作坊「办公柱」的 host 入口。
 *
 * 三件事，彼此独立、都薄：
 *   1. 文档服务（service.js）：读写 .docx，是唯一真相层；
 *   2. HTTP 前缀路由 /njau/api/office（http.js）：给右侧栏面板用；
 *   3. agent 工具 njau_office_*（tools.js）：给模型用。
 *
 * 面板和工具共用 service ——「用户点保存」和「模型改段落」不会分叉成两套逻辑。
 */

import { createEnv } from './env.js'
import { createDocService } from './service.js'
import { registerHttp } from './http.js'
import { registerTools } from './tools.js'

export const name = '@njau-ca/dsh-njau-office'

/** 只要 webserver：没有它就没有面板通道，插件在纯 CLI profile 里应当静默。 */
export const inject = ['webServer']

export function apply(ctx, config = {}) {
  const env = createEnv(ctx, config)
  const service = createDocService(ctx, { root: env.root })

  ctx.effect(() => {
    const disposers = registerHttp(ctx, service)
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'njau-office: /njau/api/office routes')

  let toolCount = 0
  ctx.inject(['tools'], (scoped) => {
    toolCount = registerTools(scoped, service)
    const line =
      `[njau-office] 已加载｜数据 ${env.root}` +
      `｜接口 /njau/api/office｜工具 ${toolCount}`
    scoped.logger?.info?.(line)
    console.log(line)
  })
}

export default { name, inject, apply }
