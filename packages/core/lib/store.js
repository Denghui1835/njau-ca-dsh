/**
 * store.js —— 计协生态的共享数据层约定。
 *
 * 为什么是文件而不是数据库：
 *   社团每两年换一批人。SQLite 里的东西交接不了，Markdown/JSON 可以。
 *   数据能用 git diff、能直接看、能打印出来贴进会议纪要 —— 这比「高效」重要得多。
 *
 * 目录约定（所有业务插件共享同一套，见 docs/architecture.md）：
 *   <root>/
 *     identity.json          协会身份卡（唯一真源）
 *     org/                   组织与成员
 *     recruit/               纳新与迎新
 *     events/                活动与立项
 *     finance/               经费与物资
 *     media/                 宣传与品牌
 *     report/                周报 / 月报 / 会议纪要
 *     learning/              竞赛与学习
 *     kb/                    知识库
 *     site/                  对外门户素材
 *     school/                校务对接与台账
 *     compliance/            合规自查记录
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

/** 业务域清单。加域只改这一处 + 建一个插件包。 */
export const DOMAINS = [
  { id: 'org', zh: '组织与成员', en: 'Organization', plugin: '@njau-ca/dsh-njau-org' },
  { id: 'recruit', zh: '纳新与迎新', en: 'Recruitment', plugin: '@njau-ca/dsh-njau-recruit' },
  { id: 'events', zh: '活动与立项', en: 'Events', plugin: '@njau-ca/dsh-njau-events' },
  { id: 'finance', zh: '经费与物资', en: 'Finance', plugin: '@njau-ca/dsh-njau-finance' },
  { id: 'media', zh: '宣传与品牌', en: 'Media', plugin: '@njau-ca/dsh-njau-media' },
  { id: 'report', zh: '报告与纪要', en: 'Reports', plugin: '@njau-ca/dsh-njau-report' },
  { id: 'learning', zh: '竞赛与学习', en: 'Learning', plugin: '@njau-ca/dsh-njau-learning' },
  { id: 'kb', zh: '知识库', en: 'Knowledge base', plugin: '@njau-ca/dsh-njau-kb' },
  { id: 'site', zh: '对外门户', en: 'Public site', plugin: '@njau-ca/dsh-njau-site' },
  { id: 'school', zh: '校务对接', en: 'School liaison', plugin: '@njau-ca/dsh-njau-school' },
  { id: 'compliance', zh: '合规自查', en: 'Compliance', plugin: '@njau-ca/dsh-njau-compliance' },
];

export const DEFAULT_IDENTITY = {
  fullName: '南京农业大学计算机爱好者协会',
  shortName: '南农计协',
  abbr: 'NJAU-CA',
  school: '南京农业大学',
  motto: '让每一个对计算机感兴趣的人，都能在这里做成一件事。',
  founded: '',
  contact: '',
  domains: DOMAINS.map((d) => d.id),
};

/**
 * 当前学年。国内高校以 9 月为学年起点：
 *   2026 年 9 月 ~ 2027 年 8 月 → '2026-2027'
 * 学年是所有归档、命名、交接的基准，所以只在这一处计算。
 */
export function currentSchoolYear(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return m >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/**
 * 把 YAML 传进来的（可能为空的）config 规范化成插件内部用的 env。
 * 任何字段缺失都不报错 —— 装完就能跑，是这套生态的硬要求。
 *
 * 数据根目录优先级：config.dataDir > 环境变量 NJAU_CA_DATA > ~/.dsh/njau-ca
 */
export function createEnv(ctx, config = {}) {
  const raw = (config.dataDir ?? process.env.NJAU_CA_DATA ?? join(homedir(), '.dsh', 'njau-ca'));
  const root = resolve(expandHome(String(raw)));
  ensureDir(root);

  const now = new Date();
  const schoolYear = config.schoolYear !== undefined ? String(config.schoolYear) : currentSchoolYear(now);

  const env = {
    root,
    ctx,
    config,
    now,
    stats: { tools: 0, skills: 0, commands: 0, promptSections: 0 },
    logger: ctx?.logger,
    identity: null,
  };

  // 身份卡落盘：第一次运行就把默认身份写下去，之后以文件为准。
  // 这样「协会叫什么、第几届」这类事，改文件就行，不用改代码、不用重装插件。
  const idPath = join(root, 'identity.json');
  let onDisk = null;
  try {
    onDisk = readJsonFile(idPath);
  } catch {
    onDisk = null;
  }

  const identity = {
    ...DEFAULT_IDENTITY,
    ...(onDisk ?? {}),
    ...(config.clubName !== undefined ? { fullName: String(config.clubName) } : {}),
    ...(config.shortName !== undefined ? { shortName: String(config.shortName) } : {}),
    // 学年会随时间走：文件里没写死、或调用方显式指定时，以本次计算/传入值为准。
    ...(onDisk === null || config.schoolYear !== undefined || onDisk.schoolYear === undefined
      ? { schoolYear }
      : {}),
  };
  env.identity = identity;

  if (onDisk === null) {
    try {
      writeJsonFile(idPath, identity);
    } catch (error) {
      env.logger?.warn?.('[njau-ca] 身份卡写入失败：' + String(error));
    }
  }

  return env;
}

export function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 把用户给的相对路径锁在数据根目录内。
 * 协会数据里有经费明细、成员联系方式，不允许被 ../ 走出根目录。
 *
 * 绝对路径直接拒绝，而不是把开头的 / 悄悄剥掉当成相对路径 ——
 * 「/etc/passwd 被写成 <root>/etc/passwd」这种事，静默比报错危险得多。
 */
export function resolveInside(root, relPath) {
  if (typeof relPath !== 'string' || relPath.trim() === '') {
    throw new Error('路径不能为空');
  }
  if (/^([/\\]|[A-Za-z]:)/.test(relPath)) {
    throw new Error('只接受相对协会数据目录的路径，不要用绝对路径：' + relPath);
  }
  const cleaned = relPath.replace(/\\/g, '/');
  if (cleaned.split('/').includes('..')) {
    throw new Error('路径不允许包含 ..');
  }
  const abs = isAbsolute(cleaned) ? normalize(cleaned) : resolve(root, cleaned);
  const rel = relative(root, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('路径越出协会数据目录：' + relPath);
  }
  return abs;
}

/** 相对根目录的 POSIX 风格路径，用于展示与 git diff。 */
export function toRel(root, abs) {
  return relative(root, abs).split(sep).join('/');
}

export function readTextFile(abs) {
  return readFileSync(abs, 'utf8');
}

export function writeTextFile(abs, text) {
  ensureDir(dirname(abs));
  // 原子写：先写临时文件再 rename。
  // 断电/崩溃时不会留下半截 JSON —— 协会数据被写坏一次，这套东西就没人信了。
  const tmp = abs + '.tmp-' + process.pid;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, abs);
  return abs;
}

export function readJsonFile(abs) {
  if (!existsSync(abs)) return null;
  const raw = readFileSync(abs, 'utf8');
  if (raw.trim() === '') return null;
  return JSON.parse(raw);
}

export function writeJsonFile(abs, value) {
  return writeTextFile(abs, JSON.stringify(value, null, 2) + '\n');
}

/** 递归列出数据目录下的文件（跳过临时文件），返回相对路径数组。 */
export function listDataFiles(root, subdir = '') {
  const base = subdir === '' ? root : resolveInside(root, subdir);
  if (!existsSync(base)) return [];
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      if (name.includes('.tmp-')) continue;
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(abs);
      else out.push({ path: toRel(root, abs), size: st.size, mtime: st.mtime.toISOString() });
    }
  };
  walk(base);
  return out;
}

/** 统一的返回壳，让模型看到的结果结构稳定、可预期。 */
export function ok(payload) {
  return { ok: true, ...payload };
}

export function fail(code, message) {
  return { ok: false, error: { code, message } };
}