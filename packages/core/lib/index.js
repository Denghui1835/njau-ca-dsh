/**
 * index.js —— @njau-ca/dsh-njau-core 插件入口
 *
 * 设计原则（见 docs/architecture.md 与 docs/adr/）：
 *   1. 内核极薄：只提供身份、术语、路径约定与共享数据层，不含任何业务。
 *   2. 业务插件不互相 import，也不通过服务互相调用 —— 由 agent 编排。
 *   3. 零运行时依赖：只用 Node 内置模块，不 import @deepseek-ai/* 运行时包；
 *      这样插件在任何 dsh 版本里都能加载，也不会因为上游重构而炸。
 *
 * 插件契约（dsh 0.1.5+ 上用 dsh-normify 验证过的形态）：
 *   export const name      插件包名，必须与 cordis.patch.yml 里的 name 一致
 *   export const inject    依赖的服务：tools / skills / commands / systemPrompt
 *   export function apply(ctx, config)
 *
 * 注意：这里刻意不导出 schemastery 的 Config。
 * 不导出 Config 时，cordis 会把 YAML 里的 config 原样传进来，
 * 于是本插件对 @deepseek-ai/schemastery 零依赖 —— 少一个会随 dsh 升级而失效的环节。
 * 配置的规范化与默认值全部在 createEnv() 里做。
 */

import { createEnv, DEFAULT_IDENTITY } from './store.js';
import { registerTools } from './tools.js';
import { registerSkills } from './skills.js';
import { registerCommands } from './commands.js';
import { registerPrompt } from './prompt.js';

export const name = '@njau-ca/dsh-njau-core';

export const inject = ['tools', 'skills', 'commands', 'systemPrompt'];

export function apply(ctx, config = {}) {
  const env = createEnv(ctx, config);

  // 顺序有讲究：先立人格与约定，再给能力。
  // 这样即使后面某个服务不可用，模型也已经知道「这是南农计协、数据落在哪、红线是什么」。
  registerPrompt(ctx, env);
  registerTools(ctx, env);
  registerSkills(ctx, env);
  registerCommands(ctx, env);

  const line =
    `[njau-ca] core 已加载｜${env.identity.shortName}｜${env.identity.schoolYear}` +
    `｜数据 ${env.root}` +
    `｜工具 ${env.stats.tools} · 技能 ${env.stats.skills}` +
    ` · 命令 ${env.stats.commands} · 提示词段 ${env.stats.promptSections}`;

  // 同时打到 stdout：桌面端启动日志里能直接看到，排错时最省事。
  ctx.logger?.info?.(line);
  console.log(line);
}

export { DEFAULT_IDENTITY };

export default { name, inject, apply };