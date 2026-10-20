/**
 * index.js —— 计协工作坊「漫剧柱」的 host 入口。
 *
 * 这一版覆盖产线的前两步：
 *   剧本（剧本.md） ⇄ 分镜（storyboard.json） ⇄ 面板 / agent 工具
 *
 * 出图 / 配音字幕 / 合成**不在这个包里做**。它们各自是后续插件，
 * 通过读写同一个 storyboard.json 与 assets/ 协作 —— 谁坏了都不影响前面的工序。
 */

import { createEnv } from './env.js'
import { createManjuService } from './service.js'
import { registerHttp } from './http.js'
import { registerTools } from './tools.js'

export const name = '@njau-ca/dsh-njau-manju'

export const inject = ['webServer']

export function apply(ctx, config = {}) {
  const env = createEnv(ctx, config)
  const service = createManjuService(ctx, { ...config, dataDir: env.root })

  ctx.effect(() => {
    const disposers = registerHttp(ctx, service)
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'njau-manju: /njau/api/manju routes')

  // 给模型一句方位感：漫剧的真相在 storyboard.json，不在对话里。
  ctx.inject(['systemPrompt'], (scoped) => {
    const sp = scoped.systemPrompt
    if (sp === undefined || typeof sp.section !== 'function') return
    try {
      const disposer = sp.section({
        name: 'njau-manju:pipeline',
        order: 665,
        text:
          `[漫剧] 每条漫剧是 ${service.base} 下的一个目录，两个文件：\n` +
          '- 剧本.md：故事本身（Markdown），人写；\n' +
          '- storyboard.json：分镜表，机器读，**所有工序都挂在它上面**（panels[] 的 desc/台词/时长/asset/status）。\n' +
          '推进顺序：写剧本 → 拆分镜 → 出图（asset）→ 配音字幕 → 合成。\n' +
          '用 njau_manju_list 看现状、njau_manju_read 读细节、njau_manju_edit 按 panel id 改；' +
          '不要整篇重写分镜表，容易把别人的修改冲掉。',
      })
      if (typeof disposer === 'function') {
        scoped.effect(() => disposer, 'njau-manju: prompt section')
      }
    } catch (error) {
      env.logger?.warn?.('[njau-manju] 系统提示词段落注册失败：' + String(error))
    }
  })

  let toolCount = 0
  ctx.inject(['tools'], (scoped) => {
    toolCount = registerTools(scoped, service)
    const line =
      `[njau-manju] 已加载｜项目目录 ${service.base}` +
      `｜接口 /njau/api/manju｜工具 ${toolCount}`
    scoped.logger?.info?.(line)
    console.log(line)
  })
}

export default { name, inject, apply }
