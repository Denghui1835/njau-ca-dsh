/**
 * tools.js —— 给 agent 的工具。
 *
 * 每个工具都只是 service 的一层薄壳：面板点保存和模型调工具，走的是同一份实现。
 * schema 必须是规范 JSON Schema：必填写在对象级 required 数组里（属性级 required:true 不合法）。
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

/** 读工具的统一返回：ok 就只回 value，失败回 { ok:false, error }。 */
function pass(result) {
  return result.ok ? result.value : { ok: false, error: result.error }
}

const MAX_PREVIEW = 320

function clip(text) {
  if (typeof text !== 'string') return ''
  return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}…` : text
}

/** 把模型压成「带下标的大纲」：模型靠下标定位，不靠复制全文。 */
function outlineOf(model, options = {}) {
  const maxChars = Number.isInteger(options.maxChars) ? options.maxChars : MAX_PREVIEW
  const includeCells = options.includeCells !== false
  const blocks = []
  model.blocks.forEach((block, index) => {
    if (block.type === 'p') {
      const text = block.runs.map((run) => run.text).join('')
      blocks.push({
        i: index,
        t: 'p',
        kind: block.kind,
        ...(block.align === undefined ? {} : { align: block.align }),
        text: text.length > maxChars ? `${text.slice(0, maxChars)}…` : text,
        runs: block.runs.length,
      })
      return
    }
    const rowCount = block.rows.length
    const colCount = block.rows.reduce((max, row) => Math.max(max, row.length), 0)
    const entry = { i: index, t: 'table', rows: rowCount, cols: colCount }
    if (includeCells) {
      entry.cells = block.rows.map((row) => row.map((cell) => {
        const text = cell.blocks
          .filter((b) => b.type === 'p')
          .map((b) => b.runs.map((run) => run.text).join(''))
          .join(' ')
        return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
      }))
    }
    blocks.push(entry)
  })
  return {
    path: model.__path,
    blocks,
    note: 'i 是顶层块下标（段落和表格一起编号）。改段落用 njau_office_edit 的 set_text/set_runs/set_kind/set_align/insert/delete；改表格单元格用 set_cell（index + row + col，从 0 开始）。',
  }
}

export function registerTools(ctx, service) {
  const tools = ctx.tools
  if (tools === undefined || typeof tools.register !== 'function') {
    ctx.logger?.warn?.('[njau-office] tools 服务不可用，未注册文档工具')
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

  register('njau_office_list', {
    description:
      '列出某个目录下的 Word 文档（.docx）。编辑前先用它确认文件名和路径。' +
      '不传 dir 就列文档根目录。',
    parameters: objectSchema({
      dir: { type: 'string', description: '目录绝对路径，或相对文档根目录的路径。留空用根目录。' },
    }),
    behavior: 'read',
    execute(args) {
      return pass(service.list(args?.dir))
    },
  })

  register('njau_office_read', {
    description:
      '读一个 .docx 的结构化大纲：每个顶层块的编号(i)、类型(段落/表格)、段落语义类型、文字内容，' +
      '表格会带上单元格文字。改文档前先读它，用返回的 i 定位。',
    parameters: objectSchema({
      path: { type: 'string', description: '.docx 的绝对路径或相对文档根目录的路径。' },
      include_cells: { type: 'boolean', description: '表格是否返回单元格文字（默认 true）。表格很大时传 false。' },
    }, ['path']),
    behavior: 'read',
    execute(args) {
      const read = service.read(args?.path)
      if (!read.ok) return pass(read)
      const model = { ...read.value.model, __path: read.value.path }
      return {
        ...outlineOf(model, { includeCells: args?.include_cells !== false }),
        hash: read.value.hash,
        bytes: read.value.bytes,
      }
    },
  })

  register('njau_office_edit', {
    description:
      '按位置改一个 .docx（读→改→写，原子保存）。ops 是操作数组，按顺序执行。可用操作：' +
      'set_text{index,text} 整段替换文字；' +
      'set_runs{index,runs:[{text,bold,italic,underline,size,color}]} 保留段内格式；' +
      'set_kind{index,kind} 改段落类型（p/title/subtitle/quote/list/h1..h6）；' +
      'set_align{index,align:left|center|right|justify|none}；' +
      'insert{index?,text,kind?} 插入新段落（index 省略则追加到末尾）；' +
      'delete{index} 删除顶层块；' +
      'set_cell{index,row,col,text} 改表格单元格；' +
      'replace_text{find,replace,limit?} 全文替换；' +
      'append_table{rows,cols} 在末尾加一张空表。',
    parameters: objectSchema({
      path: { type: 'string', description: '.docx 的绝对路径或相对文档根目录的路径。' },
      ops: {
        type: 'array',
        description: '要执行的操作数组，见工具说明。',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', description: '操作名' },
            index: { type: 'number', description: '顶层块下标' },
            text: { type: 'string', description: '文字内容' },
            kind: { type: 'string', description: '段落类型' },
            align: { type: 'string', description: '对齐方式' },
            level: { type: 'number', description: '列表层级' },
            row: { type: 'number', description: '表格行号（从 0 开始）' },
            col: { type: 'number', description: '表格列号（从 0 开始）' },
            rows: { type: 'number', description: '建表的行数' },
            cols: { type: 'number', description: '建表的列数' },
            find: { type: 'string', description: '要被替换的文字' },
            replace: { type: 'string', description: '替换成的文字' },
            limit: { type: 'number', description: 'replace_text 最多替换几处' },
            runs: {
              type: 'array',
              description: 'set_runs 的文字片段数组',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  bold: { type: 'boolean' },
                  italic: { type: 'boolean' },
                  underline: { type: 'boolean' },
                  strike: { type: 'boolean' },
                  size: { type: 'number' },
                  color: { type: 'string' },
                },
              },
            },
          },
          required: ['op'],
        },
      },
    }, ['path', 'ops']),
    behavior: 'write',
    execute(args) {
      return pass(service.edit(args?.path, args?.ops))
    },
  })

  register('njau_office_create', {
    description: '新建一个空的 .docx（可选标题）。文件已存在会拒绝，不会覆盖。',
    parameters: objectSchema({
      path: { type: 'string', description: '要创建的 .docx 路径。' },
      title: { type: 'string', description: '可选：第一行标题。' },
    }, ['path']),
    behavior: 'write',
    execute(args) {
      return pass(service.create(args?.path, args?.title))
    },
  })

  register('njau_office_status', {
    description:
      '报告文档编辑器是否可用：文档根目录、接口地址、以及当前环境里能不能用面板。' +
      '用户说「打不开文档」「面板是空的」时先跑这个。',
    parameters: objectSchema({}),
    behavior: 'read',
    execute() {
      return {
        service: 'njau-office',
        root: service.root,
        api: '/njau/api/office',
        tools: ['njau_office_list', 'njau_office_read', 'njau_office_edit', 'njau_office_create'],
        hint: '面板在会话右侧栏的「办公」标签页；打不开时先看 host 日志里有没有 [njau-office] 前缀的报错。',
      }
    },
  })

  return count
}
