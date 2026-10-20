/**
 * deck.js —— 计协标准演示模板、大纲存取、渲染简报。
 *
 * 这里装的**只有计协自己的知识**：一场纳新宣讲该有哪几页、
 * 年审汇报必须带哪些数据、活动立项答辩怎么排。
 *
 * 真正把 .pptx 生成出来的活儿交给 office-pptx 技能去做 ——
 * 插件之间不互相调用，由 agent 编排（铁律 1）。
 * 本文件只用 node: 内置模块（铁律 2）。
 */

import { basename, join } from 'node:path';
import { listFiles, readJsonFile, readTextFile, resolveInside, writeJsonFile } from './env.js';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
/* 页标题：`## 1. 封面` / `### 1. 封面` 都认（1 个 # 是文档标题，不算页）。 */
const SLIDE_HEADING = /^#{2,3}\s+(\d+)[.、．]\s*(.+?)\s*$/;

/** 解析模板 Markdown：frontmatter 出元信息，`### N. 标题` 出页序。 */
export function parseTemplate(text, file) {
  const meta = {};
  let body = text;
  const m = FRONTMATTER.exec(text);
  if (m !== null) {
    body = text.slice(m[0].length);
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i <= 0) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k !== '') meta[k] = v;
    }
  }
  const slides = [];
  for (const line of body.split(/\r?\n/)) {
    const h = SLIDE_HEADING.exec(line);
    if (h !== null) slides.push({ n: Number(h[1]), title: h[2] });
  }
  return {
    id: meta.id ?? basename(file).replace(/\.md$/i, ''),
    name: meta.name ?? basename(file),
    use: meta.use ?? '',
    duration: meta.duration ?? '',
    required: meta.required === undefined ? [] : meta.required.split('/').map((s) => s.trim()).filter((s) => s !== ''),
    file: basename(file),
    slideCount: slides.length,
    slides,
    body: body.trim(),
  };
}

export function listTemplates(env) {
  const files = listFiles(env.templatesDir, '.md').filter((n) => n.toLowerCase() !== 'readme.md');
  const out = [];
  for (const f of files) {
    try {
      out.push(parseTemplate(readTextFile(join(env.templatesDir, f)), f));
    } catch { /* 读不了的模板跳过，不影响其它模板 */ }
  }
  return out;
}

export function readTemplate(env, id) {
  const all = listTemplates(env);
  const key = String(id ?? '').trim().toLowerCase();
  return all.find((t) => t.id.toLowerCase() === key)
    ?? all.find((t) => t.file.toLowerCase() === key + '.md')
    ?? null;
}

/** 文件名安全化：中文保留，其余非字母数字压成连字符。 */
export function slugify(s) {
  const base = String(s ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base === '' ? 'deck-' + Date.now() : base;
}

export function outlinePath(env, slug) {
  return resolveInside(env.deckRoot, slugify(slug) + '.json');
}

export function readOutline(env, slug) {
  try {
    return readJsonFile(outlinePath(env, slug), null);
  } catch {
    return null;
  }
}

export function saveOutline(env, outline) {
  const slug = slugify(outline.slug ?? outline.title ?? '');
  const now = new Date().toISOString();
  const prev = readOutline(env, slug);
  const rec = {
    ...outline,
    slug,
    template: outline.template ?? null,
    slides: Array.isArray(outline.slides) ? outline.slides : [],
    createdAt: prev === null ? now : (prev.createdAt ?? now),
    updatedAt: now,
  };
  writeJsonFile(outlinePath(env, slug), rec);
  return rec;
}

export function listOutlines(env) {
  return listFiles(env.deckRoot, '.json').map((f) => {
    const j = readJsonFile(join(env.deckRoot, f), {}) ?? {};
    return {
      slug: j.slug ?? basename(f).replace(/\.json$/i, ''),
      title: j.title ?? '(无标题)',
      template: j.template ?? null,
      slides: Array.isArray(j.slides) ? j.slides.length : 0,
      updatedAt: j.updatedAt ?? null,
    };
  });
}

/**
 * 渲染简报：把大纲翻成「每页写什么」的机器可读清单。
 * 这份简报就是交给 office-pptx 的输入。
 */
export function buildBrief(env, slug) {
  const o = readOutline(env, slug);
  if (o === null) return null;
  const slides = (Array.isArray(o.slides) ? o.slides : []).map((s, i) => ({
    n: s.n ?? i + 1,
    layout: s.layout ?? (i === 0 ? 'title' : 'title-and-content'),
    title: s.title ?? '',
    subtitle: s.subtitle ?? null,
    bullets: Array.isArray(s.bullets) ? s.bullets : [],
    table: s.table ?? null,
    notes: s.notes ?? '',
  }));
  return {
    slug: o.slug ?? slug,
    title: o.title ?? '(无标题)',
    subtitle: o.subtitle ?? env.identity.shortName + ' · ' + env.schoolYear,
    author: o.author ?? env.identity.shortName,
    date: o.date ?? '',
    theme: o.theme ?? { primary: '#0B5FFF', dark: '#4D93F8' },
    slideCount: slides.length,
    slides,
    renderWith: 'office-pptx',
    note: '本简报只描述每一页写什么。生成 .pptx 请用 office-pptx 技能，不要自己拼 XML。',
  };
}