/**
 * skills.js —— 把 skills/ 目录下的 SKILL.md 注册成 dsh 技能。
 *
 * 注册契约（在 dsh 0.1.5+ 上用 dsh-normify 验证过）：
 *   ctx.skills.register({
 *     name, description, content, provider, source,
 *     resourceBase: { kind: 'directory', path },
 *     invocation: { modelInvocable, userInvocable },
 *   }) => disposer
 *   ctx.effect(() => disposer, label)
 *
 * 为什么技能用 Markdown 而不是代码：
 *   制度、流程、模板这类东西改得比代码勤，而且改它的人往往不写代码。
 *   把知识放成 Markdown，会长和部长可以直接改，改完就是新版本 —— 这就是传承。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 解析 SKILL.md 的 YAML frontmatter。
 * 只认 description / name 两行 —— 刻意保持极简，避免引入 YAML 依赖。
 */
export function parseSkillMarkdown(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines[0] === undefined || lines[0].trim() !== '---') {
    return { description: null, name: null, body: raw };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      close = i;
      break;
    }
  }
  if (close < 0) return { description: null, name: null, body: raw };

  const fm = lines.slice(1, close).join('\n');
  const pick = (key) => {
    const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(fm);
    if (m === null) return null;
    return m[1].trim().replace(/^["']|["']$/g, '');
  };
  const body = lines.slice(close + 1).join('\n').replace(/^\n+/, '');
  return { description: pick('description'), name: pick('name'), body };
}

/** 扫描一个目录，返回其中所有 <name>/SKILL.md。 */
export function discoverSkills(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    const skillFile = join(dir, entry, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    try {
      if (!statSync(skillFile).isFile()) continue;
    } catch {
      continue;
    }
    found.push({ dirName: entry, file: skillFile, skillDir: join(dir, entry) });
  }
  return found;
}

export function registerSkills(ctx, env) {
  const skills = ctx.skills;
  if (skills === undefined || typeof skills.register !== 'function') {
    env.logger?.warn?.('[njau-ca] skills 服务不可用，内核技能未注册');
    return;
  }

  const skillsRoot = join(HERE, '..', 'skills');
  const discovered = discoverSkills(skillsRoot);
  if (discovered.length === 0) {
    env.logger?.warn?.('[njau-ca] 未找到任何技能目录：' + skillsRoot);
    return;
  }

  for (const item of discovered) {
    let raw;
    try {
      raw = readFileSync(item.file, 'utf8');
    } catch (error) {
      env.logger?.warn?.(`[njau-ca] 技能读取失败 ${item.dirName}：${String(error)}`);
      continue;
    }
    const parsed = parseSkillMarkdown(raw);
    const name = parsed.name ?? item.dirName;
    const description = parsed.description;
    if (description === null || description === '') {
      env.logger?.warn?.(`[njau-ca] 技能 ${item.dirName} 缺少 description，已跳过`);
      continue;
    }
    if (parsed.body.trim() === '') {
      env.logger?.warn?.(`[njau-ca] 技能 ${item.dirName} 正文为空，已跳过`);
      continue;
    }
    try {
      const disposer = skills.register({
        name,
        description,
        content: parsed.body,
        provider: 'njau-ca-core',
        source: 'bundled',
        resourceBase: { kind: 'directory', path: item.skillDir },
        invocation: { modelInvocable: true, userInvocable: true },
      });
      ctx.effect(() => disposer, `[njau-ca] skill ${name}`);
      env.stats.skills += 1;
    } catch (error) {
      env.logger?.warn?.(`[njau-ca] 技能注册失败 ${name}：${String(error)}`);
    }
  }
}