/**
 * smoke-deck.mjs —— deck 插件的冒烟测试。
 *
 * 用一个假的 ctx 把插件真正跑起来，逐个调用工具并检查契约。
 * 不依赖 dsh 本体，直接 node tests/smoke-deck.mjs 就能跑。
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 仓库根目录从本文件位置推出来，别写死本机路径（公开仓库里谁 clone 都能跑）。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'packages', 'deck', 'lib', 'index.js');

const problems = [];
const check = (cond, msg) => {
  if (cond) console.log('  \u2713 ' + msg);
  else {
    problems.push(msg);
    console.log('  \u2717 ' + msg);
  }
};

const dataRoot = mkdtempSync(join(tmpdir(), 'njau-deck-smoke-'));
process.env.NJAU_CA_DATA = dataRoot;

const tools = new Map();
const skills = [];
const effects = [];

const ctx = {
  logger: {
    warn: (...a) => console.log('    [warn]', ...a),
    info: () => {},
    error: (...a) => console.log('    [err]', ...a),
  },
  tools: {
    register(def) {
      tools.set(def.name, def);
      return () => {};
    },
  },
  skills: {
    register(def) {
      skills.push(def);
      return () => {};
    },
  },
  effect(fn, label) {
    effects.push(label);
    const d = fn();
    return () => {
      if (typeof d === 'function') d();
    };
  },
};

const mod = await import(pathToFileURL(ENTRY).href);

console.log('--- contract ---');
check(mod.name === '@njau-ca/dsh-njau-deck', 'plugin name');
check(mod.inject.includes('tools'), 'inject has tools');
check(mod.inject.includes('skills'), 'inject has skills');

mod.apply(ctx, {});
check(tools.size === 5, 'registered 5 tools (got ' + tools.size + ')');
check(skills.length === 1, 'registered 1 skill (got ' + skills.length + ')');
check(skills[0] && skills[0].name === 'njau-deck', 'skill name = njau-deck');
check(
  skills[0] && skills[0].resourceBase && skills[0].resourceBase.kind === 'directory',
  'skill resourceBase is directory',
);
check(skills[0] && skills[0].provider === 'njau-ca-deck', 'skill provider = njau-ca-deck');

for (const [n, d] of tools) {
  const bad = [];
  if (!d.description) bad.push('description');
  if (!d.parameters || d.parameters.type !== 'object') bad.push('parameters.type');
  if (!Array.isArray(d.parameters && d.parameters.required)) bad.push('required[]');
  if (!d.output || typeof d.output.render !== 'function') bad.push('output.render');
  if (typeof d.execute !== 'function') bad.push('execute');
  check(bad.length === 0, n + (bad.length ? ' MISSING: ' + bad.join(',') : ' contract ok'));
}

const call = (n, a) => tools.get(n).execute(a || {});

console.log('--- templates ---');
const list = await call('njau_deck_templates');
check(list.ok === true, 'templates ok');
check(list.count === 3, 'scanned 3 templates (got ' + list.count + ')');
check(
  list.templates
    .map((t) => t.id)
    .sort()
    .join(',') === 'annual-review,event-proposal,recruit',
  'template ids correct',
);
const recruit = list.templates.find((t) => t.id === 'recruit');
check(
  recruit && recruit.slideCount === 10,
  'recruit has 10 slides (got ' + (recruit && recruit.slideCount) + ')',
);
check(recruit && recruit.slides[0].title === '封面', 'slide 1 is cover');
check(recruit && recruit.required.length === 5, 'recruit has 5 required sections');

const annual = await call('njau_deck_template', { id: 'annual-review' });
check(annual.ok && annual.body.indexOf('财务管理') >= 0, 'annual-review has finance slide');
check(annual.duration === '10-15 分钟', 'frontmatter duration parsed (got ' + annual.duration + ')');

const miss = await call('njau_deck_template', { id: 'nope' });
check(
  miss.ok === false && miss.error.code === 'template/not-found',
  'missing template -> template/not-found',
);

console.log('--- outline ---');
const w = await call('njau_deck_outline_write', {
  slug: '2026-fall-recruit',
  title: '南农计协 2026 年秋季招新宣讲',
  template: 'recruit',
  date: '2026-09',
  slides: JSON.stringify([
    { title: '封面', bullets: ['南农计协 2026 秋季招新'], notes: '开场提问' },
    { title: '我们是谁', bullets: ['成立于 xxxx'], notes: '别念章程' },
  ]),
});
check(w.ok === true, 'outline write ok');
check(w.path === 'deck/2026-fall-recruit.json', 'path = ' + w.path);
check(existsSync(join(dataRoot, 'deck', '2026-fall-recruit.json')), 'file really on disk');
check(w.slides === 2, 'slide count 2');

const badJson = await call('njau_deck_outline_write', { title: 'x', slides: '{not json' });
check(badJson.ok === false && badJson.error.code === 'json/invalid', 'bad json -> json/invalid');
const notArr = await call('njau_deck_outline_write', { title: 'x', slides: '{"a":1}' });
check(notArr.ok === false && notArr.error.code === 'json/not-array', 'non-array -> json/not-array');

const ol = await call('njau_deck_outline_list');
check(ol.count === 1 && ol.outlines[0].slug === '2026-fall-recruit', 'listed 1 outline');

console.log('--- path safety ---');
const evil = await call('njau_deck_outline_write', {
  slug: '../../evil',
  title: 'evil',
  slides: '[]',
});
check(evil.ok === true && evil.slug === 'evil', 'traversal slug neutralised (got ' + evil.slug + ')');
check(existsSync(join(dataRoot, 'deck', 'evil.json')), 'stayed inside data dir');

console.log('--- render brief ---');
const brief = await call('njau_deck_brief', { slug: '2026-fall-recruit' });
check(brief.ok === true, 'brief ok');
check(brief.slideCount === 2, 'brief 2 slides');
check(brief.slides[0].layout === 'title', 'slide 1 layout = title');
check(brief.slides[1].layout === 'title-and-content', 'slide 2 layout = title-and-content');
check(brief.renderWith === 'office-pptx', 'delegates to office-pptx');
check(brief.author === '南农计协', 'author = club short name (got ' + brief.author + ')');
check(brief.theme.primary === '#0B5FFF', 'club brand colour');
const nb = await call('njau_deck_brief', { slug: 'none' });
check(nb.ok === false && nb.error.code === 'outline/not-found', 'missing outline -> outline/not-found');

console.log('--- effects ---');
check(effects.length >= 1, 'registered ' + effects.length + ' effect(s)');

rmSync(dataRoot, { recursive: true, force: true });
console.log('');
if (problems.length === 0) {
  console.log('\u2713 smoke-deck PASSED');
} else {
  console.log('\u2717 ' + problems.length + ' check(s) failed:');
  for (const p of problems) console.log('   - ' + p);
}
process.exitCode = problems.length > 0 ? 1 : 0;