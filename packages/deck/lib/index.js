/**
 * index.js —— deck 插件入口。
 *
 * 南农计协 · 演示文稿。给 DSH 装上「计协自己的 PPT 知识」：
 * 标准演示模板、大纲存取、交给 office-pptx 的渲染简报。
 *
 * 铁律 1：不调用任何其它插件，core 不在也能跑。
 * 铁律 2：零运行时依赖，只 import node: 内置模块和本包自己的文件。
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listOutlines, listTemplates } from './deck.js';
import { createEnv } from './env.js';
import { registerSkills } from './skills.js';
import { registerTools } from './tools.js';

export const name = '@njau-ca/dsh-njau-deck';

// tools / skills 任一不可用就不加载 —— 交给 DSH 自己决定什么时候叫我们。
export const inject = ['tools', 'skills'];

export function apply(ctx, config = {}) {
  const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const env = createEnv(ctx, config, pkgDir);

  registerTools(ctx, env);
  registerSkills(ctx, env);

  const templates = listTemplates(env).length;
  const outlines = listOutlines(env).length;
  console.log(
    '[njau-ca] deck 已加载｜模板 ' + templates + ' 个｜大纲 ' + outlines + ' 个｜目录 ' +
    env.deckRoot + '｜工具 ' + env.stats.tools + ' · 技能 ' + env.stats.skills,
  );
}

export default { name, inject, apply };