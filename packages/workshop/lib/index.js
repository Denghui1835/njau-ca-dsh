/**
 * index.js —— 计协工作坊外壳的 host 入口。
 *
 * 外壳的职责边界（很重要，别让它长胖）：
 *   - 知道三条产线在哪、各有多少东西、下一步缺什么；
 *   - 提供进入每条产线的入口（面板侧做导航）；
 *   - 不替产线干活：不出图、不剪片、不编译。那些属于各自插件。
 */

import { createEnv } from './env.js'
import { createWorkshop } from './lines.js'
import { registerHttp } from './http.js'
import { registerTools } from './tools.js'

export const name = '@njau-ca/dsh-njau-workshop'

export const inject = ['webServer']

export function apply(ctx, config = {}) {
  const env = createEnv(ctx, config)
  const workshop = createWorkshop(env)

  ctx.effect(() => {
    const disposers = registerHttp(ctx, workshop)
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'njau-workshop: /njau/api/workshop routes')

  // 给模型一句必要的方位感：工作坊有哪三柱、数据在哪。
  // 段落名带 njau-workshop: 前缀，避免与内核的 njau-ca:identity 撞车。
  ctx.inject(['systemPrompt'], (scoped) => {
    const sp = scoped.systemPrompt
    if (sp === undefined || typeof sp.section !== 'function') return
    try {
      const disposer = sp.section({
        name: 'njau-workshop:lines',
        order: 660,
        text:
          `[工作坊] 计协工作坊有三条产线，共用数据目录 ${env.root}：\n` +
          '- 办公：report / finance / compliance / recruit / events 等域下的 .docx，用 njau_office_* 工具读写；\n' +
          '- 漫剧：media/manju/<项目>/，每个项目含 剧本.md、storyboard.json、assets/；\n' +
          '- 开发：site / learning 下的站点与练手项目。\n' +
          '接手任务前先调 njau_workshop_state 看现状，别猜。',
      })
      if (typeof disposer === 'function') {
        scoped.effect(() => disposer, 'njau-workshop: prompt section')
      }
    } catch (error) {
      env.logger?.warn?.('[njau-workshop] 系统提示词段落注册失败：' + String(error))
    }
  })

  let toolCount = 0
  ctx.inject(['tools'], (scoped) => {
    toolCount = registerTools(scoped, workshop)
    const line =
      `[njau-workshop] 已加载｜数据 ${env.root}｜学年 ${env.schoolYear}` +
      `｜接口 /njau/api/workshop｜工具 ${toolCount}`
    scoped.logger?.info?.(line)
    console.log(line)
  })
}

export default { name, inject, apply }
