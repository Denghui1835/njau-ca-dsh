/**
 * smoke-core.mjs —— core 插件的自检。
 *
 * 为什么要这个：DSH 插件是「装进别人电脑里、出问题你看不到」的东西。
 * 一旦 tools 的 parameters 不是合法 JSON Schema，或者命令名不合规，
 * 症状是「在别人机器上悄悄不工作」，而不是报错。所以每次改完必须跑这个。
 *
 * 用法：
 *   node tests/smoke-core.mjs [packages/core/lib/index.js 的路径]
 *
 * 退出码 0 = 全部通过；1 = 有问题（逐条打印）。
 */

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pluginPath = resolve(process.argv[2] ?? join(here, '..', 'packages', 'core', 'lib', 'index.js'));

const problems = [];
const notes = [];
const bad = (msg) => problems.push(msg);

// ---------------------------------------------------------------- 沙箱数据目录
// 绝不能在真实数据目录上跑自检：会写出 identity.json、污染真数据。
const dataDir = mkdtempSync(join(tmpdir(), 'njau-smoke-'));
process.env.NJAU_CA_DATA = dataDir;

// ---------------------------------------------------------------- 假 ctx
const registeredTools = new Map();
const registeredSkills = [];
const registeredCommands = [];
const registeredSections = [];
const effects = [];
const logs = [];

const ctx = {
  logger: {
    info: (m) => logs.push(['info', String(m)]),
    warn: (m) => logs.push(['warn', String(m)]),
    error: (m) => logs.push(['error', String(m)]),
  },
  effect(fn, label) {
    effects.push(label ?? '(unnamed)');
    try {
      const r = fn();
      // 支持生成器形态的 ctx.effect(function* () { yield disposer })
      if (r && typeof r.next === 'function') {
        let step = r.next();
        while (!step.done) step = r.next();
      }
    } catch (error) {
      bad(`ctx.effect(${label}) 抛错：${error}`);
    }
  },
  tools: {
    register(def) {
      if (registeredTools.has(def.name)) bad(`工具重名：${def.name}`);
      registeredTools.set(def.name, def);
      return () => registeredTools.delete(def.name);
    },
  },
  skills: {
    register(def) {
      registeredSkills.push(def);
      return () => {};
    },
  },
  commands: {
    register(def) {
      registeredCommands.push(def);
      return () => {};
    },
  },
  systemPrompt: {
    section(def) {
      registeredSections.push(def);
      return () => {};
    },
  },
};

// ---------------------------------------------------------------- 载入插件
let mod;
try {
  mod = await import(pathToFileURL(pluginPath).href);
} catch (error) {
  console.error(`✗ 无法载入插件 ${pluginPath}\n  ${error?.stack ?? error}`);
  process.exit(1);
}

if (typeof mod.apply !== 'function') bad('插件没有导出 apply 函数');
if (typeof mod.name !== 'string' || mod.name === '') bad('插件没有导出 name 字符串');
if (!Array.isArray(mod.inject)) bad('插件没有导出 inject 数组');

if (problems.length === 0) {
  try {
    mod.apply(ctx, {});
  } catch (error) {
    bad(`apply() 抛错：${error?.stack ?? error}`);
  }
}
if (problems.length > 0) {
  report();
  process.exit(1);
}

// ---------------------------------------------------------------- 工具校验
// dsh 0.1.5+ 把 parameters 原样交给模型/供应商，必须是规范 JSON Schema。
// 最常见的错误写法是属性级 required: true —— 它不是合法关键字，会被静默忽略。
const VALID_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);
const VALID_BEHAVIOR = new Set(['read', 'write', 'idempotent', 'destroy']);

for (const [name, def] of registeredTools) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) bad(`工具名不合规：${name}（要求 ^[a-z][a-z0-9_]*$）`);
  if (typeof def.description !== 'string' || def.description.trim() === '') {
    bad(`工具 ${name} 缺少 description`);
  }
  if (!VALID_BEHAVIOR.has(def.behavior)) {
    bad(`工具 ${name} 的 behavior 非法：${def.behavior}（应为 ${[...VALID_BEHAVIOR].join('/')}）`);
  }
  if (typeof def.execute !== 'function') bad(`工具 ${name} 没有 execute`);
  if (!def.output || typeof def.output.render !== 'function') {
    bad(`工具 ${name} 的 output.render 缺失（注册时会 TypeError）`);
  }

  const p = def.parameters;
  if (p === null || typeof p !== 'object') {
    bad(`工具 ${name} 的 parameters 不是对象`);
    continue;
  }
  if (p.type !== 'object') bad(`工具 ${name} 的 parameters.type 应为 'object'，实际 ${JSON.stringify(p.type)}`);
  if (p.properties === null || typeof p.properties !== 'object') {
    bad(`工具 ${name} 的 parameters.properties 缺失`);
    continue;
  }
  const props = p.properties;
  if (p.required !== undefined) {
    if (!Array.isArray(p.required)) {
      bad(`工具 ${name} 的 parameters.required 必须是字符串数组（对象级），实际 ${JSON.stringify(p.required)}`);
    } else {
      for (const r of p.required) {
        if (typeof r !== 'string') bad(`工具 ${name} 的 required 含非字符串项：${JSON.stringify(r)}`);
        else if (!Object.hasOwn(props, r)) bad(`工具 ${name} 的 required 列了不存在的属性：${r}`);
      }
    }
  }
  for (const [key, spec] of Object.entries(props)) {
    if (spec === null || typeof spec !== 'object') {
      bad(`工具 ${name} 属性 ${key} 不是对象`);
      continue;
    }
    // 属性级 required: true 是非法 JSON Schema 关键字 —— 必须用对象级 required[]
    if (Object.hasOwn(spec, 'required')) {
      bad(`工具 ${name} 属性 ${key} 用了属性级 required（非法 JSON Schema 关键字，会被静默忽略）；改用对象级 required: []`);
    }
    if (spec.type === undefined) {
      bad(`工具 ${name} 属性 ${key} 缺少 type`);
    } else if (!VALID_TYPES.has(spec.type)) {
      bad(`工具 ${name} 属性 ${key} 的 type 非法：${spec.type}`);
    }
    if (typeof spec.description !== 'string' || spec.description.trim() === '') {
      bad(`工具 ${name} 属性 ${key} 缺少 description（模型靠它决定怎么传参）`);
    }
  }

  if (def.behavior === 'read' && typeof def.isConcurrencySafe !== 'function') {
    notes.push(`工具 ${name} 是 read 但没有 isConcurrencySafe（只影响并发调度，不致命）`);
  }
}

// ---------------------------------------------------------------- 技能校验
// ctx.skills.register 的校验规则（dsh-skill 源码）：
//   name 必须匹配 /^[a-z0-9]+(?:-[a-z0-9]+)*$/
//   description 非空；invocation 必填且两个布尔字段
//   resourceBase 是三选一的闭合联合
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESOURCE_KINDS = new Set(['directory', 'url', 'opaque']);

if (registeredSkills.length === 0) bad('没有注册任何技能');
for (const s of registeredSkills) {
  if (typeof s.name !== 'string' || !SKILL_NAME_RE.test(s.name)) {
    bad(`技能名不合规：${JSON.stringify(s.name)}（要求 ^[a-z0-9]+(?:-[a-z0-9]+)*$）`);
  }
  if (typeof s.description !== 'string' || s.description.trim() === '') {
    bad(`技能 ${s.name} 的 description 为空（注册会抛错）`);
  }
  if (s.invocation === null || typeof s.invocation !== 'object') {
    bad(`技能 ${s.name} 缺少 invocation（注册会抛错）`);
  } else {
    if (typeof s.invocation.modelInvocable !== 'boolean') bad(`技能 ${s.name} invocation.modelInvocable 不是布尔`);
    if (typeof s.invocation.userInvocable !== 'boolean') bad(`技能 ${s.name} invocation.userInvocable 不是布尔`);
  }
  if (s.source !== undefined && typeof s.source !== 'string') {
    bad(`技能 ${s.name} 的 source 必须是字符串`);
  }
  if (s.resourceBase !== undefined) {
    if (s.resourceBase === null || typeof s.resourceBase !== 'object') {
      bad(`技能 ${s.name} 的 resourceBase 不是对象`);
    } else if (!RESOURCE_KINDS.has(s.resourceBase.kind)) {
      bad(`技能 ${s.name} 的 resourceBase.kind 非法：${s.resourceBase.kind}（只允许 directory/url/opaque）`);
    } else if (s.resourceBase.kind === 'directory' && typeof s.resourceBase.path !== 'string') {
      bad(`技能 ${s.name} 的 resourceBase.path 必须是字符串`);
    }
  }
}

// ---------------------------------------------------------------- 命令校验
// dsh-commands 硬约束：名称 /^[a-z][a-z0-9_-]*$/u —— 中文命令名不可能。
// 结果联合只有 {kind:'success',text?} 与 {kind:'error',text}（text 非空）。
const CMD_NAME_RE = /^[a-z][a-z0-9_-]*$/;
if (registeredCommands.length === 0) bad('没有注册任何命令');
for (const c of registeredCommands) {
  if (typeof c.name !== 'string' || !CMD_NAME_RE.test(c.name)) {
    bad(`命令名不合规：${JSON.stringify(c.name)}（要求 ^[a-z][a-z0-9_-]*$；中文不可用）`);
  }
  if (typeof c.description !== 'string' || c.description.trim() === '') {
    bad(`命令 ${c.name} 的 description 为空（注册会抛错）`);
  }
  if (typeof c.handler !== 'function') bad(`命令 ${c.name} 没有 handler`);
  if (c.input !== undefined) {
    if (c.input === null || typeof c.input !== 'object') bad(`命令 ${c.name} 的 input 不是对象`);
    else if (typeof c.input.hint !== 'string' || c.input.hint.trim() === '') {
      bad(`命令 ${c.name} 的 input.hint 必须是非空字符串`);
    }
  }
}

// ---------------------------------------------------------------- 提示词段
for (const s of registeredSections) {
  if (typeof s.name !== 'string' || s.name === '') bad('systemPrompt section 缺少 name');
  if (!Number.isFinite(s.order)) bad(`systemPrompt section ${s.name} 的 order 不是有限数`);
  if (typeof s.text !== 'string') bad(`systemPrompt section ${s.name} 的 text 不是字符串`);
}

// ---------------------------------------------------------------- 实跑工具
const expect = (cond, msg) => { if (!cond) bad(msg); };

const run = async (name, args) => {
  const def = registeredTools.get(name);
  if (def === undefined) { bad(`找不到工具 ${name}`); return undefined; }
  try {
    return await def.execute(args ?? {});
  } catch (error) {
    bad(`工具 ${name} 执行抛错：${error?.stack ?? error}`);
    return undefined;
  }
};

const overview = await run('njau_overview', {});
expect(overview?.ok === true, 'njau_overview 未返回 ok:true');
expect(typeof overview?.dataRoot === 'string', 'njau_overview 未返回 dataRoot');
expect(overview?.shortName !== undefined || overview?.identity !== undefined, 'njau_overview 未返回协会身份');

const doctor = await run('njau_doctor', {});
expect(doctor?.ok === true, 'njau_doctor 未返回 ok:true');

// 写入 → 读取 → 追加 → 列举，走一遍真实文件
const rel = 'report/' + new Date().toISOString().slice(0, 10) + '-smoke.md';
const w = await run('njau_data_write', { path: rel, content: '# smoke\n\n第一行\n' });
expect(w?.ok === true, `njau_data_write 失败：${JSON.stringify(w)}`);
expect(existsSync(join(dataDir, 'report')), 'njau_data_write 没有真的建出 report/ 目录');
const onDisk = existsSync(join(dataDir, rel)) ? readFileSync(join(dataDir, rel), 'utf8') : '';
expect(onDisk.includes('第一行'), 'njau_data_write 写下去的内容不对');

const a = await run('njau_data_append', { path: rel, content: '第二行\n' });
expect(a?.ok === true, `njau_data_append 失败：${JSON.stringify(a)}`);
expect(readFileSync(join(dataDir, rel), 'utf8').includes('第二行'), 'njau_data_append 没有追加成功');

const r = await run('njau_data_read', { path: rel });
expect(r?.ok === true, `njau_data_read 失败：${JSON.stringify(r)}`);
expect(String(r?.content ?? '').includes('第一行'), 'njau_data_read 读回的内容不对');

const l = await run('njau_data_list', {});
expect(l?.ok === true, `njau_data_list 失败：${JSON.stringify(l)}`);
const paths = (l?.files ?? l?.entries ?? []).map((f) => (typeof f === 'string' ? f : f.path));
expect(paths.some((p) => String(p).includes('smoke')), `njau_data_list 没有列出刚写的文件，实际：${JSON.stringify(paths)}`);

// 越界必须是失败而不是「写到了别处」——经费与成员信息不允许被 ../ 带出根目录
for (const evil of ['../../secret.txt', 'report/../../escape.txt', '/etc/passwd']) {
  const res = await run('njau_data_read', { path: evil });
  expect(res?.ok === false, `路径穿越未被拒绝：${evil} → ${JSON.stringify(res)}`);
  const res2 = await run('njau_data_write', { path: evil, content: 'x' });
  expect(res2?.ok === false, `写入路径穿越未被拒绝：${evil} → ${JSON.stringify(res2)}`);
}

// ---------------------------------------------------------------- 实跑命令
for (const c of registeredCommands) {
  let res;
  try {
    res = await c.handler({ rawInput: '', agent: undefined, attachments: [], signal: undefined });
  } catch (error) {
    // handler 抛错会被 dsh-commands 转成 error 结果，不算致命；但记下来
    notes.push(`命令 ${c.name} 的 handler 抛错（会被转成 error 结果）：${error}`);
    continue;
  }
  if (res === null || typeof res !== 'object') {
    bad(`命令 ${c.name} 的 handler 没有返回对象`);
    continue;
  }
  if (res.kind !== 'success' && res.kind !== 'error') {
    bad(`命令 ${c.name} 返回了非法 kind：${JSON.stringify(res.kind)}`);
  }
  if (res.kind === 'error' && (typeof res.text !== 'string' || res.text === '')) {
    bad(`命令 ${c.name} 返回 error 但 text 为空（注册会抛错）`);
  }
  if (res.kind === 'success' && res.text !== undefined && typeof res.text !== 'string') {
    bad(`命令 ${c.name} 的 success.text 不是字符串`);
  }
}

// ---------------------------------------------------------------- 汇总
report();
process.exitCode = problems.length > 0 ? 1 : 0;
rmSync(dataDir, { recursive: true, force: true });

function report() {
  if (notes.length > 0) {
    console.log('提示：');
    for (const n of notes) console.log('  · ' + n);
  }
  if (problems.length === 0) {
    console.log(
      `✓ smoke test 通过｜工具 ${registeredTools.size} · 技能 ${registeredSkills.length}` +
      ` · 命令 ${registeredCommands.length} · 提示词段 ${registeredSections.length}` +
      ` · effect ${effects.length}`
    );
    return;
  }
  console.error(`✗ smoke test 失败，共 ${problems.length} 个问题：`);
  for (const p of problems) console.error('  · ' + p);
}