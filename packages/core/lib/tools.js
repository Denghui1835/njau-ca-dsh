/**
 * tools.js —— 内核工具。
 *
 * 工具注册契约（在 dsh 0.1.5+ 上用 dsh-normify 的 31 个工具验证过）：
 *   ctx.tools.register({
 *     name, description,
 *     parameters,                 必须是【规范 JSON Schema】——
 *                                 属性级 required:true 不是合法关键字，
 *                                 必填要写成对象级 required: ["x"]。
 *     behavior: 'read'|'write'|'idempotent'|'destroy',
 *     output: { schema, render(args, value) => [{type:'text', text}] },
 *     execute(args) => value,     throw 会被转换成 Error 结果，不会中断本轮
 *     readOnly / idempotent / destructive,   旧标记，留着不碍事
 *     isConcurrencySafe: () => true          只读工具才加，加了才能被并行调度
 *   })
 */

import { join } from 'node:path';
import {
  DOMAINS,
  fail,
  listDataFiles,
  ok,
  readJsonFile,
  readTextFile,
  resolveInside,
  toRel,
  writeJsonFile,
  writeTextFile,
} from './store.js';

/** 规范 JSON Schema 构造器：把“属性 + 必填表”编译成标准对象 schema。 */
function objectSchema(properties, required = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

const TEXT_RESULT = {
  schema: {},
  render(_args, value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return [{ type: 'text', text }];
  },
};

export function registerTools(ctx, env) {
  const tools = ctx.tools;
  if (tools === undefined || typeof tools.register !== 'function') {
    env.logger?.warn?.('[njau-ca] tools 服务不可用，内核工具未注册');
    return;
  }

  const register = (toolName, def, execute) => {
    const behavior = def.behavior ?? 'read';
    tools.register({
      ...def,
      name: toolName,
      behavior,
      // 旧版兼容标记：新版 dsh 不再读取，但留着对老版本无害。
      readOnly: behavior === 'read',
      idempotent: behavior === 'read' || behavior === 'idempotent' || behavior === 'destroy',
      destructive: behavior === 'destroy',
      output: TEXT_RESULT,
      execute,
      ...(behavior === 'read' ? { isConcurrencySafe: () => true } : {}),
    });
    env.stats.tools += 1;
  };

  // ---------------------------------------------------------------- 概览
  register(
    'njau_overview',
    {
      description:
        '读取南农计协的身份卡与生态概览：协会名称、当前学年、数据目录、以及本生态有哪些业务域。' +
        '任何涉及“我们协会”的任务开始前，先用这个工具确认上下文。',
      parameters: objectSchema({}, []),
      behavior: 'read',
    },
    () => {
      const files = listDataFiles(env.root);
      return ok({
        identity: env.identity,
        dataRoot: env.root,
        domains: DOMAINS.map((d) => ({ id: d.id, name: d.zh, plugin: d.plugin })),
        dataFileCount: files.length,
        hint: '用 njau_data_list 看有哪些数据文件；用 njau_data_read 读具体内容。',
      });
    },
  );

  // ------------------------------------------------------------ 数据-列目录
  register(
    'njau_data_list',
    {
      description:
        '列出协会数据目录下的文件（可按业务域过滤）。用来回答“我们有哪些资料”“报销记录在哪”。',
      parameters: objectSchema(
        {
          domain: {
            type: 'string',
            description:
              '业务域 id，例如 org / recruit / events / finance / media / report / learning / kb / site / school / compliance。留空则列全部。',
          },
        },
        [],
      ),
      behavior: 'read',
    },
    (args) => {
      const domain = typeof args?.domain === 'string' && args.domain.trim() !== '' ? args.domain.trim() : '';
      if (domain !== '' && !DOMAINS.some((d) => d.id === domain)) {
        return fail('domain/unknown', `未知业务域「${domain}」。可用：${DOMAINS.map((d) => d.id).join(', ')}`);
      }
      const files = listDataFiles(env.root, domain);
      return ok({ root: env.root, domain: domain === '' ? null : domain, count: files.length, files });
    },
  );

  // ------------------------------------------------------------ 数据-读
  register(
    'njau_data_read',
    {
      description:
        '读取协会数据目录下的一个文件（相对路径，例如 finance/2026-10-reimbursement.json 或 kb/章程.md）。',
      parameters: objectSchema(
        {
          path: { type: 'string', description: '相对协会数据目录的路径，正斜杠分隔。' },
        },
        ['path'],
      ),
      behavior: 'read',
    },
    (args) => {
      let abs;
      try {
        abs = resolveInside(env.root, args.path);
      } catch (error) {
        return fail('path/rejected', String(error.message ?? error));
      }
      try {
        const raw = readTextFile(abs);
        const isJson = abs.toLowerCase().endsWith('.json');
        return ok({
          path: toRel(env.root, abs),
          format: isJson ? 'json' : 'text',
          content: isJson ? readJsonFile(abs) : raw,
        });
      } catch (error) {
        return fail('file/read-failed', `读取失败：${String(error.message ?? error)}`);
      }
    },
  );

  // ------------------------------------------------------------ 数据-写
  register(
    'njau_data_write',
    {
      description:
        '写入协会数据目录下的一个文件（相对路径）。会做原子写，不会留下半截文件。' +
        'text 模式写纯文本/Markdown，json 模式写 JSON。',
      parameters: objectSchema(
        {
          path: { type: 'string', description: '相对协会数据目录的路径，正斜杠分隔。' },
          content: { type: 'string', description: 'json 模式传 JSON 字符串；text 模式传原文。' },
          mode: {
            type: 'string',
            description: 'text（默认）或 json。json 会先校验能否解析再落盘。',
            enum: ['text', 'json'],
          },
        },
        ['path', 'content'],
      ),
      behavior: 'write',
    },
    (args) => {
      let abs;
      try {
        abs = resolveInside(env.root, args.path);
      } catch (error) {
        return fail('path/rejected', String(error.message ?? error));
      }
      const mode = args.mode === 'json' ? 'json' : 'text';
      try {
        if (mode === 'json') {
          let parsed;
          try {
            parsed = JSON.parse(args.content);
          } catch (error) {
            return fail('json/invalid', `JSON 解析失败，未写入：${String(error.message ?? error)}`);
          }
          writeJsonFile(abs, parsed);
        } else {
          writeTextFile(abs, args.content);
        }
        return ok({ path: toRel(env.root, abs), mode, bytes: Buffer.byteLength(args.content, 'utf8') });
      } catch (error) {
        return fail('file/write-failed', `写入失败：${String(error.message ?? error)}`);
      }
    },
  );

  // ------------------------------------------------------- 数据-追加到列表
  register(
    'njau_data_append',
    {
      description:
        '向协会数据目录下的文件追加内容（文件不存在则创建）。' +
        '给 record 就是结构化台账（JSON 数组，自动补 _recordedAt）；' +
        '给 content 就是文本日志（markdown 追加一段）。' +
        '适合“记一笔报销”“登记一个报名”“补一条工作日志”这类只增不改的动作。',
      parameters: objectSchema(
        {
          path: { type: 'string', description: '相对路径。.json 台账用 record，其余用 content。' },
          record: { type: 'string', description: '要追加的记录，JSON 对象字符串。' },
          content: { type: 'string', description: '要追加的文本，markdown 日志用。' },
        },
        ['path'],
      ),
      behavior: 'write',
    },
    (args) => {
      let abs;
      try {
        abs = resolveInside(env.root, args.path);
      } catch (error) {
        return fail('path/rejected', String(error.message ?? error));
      }
      // 两种用法：record → 结构化台账；content → 文本日志（markdown 追加）。
      if (args.record === undefined && args.content !== undefined) {
        let prev = '';
        try {
          prev = readTextFile(abs);
        } catch {
          prev = '';
        }
        const text = String(args.content);
        writeTextFile(abs, prev + text);
        return ok({ path: toRel(env.root, abs), mode: 'text', bytes: Buffer.byteLength(text, 'utf8') });
      }
      let record;
      try {
        record = JSON.parse(args.record);
      } catch (error) {
        return fail('json/invalid', `record 不是合法 JSON：${String(error.message ?? error)}`);
      }
      if (record === null || typeof record !== 'object' || Array.isArray(record)) {
        return fail('json/not-object', 'record 必须是一个 JSON 对象。');
      }
      let list = readJsonFile(abs);
      if (list === null) list = [];
      if (!Array.isArray(list)) {
        return fail('data/not-array', `${toRel(env.root, abs)} 已存在且不是数组，拒绝追加以免覆盖。`);
      }
      const entry = { ...record, _recordedAt: new Date().toISOString() };
      list.push(entry);
      writeJsonFile(abs, list);
      return ok({ path: toRel(env.root, abs), total: list.length, appended: entry });
    },
  );

  // ------------------------------------------------------------ 生态自检
  register(
    'njau_doctor',
    {
      description:
        '检查计协 DSH 生态是否健康：数据目录能否读写、身份卡是否完整、各业务域目录是否存在。' +
        '换届交接、排错时先跑这个。',
      parameters: objectSchema({}, []),
      behavior: 'read',
    },
    () => {
      const checks = [];
      const domainsPresent = [];
      for (const d of DOMAINS) {
        const files = listDataFiles(env.root, d.id);
        if (files.length > 0) domainsPresent.push({ domain: d.id, name: d.zh, files: files.length });
        checks.push({ domain: d.id, name: d.zh, files: files.length });
      }
      const idPath = join(env.root, 'identity.json');
      let identityOk = false;
      let identityError = null;
      try {
        const id = readJsonFile(idPath);
        identityOk = id !== null && typeof id.fullName === 'string' && id.fullName !== '';
      } catch (error) {
        identityError = String(error.message ?? error);
      }
      const healthy = identityOk;
      return ok({
        healthy,
        dataRoot: env.root,
        identity: { present: identityOk, error: identityError, schoolYear: env.identity.schoolYear },
        registered: { tools: env.stats.tools, skills: env.stats.skills, commands: env.stats.commands },
        domainsWithData: domainsPresent,
        domains: checks,
      });
    },
  );
}