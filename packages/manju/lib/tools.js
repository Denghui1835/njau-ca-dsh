/**
 * tools.js —— 漫剧柱给 agent 的工具。
 *
 * 一条漫剧的推进顺序：写剧本 → 拆分镜 → 出图 → 配音字幕 → 合成。
 * 这一版工具覆盖前两步（剧本、分镜），后三步等产线插件落地后各自加。
 *
 * 所有工具都只是 service 的薄壳：面板点保存和模型调工具走同一份实现。
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

const pass = (result) => (result.ok ? result.value : { ok: false, error: result.error })

export function registerTools(ctx, service) {
  const tools = ctx.tools
  if (tools === undefined || typeof tools.register !== 'function') {
    ctx.logger?.warn?.('[njau-manju] tools 服务不可用，未注册漫剧工具')
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
      destructive: behavior === 'destroy',
      output: TEXT_RESULT,
      ...(behavior === 'read' ? { isConcurrencySafe: () => true } : {}),
    })
    count += 1
  }

  register('njau_manju_list', {
    description:
      '列出所有漫剧项目，以及每条走到了哪一步（剧本有没有、分镜几格、出图几格、下一步缺什么）。' +
      '接手漫剧相关任务、汇报进度时先跑这个。',
    parameters: objectSchema({}),
    behavior: 'read',
    execute() {
      return pass(service.list())
    },
  })

  register('njau_manju_read', {
    description:
      '读一条漫剧：剧本全文 + 分镜表（每格的 id、镜号、画面描述、台词、时长、素材、状态、缺口）。' +
      '改之前先读，用返回的 panel id 定位（不要凭镜号猜）。',
    parameters: objectSchema({
      name: { type: 'string', description: '项目名（media/manju 下的目录名）。' },
    }, ['name']),
    behavior: 'read',
    execute(args) {
      return pass(service.outline(args?.name))
    },
  })

  register('njau_manju_edit', {
    description:
      '按操作改一条漫剧的分镜表（读→改→原子写）。ops 按顺序执行。可用操作：' +
      'set_field{field:title|logline|aspect|look|palette|narration|bgm, value}；' +
      'add_panel{after?, desc?, dialogue?, duration?, characters?}；' +
      'set_panel{id, desc?/notes?/duration?/characters?/dialogue?/asset?/status?}；' +
      'delete_panel{id}；' +
      'move_panel{id, to}（to 从 1 开始，改完镜号会自动重排）；' +
      'clear_panels{}。' +
      'status 取值：todo / drawn / voiced / done。',
    parameters: objectSchema({
      name: { type: 'string', description: '项目名。' },
      ops: {
        type: 'array',
        description: '操作数组，见工具说明。',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', description: '操作名' },
            id: { type: 'string', description: '分镜格 id，例如 p1' },
            after: { type: 'number', description: 'add_panel 插在哪一格之后（从 0 开始，省略=末尾）' },
            to: { type: 'number', description: 'move_panel 的目标位置（从 1 开始）' },
            field: { type: 'string', description: 'set_field 的字段名' },
            value: { type: 'string', description: 'set_field / set_panel 的值' },
            desc: { type: 'string', description: '画面描述' },
            notes: { type: 'string', description: '备注（摄影提示、参考图说明等）' },
            duration: { type: 'number', description: '这一格的时长（秒）' },
            status: { type: 'string', description: 'todo / drawn / voiced / done' },
            asset: { type: 'string', description: '素材相对路径，例如 assets/p1.png；空字符串表示清除' },
            characters: { type: 'array', items: { type: 'string' }, description: '出场角色 id 列表' },
            dialogue: {
              type: 'array',
              description: '台词数组',
              items: {
                type: 'object',
                properties: {
                  who: { type: 'string' },
                  line: { type: 'string' },
                  emotion: { type: 'string' },
                },
              },
            },
          },
          required: ['op'],
        },
      },
    }, ['name', 'ops']),
    behavior: 'write',
    execute(args) {
      return pass(service.edit(args?.name, args?.ops))
    },
  })

  register('njau_manju_script_write', {
    description:
      '整篇写入一条漫剧的剧本.md（Markdown）。用于写完或重写故事本身；分镜表请用 njau_manju_edit。',
    parameters: objectSchema({
      name: { type: 'string', description: '项目名。' },
      text: { type: 'string', description: '剧本全文（Markdown）。' },
    }, ['name', 'text']),
    behavior: 'write',
    execute(args) {
      return pass(service.saveScript(args?.name, args?.text))
    },
  })

  register('njau_manju_new', {
    description:
      '新建一条漫剧项目：生成 剧本.md、storyboard.json、assets/。已存在则拒绝。' +
      '起来之后按「写剧本 → 拆分镜 → 出图 → 配音/合成」推进。',
    parameters: objectSchema({
      name: { type: 'string', description: '项目名（会做目录名）。' },
    }, ['name']),
    behavior: 'write',
    execute(args) {
      return pass(service.create(args?.name))
    },
  })

  register('njau_manju_status', {
    description: '报告漫剧柱是否可用：数据目录、接口地址、工具清单。面板打不开时先跑这个。',
    parameters: objectSchema({}),
    behavior: 'read',
    execute() {
      return {
        service: 'njau-manju',
        root: service.root,
        base: service.base,
        api: '/njau/api/manju',
        tools: ['njau_manju_list', 'njau_manju_read', 'njau_manju_edit', 'njau_manju_script_write', 'njau_manju_new'],
        pipeline: '写剧本 → 拆分镜 → 出图 → 配音字幕 → 合成（后三步待产线插件落地）',
      }
    },
  })

  return count
}
