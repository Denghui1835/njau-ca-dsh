/**
 * tools.js —— deck 的工具。
 *
 * 注册契约与 core 一致（在 dsh 0.1.5+ 上验证过）：
 *   ctx.tools.register({
 *     name, description,
 *     parameters,                 必须是规范 JSON Schema，
 *                                 必填写成对象级 required: ["x"]
 *     behavior: 'read'|'write'|'idempotent'|'destroy',
 *     output: { schema, render(args, value) => [{type:'text', text}] },
 *     execute(args) => value,     throw 会被转成 Error 结果
 *     isConcurrencySafe: () => true   只读工具才加
 *   })
 */

import { buildBrief, listOutlines, listTemplates, readTemplate, saveOutline } from './deck.js';
import { fail, ok } from './env.js';

function objectSchema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
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
    env.logger?.warn?.('[njau-ca] tools 服务不可用，deck 工具未注册');
    return;
  }

  const register = (toolName, def, execute) => {
    const behavior = def.behavior ?? 'read';
    tools.register({
      ...def,
      name: toolName,
      behavior,
      readOnly: behavior === 'read',
      idempotent: behavior === 'read' || behavior === 'idempotent' || behavior === 'destroy',
      destructive: behavior === 'destroy',
      output: TEXT_RESULT,
      execute,
      ...(behavior === 'read' ? { isConcurrencySafe: () => true } : {}),
    });
    env.stats.tools += 1;
  };

  // ------------------------------------------------------- 列模板
  register(
    'njau_deck_templates',
    {
      description:
        '列出南农计协的标准演示模板（纳新宣讲、年审汇报、活动立项答辩等），返回每个模板的 id、名称、用途、时长和页序。' +
        '要做任何 PPT 之前，先用这个工具挑一个模板，不要凭空想结构。',
      parameters: objectSchema({}, []),
      behavior: 'read',
    },
    () => {
      const all = listTemplates(env);
      return ok({
        templatesDir: env.templatesDir,
        count: all.length,
        templates: all.map((t) => ({
          id: t.id,
          name: t.name,
          use: t.use,
          duration: t.duration,
          slideCount: t.slideCount,
          required: t.required,
          slides: t.slides,
        })),
        hint: '用 njau_deck_template 读某个模板的全文（每页写什么、素材从哪来）。',
      });
    },
  );

  // ------------------------------------------------------- 读模板
  register(
    'njau_deck_template',
    {
      description: '读取一个计协演示模板的全文：每一页的页面元素、怎么讲、素材来源。看完再动手填内容。',
      parameters: objectSchema(
        { id: { type: 'string', description: '模板 id，例如 recruit / annual-review / event-proposal。' } },
        ['id'],
      ),
      behavior: 'read',
    },
    (args) => {
      const t = readTemplate(env, args?.id);
      if (t === null) {
        const ids = listTemplates(env).map((x) => x.id);
        return fail('template/not-found', '没有模板「' + String(args?.id) + '」。可用：' + (ids.join(', ') || '（一个都没有）'));
      }
      return ok({
        id: t.id, name: t.name, use: t.use, duration: t.duration,
        required: t.required, slides: t.slides, body: t.body,
      });
    },
  );

  // ------------------------------------------------------- 存大纲
  register(
    'njau_deck_outline_write',
    {
      description:
        '把一份演示大纲存进协会数据目录（deck/<slug>.json），不存在则新建、存在则覆盖。' +
        'slides 传 JSON 数组字符串，每项形如 {"title":"...","bullets":["..."],"notes":"..."}。' +
        '大纲是纯文本，能进 git、能被下一届直接改。',
      parameters: objectSchema(
        {
          slug: { type: 'string', description: '文件名标识，例如 2026-fall-recruit。留空则由 title 生成。' },
          title: { type: 'string', description: '演示标题。' },
          template: { type: 'string', description: '用了哪个模板的 id（可选，但建议填，方便以后追溯）。' },
          subtitle: { type: 'string', description: '副标题（可选）。' },
          date: { type: 'string', description: '日期或届次，例如 2026-09（可选）。' },
          slides: { type: 'string', description: 'JSON 数组字符串，每项 {title, bullets[], notes?, layout?}。' },
        },
        ['title', 'slides'],
      ),
      behavior: 'write',
    },
    (args) => {
      let slides;
      try {
        slides = JSON.parse(args.slides);
      } catch (error) {
        return fail('json/invalid', 'slides 不是合法 JSON：' + String(error.message ?? error));
      }
      if (!Array.isArray(slides)) return fail('json/not-array', 'slides 必须是一个 JSON 数组。');
      try {
        const rec = saveOutline(env, {
          slug: args.slug, title: args.title, template: args.template ?? null,
          subtitle: args.subtitle ?? null, date: args.date ?? null, slides,
        });
        return ok({
          path: 'deck/' + rec.slug + '.json',
          slug: rec.slug, slides: rec.slides.length, updatedAt: rec.updatedAt,
        });
      } catch (error) {
        return fail('outline/write-failed', '写入失败：' + String(error.message ?? error));
      }
    },
  );

  // ------------------------------------------------------- 列大纲
  register(
    'njau_deck_outline_list',
    {
      description: '列出协会已经存过的演示大纲（deck/<slug>.json），看往届都做过什么、可以拿来改。',
      parameters: objectSchema({}, []),
      behavior: 'read',
    },
    () => {
      const all = listOutlines(env);
      return ok({ deckRoot: env.deckRoot, count: all.length, outlines: all });
    },
  );

  // ------------------------------------------------------- 渲染简报
  register(
    'njau_deck_brief',
    {
      description:
        '把一份大纲翻成「渲染简报」——每一页写什么、什么版式、讲者备注。' +
        '拿到简报后，用 office-pptx 技能把它变成真正的 .pptx 文件。' +
        '这个工具不会自己生成 PPT，它只负责把计协的内容准备好。',
      parameters: objectSchema({ slug: { type: 'string', description: '大纲的 slug。' } }, ['slug']),
      behavior: 'read',
    },
    (args) => {
      const brief = buildBrief(env, args?.slug);
      if (brief === null) {
        const known = listOutlines(env).map((o) => o.slug);
        return fail('outline/not-found', '没有大纲「' + String(args?.slug) + '」。已知：' + (known.join(', ') || '（一个都没有，先写一份）'));
      }
      return ok(brief);
    },
  );
}