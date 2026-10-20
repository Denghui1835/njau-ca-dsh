/**
 * env.js —— deck 自带的最小环境层。
 *
 * 铁律 1：插件之间不互相调用。所以这里**故意**不 import core，
 * 而是把需要的那点逻辑抄一份过来。重复好过耦合：
 * 就算 core 被摘掉，deck 照样能跑。
 *
 * 铁律 2：零运行时依赖。只用 node: 内置模块，不 import 任何 @deepseek-ai/*。
 */

import fs from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

export const DEFAULT_IDENTITY = {
  clubName: '南京农业大学计算机爱好者协会',
  shortName: '南农计协',
  enName: 'NJAU Computer Enthusiasts Association',
};

export function expandHome(p) {
  if (typeof p !== 'string' || p === '') return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 只接受「数据根以内的相对路径」，挡掉绝对路径、盘符和 .. 穿越。 */
export function resolveInside(root, rel) {
  if (typeof rel !== 'string' || rel.trim() === '') throw new Error('路径不能为空');
  const clean = rel.replace(/\\/g, '/').trim();
  if (/^([/\\]|[A-Za-z]:)/.test(clean)) throw new Error('只接受相对路径，收到绝对路径：' + rel);
  const segs = clean.split('/').filter((s) => s !== '' && s !== '.');
  if (segs.some((s) => s === '..')) throw new Error('路径不能包含 ..：' + rel);
  const base = resolve(root);
  const full = resolve(base, ...segs);
  if (full !== base && !full.startsWith(base + sep)) throw new Error('路径越界：' + rel);
  return full;
}

export function readTextFile(p) {
  return fs.readFileSync(p, 'utf8');
}

/** 原子写：先写临时文件再改名，不会留下半截文件。 */
export function writeTextFile(p, text) {
  ensureDir(dirname(p));
  const tmp = p + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, p);
  return p;
}

export function readJsonFile(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

export function writeJsonFile(p, value) {
  return writeTextFile(p, JSON.stringify(value, null, 2) + '\n');
}

export function listFiles(dir, ext = null) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((n) => (ext === null ? true : n.endsWith(ext)))
      .sort();
  } catch { return []; }
}

export function ok(data) { return { ok: true, ...data }; }
export function fail(code, message) { return { ok: false, error: { code, message } }; }

/** 学年按 9 月切分：9 月及以后算新学年。 */
export function currentSchoolYear(now = new Date()) {
  const y = now.getFullYear();
  const start = now.getMonth() + 1 >= 9 ? y : y - 1;
  return start + '-' + (start + 1);
}

export function createEnv(ctx, config = {}, pkgDir = process.cwd()) {
  const raw = config.dataDir || process.env.NJAU_CA_DATA || join(homedir(), '.dsh', 'njau-ca');
  const root = resolve(expandHome(raw));
  ensureDir(root);
  const deckRoot = ensureDir(join(root, 'deck'));
  const templatesDir = config.templatesDir ? resolve(expandHome(config.templatesDir)) : join(pkgDir, 'templates');
  return {
    root,
    deckRoot,
    templatesDir,
    pkgDir,
    ctx,
    config,
    identity: { ...DEFAULT_IDENTITY, ...(config.identity ?? {}) },
    schoolYear: currentSchoolYear(),
    stats: { tools: 0, skills: 0 },
    logger: ctx?.logger ?? console,
  };
}