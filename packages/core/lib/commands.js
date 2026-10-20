/**
 * commands.js —— 内核斜杠命令。
 *
 * 注册契约（见 @deepseek-ai/dsh-commands README）：
 *   ctx.commands.register({
 *     name,                      必须是小写 ASCII：字母 / 数字 / _ / -
 *     description,               发现界面里显示，这里可以写中文
 *     input: { hint },           可选
 *     handler: ({ agent, rawInput }) => ({ kind:'success'|'error', text })
 *   })
 *
 * ⚠️ 硬约束：命令名只能是小写 ASCII，所以做不到 /计协。
 *    计协的命令统一走 njau- 前缀，描述写中文，用户在命令面板里看到的是中文说明。
 */

import { DOMAINS } from './store.js';

function line(label, value) {
  return `${label}：${value}`;
}

export function registerCommands(ctx, env) {
  const commands = ctx.commands;
  if (commands === undefined || typeof commands.register !== 'function') {
    env.logger?.warn?.('[njau-ca] commands 服务不可用，内核命令未注册');
    return;
  }

  const register = (name, description, handler, input) => {
    try {
      commands.register({
        name,
        description,
        ...(input === undefined ? {} : { input }),
        handler,
      });
      env.stats.commands += 1;
    } catch (error) {
      env.logger?.warn?.(`[njau-ca] 命令注册失败 ${name}：${String(error)}`);
    }
  };

  // /njau —— 协会概览。换届交接时第一个该敲的命令。
  register(
    'njau',
    '显示南农计协概览：协会身份、当前学年、数据目录与生态域清单',
    () => {
      const id = env.identity;
      const text = [
        `${id.fullName}（${id.shortName} / ${id.abbr}）`,
        line('当前学年', id.schoolYear),
        line('数据目录', env.root),
        line('已注册', `工具 ${env.stats.tools} · 技能 ${env.stats.skills} · 命令 ${env.stats.commands}`),
        '',
        '生态业务域：',
        ...DOMAINS.map((d) => `  · ${d.zh}（${d.id}）→ ${d.plugin}`),
      ].join('\n');
      return { kind: 'success', text };
    },
  );

  // /njau-doctor —— 自检。
  register(
    'njau-doctor',
    '计协生态自检：检查数据目录、身份卡与各业务域状态（换届交接、排错时用）',
    () => {
      const text = [
        '计协 DSH 生态自检',
        line('数据根目录', env.root),
        line('协会', `${env.identity.fullName}`),
        line('学年', env.identity.schoolYear),
        line('已注册', `工具 ${env.stats.tools} · 技能 ${env.stats.skills} · 命令 ${env.stats.commands}`),
        '',
        '让 agent 调用 njau_doctor 工具可以获得逐域明细。',
      ].join('\n');
      return { kind: 'success', text };
    },
  );

  // /njau-domains —— 只列域，给“我们到底有哪些能力”这个问题一个短答案。
  register(
    'njau-domains',
    '列出计协生态的全部业务域及其对应插件',
    () => {
      const text = DOMAINS.map((d) => `${d.id.padEnd(11)} ${d.zh.padEnd(8)} ${d.plugin}`).join('\n');
      return { kind: 'success', text };
    },
  );
}