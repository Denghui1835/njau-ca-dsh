/**
 * tools.js —— 工作坊给 agent 的工具。
 *
 * 外壳阶段只给两个：看现状、给漫剧起一个项目骨架。
 * 真正的出图 / 配音 / 合成属于漫剧柱的实现，不在这里假装。
 */

const TEXT_RESULT = {
  schema: {},
  render(_args, value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    return [{ type: 'text', text }]
  },
}

function objectSchema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}

export function registerTools(ctx, workshop) {
  const tools = ctx.tools
  if (tools === undefined || typeof tools.register !== 'function') {
    ctx.logger?.warn?.('[njau-workshop] tools 服务不可用，未注册工具')
    return 0
  }

  let count = 0
  const register = (name, definition) => {
    const behavior = definition.behavior ?? 'read'
    tools.register({
      ...definition,
      name,
      behavior,
      readOnly: behavior === 'read',
      idempotent: behavior === 'read' || behavior === 'idempotent',
      destructive: false,
      output: TEXT_RESULT,
      ...(behavior === 'read' ? { isConcurrencySafe: () => true } : {}),
    })
    count += 1
  }

  register('njau_workshop_state', {
    description:
      '看一眼计协工作坊的三条产线现在什么状况：办公有多少份 Word 文档（按业务域分组）、' +
      '漫剧有哪些项目（剧本/分镜/素材齐不齐）、开发有哪些站点或练手项目。' +
      '接手工作、汇报进度、决定先做哪件事之前先跑这个。',
    parameters: objectSchema({}),
    behavior: 'read',
    execute() {
      const state = workshop.state()
      return {
        root: state.root,
        identity: {
          name: state.identity?.fullName,
          short: state.identity?.shortName,
          abbr: state.identity?.abbr,
        },
        schoolYear: state.schoolYear,
        lines: state.lines.map((line) => ({
          id: line.id,
          name: line.zh,
          desc: line.desc,
          count: line.count,
          unit: line.unit,
          recent: line.recent.map((item) => `${item.label}（${item.detail}）`),
        })),
        hint: '办公用 njau_office_* 工具读写文档；漫剧用 njau_workshop_new_manju 起项目，再按 剧本 → 分镜 → 出图 → 配音合成 推进。',
      }
    },
  })

  register('njau_workshop_new_manju', {
    description:
      '新建一个漫剧项目骨架：在 <数据目录>/media/manju/<项目名>/ 下建 剧本.md、storyboard.json、assets/。' +
      '项目已存在会拒绝。起来之后按「写剧本 → 拆分镜 → 出图 → 配音/合成」推进。',
    parameters: objectSchema({
      name: { type: 'string', description: '项目名（会做目录名，不能含 \\ / : * ? " < > |）' },
    }, ['name']),
    behavior: 'write',
    execute(args) {
      const result = workshop.createManju(args?.name)
      return result.ok ? result.value : result
    },
  })

  return count
}
