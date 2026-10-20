/**
 * tools.js —— 开发柱给 agent 的工具。
 *
 * 「运行」只跑项目自己声明的 scripts 与只读 git 命令 —— 任意 shell 是 DSH 终端的事。
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
    ctx.logger?.warn?.('[njau-code] tools 服务不可用，未注册开发工具')
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

  register('njau_code_projects', {
    description:
      '列出协会数据目录 site/ 与 learning/ 下的代码项目：名字、路径、包管理器、可用 scripts、有没有 git。' +
      '改代码前先看这个，确认项目 id（形如 site/portal）。',
    parameters: objectSchema({}),
    behavior: 'read',
    execute() {
      return pass(service.list())
    },
  })

  register('njau_code_tree', {
    description: '看一个项目的文件树（自动跳过 node_modules / dist / .git 等噪音目录），以及可跑的 scripts。',
    parameters: objectSchema({
      project: { type: 'string', description: '项目 id，例如 site/portal 或 learning/ts-demo' },
    }, ['project']),
    behavior: 'read',
    execute(args) {
      return pass(service.tree(args?.project))
    },
  })

  register('njau_code_read', {
    description:
      '读一个项目里的文本文件（相对项目根）。二进制与超过 1MB 的文件会被拒绝。' +
      '返回内容、语言、行数、以及保存时要用的 hash。',
    parameters: objectSchema({
      project: { type: 'string', description: '项目 id' },
      path: { type: 'string', description: '相对项目根的文件路径，正斜杠分隔' },
    }, ['project', 'path']),
    behavior: 'read',
    execute(args) {
      return pass(service.readFile(args?.project, args?.path))
    },
  })

  register('njau_code_write', {
    description:
      '整篇写入一个项目里的文本文件（原子写，必要时建目录）。' +
      '传 baseHash 可在文件被别人改过时拒绝覆盖（返回 file/conflict）。',
    parameters: objectSchema({
      project: { type: 'string', description: '项目 id' },
      path: { type: 'string', description: '相对项目根的文件路径' },
      text: { type: 'string', description: '文件全文' },
      baseHash: { type: 'string', description: '可选：读取时拿到的 hash，用于并发保护' },
    }, ['project', 'path', 'text']),
    behavior: 'write',
    execute(args) {
      return pass(service.writeFile(args?.project, args?.path, args?.text, args?.baseHash))
    },
  })

  register('njau_code_run', {
    description:
      '在项目目录里跑一条白名单命令并返回输出（最长 60 秒，超时会被杀掉）。' +
      '可用：npm:run:<script> / pnpm:run:<script> / yarn:run:<script>（只能用 package.json 里声明过的 script）、' +
      'git:status、git:log、git:diff-stat。**不能跑任意 shell** —— 那用 DSH 的终端。',
    parameters: objectSchema({
      project: { type: 'string', description: '项目 id' },
      action: { type: 'string', description: '动作，例如 npm:run:build 或 git:status' },
    }, ['project', 'action']),
    behavior: 'write',
    execute(args) {
      return service.run(args?.project, args?.action)
    },
  })

  register('njau_code_status', {
    description: '报告开发柱是否可用：数据根、项目根、接口地址、工具与允许的动作。面板打不开时先跑这个。',
    parameters: objectSchema({}),
    behavior: 'read',
    execute() {
      return {
        service: 'njau-code',
        root: service.root,
        roots: service.roots,
        api: '/njau/api/code',
        tools: ['njau_code_projects', 'njau_code_tree', 'njau_code_read', 'njau_code_write', 'njau_code_run'],
        actions: ['npm:run:<script>', 'pnpm:run:<script>', 'yarn:run:<script>', 'git:status', 'git:log', 'git:diff-stat'],
        note: '只能跑项目 package.json 里声明过的 script，或只读 git 命令。',
      }
    },
  })

  return count
}
