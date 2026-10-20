/**
 * skills.js —— 把 skills/ 目录下的 SKILL.md 注册成 dsh 技能。
 *
 * 注册契约同 core（dsh 0.1.5+ 上验证过）：
 *   ctx.skills.register({ name, description, content, provider, source,
 *                         resourceBase: { kind:'directory', path },
 *                         invocation: { modelInvocable, userInvocable } }) => disposer
 *   ctx.effect(() => disposer, label)
 *
 * 本文件是 core/lib/skills.js 的**精简副本**：铁律 1 禁止插件互相调用，
 * 所以这里重复一遍而不是 import。provider 标成 njau-ca-deck，便于排查是谁注册的。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export function parseSkillMarkdown(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines[0] === undefined || lines[0].trim() !== '---') return { description: null, name: null, body: raw };
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') { close = i; break; }
  }
  if (close < 0) return { description: null, name: null, body: raw };
  const fm = lines.slice(1, close).join('\n');
  const pick = (key) => {
    const m = new RegExp('^' + key + ':\\s*(.+)$', 'm').exec(fm);
    return m === null ? null : m[1].trim().replace(/^["']|["']$/g, '');
  };
  return {
    description: pick('description'),
    name: pick('name'),
    body: lines.slice(close + 1).join('\n').replace(/^\n+/, ''),
  };
}

export function discoverSkills(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    const skillFile = join(dir, entry, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    try {
      if (!statSync(skillFile).isFile()) continue;
    } catch { continue; }
    found.push({ dirName: entry, file: skillFile, skillDir: join(dir, entry) });
  }
  return found;
}

export function registerSkills(ctx, env) {
  const skills = ctx.skills;
  if (skills === undefined || typeof skills.register !== 'function') {
    env.logger?.warn?.('[njau-ca] skills 服务不可用，deck 技能未注册');
    return;
  }
  const skillsRoot = join(HERE, '..', 'skills');
  const discovered = discoverSkills(skillsRoot);
  if (discovered.length === 0) {
    env.logger?.warn?.('[njau-ca] deck 未找到技能目录：' + skillsRoot);
    return;
  }
  for (const item of discovered) {
    let raw;
    try { raw = readFileSync(item.file, 'utf8'); } catch { continue; }
    const parsed = parseSkillMarkdown(raw);
    const skillName = parsed.name ?? item.dirName;
    if (parsed.description === null || parsed.description === '' || parsed.body.trim() === '') {
      env.logger?.warn?.('[njau-ca] deck 技能 ' + item.dirName + ' 缺 description 或正文为空，已跳过');
      continue;
    }
    try {
      const disposer = skills.register({
        name: skillName,
        description: parsed.description,
        content: parsed.body,
        provider: 'njau-ca-deck',
        source: 'bundled',
        resourceBase: { kind: 'directory', path: item.skillDir },
        invocation: { modelInvocable: true, userInvocable: true },
      });
      ctx.effect(() => disposer, '[njau-ca] deck skill ' + skillName);
      env.stats.skills += 1;
    } catch (error) {
      env.logger?.warn?.('[njau-ca] deck 技能注册失败 ' + skillName + '：' + String(error));
    }
  }
}