/**
 * prompt.js -- 把「这是南农计协的 DSH」写进系统提示词。
 *
 * 服务：ctx.systemPrompt（@deepseek-ai/dsh-system-prompt，dsh-base 已挂载）。
 *   ctx.systemPrompt.section({ name, order, text }) => disposer
 *   段落名同一层内唯一（重复注册抛错）；order 升序，并列按 name 排序。
 *   官方参考带：PERSONA_PREFIX 0 / PLAN_POLICY 500 / TEAM_POLICY 600 /
 *   PTC_ONLY 800 / FILE_REFERENCE 900 / TOOL_* 1000+。协会惯例取 650。
 *
 * 为什么不改 dsh-persona：
 *   1. dsh-persona 不支持全局挂载（其 README 列为已知限制）；
 *   2. deployment:persona-prefix 由 system-prompt 自己注册，第二个插件
 *      注册同名段落会直接抛错；
 *   3. systemPrompt.section 是插件自己的一层，可随插件装卸，符合「一切皆插件」。
 *      唯一约束是段落名不能撞车，所以用了 njau-ca: 前缀。
 */

function sectionText(env) {
  const id = env.identity;
  return [
    '你正在为「' + id.fullName + '」（简称' + id.shortName + '，' + id.abbr + '）工作。',
    '当前学年：' + id.schoolYear + '。',
    '',
    '这是一套由协会自己维护的 DSH 生态。处理协会事务时遵守以下约定：',
    '',
    '1. 先查再答：涉及协会事实（成员、经费、活动、制度）时，先用 njau_* 工具查数据，不要凭印象回答。',
    '2. 数据落盘有固定位置：协会资料一律写到协会数据目录（njau_data_write / njau_data_append），',
    '   不要写进工作区的临时文件 —— 临时文件不会进归档，下学期就找不到。',
    '3. 按学年组织：所有记录按「学年/日期-主题」命名，日期用 YYYY-MM-DD。',
    '4. 做事走四步：立项 → 留痕 → 复盘 → 归档。没有立项的事不要动用协会资源。',
    '5. 交接优先：任何产出都要假设「两年后会有一个不认识你的人来看它」。',
    '   写清楚谁做的、为什么这么做、下一步该做什么。',
    '',
    '四条红线（碰到就停下来问人，不要自行推定可以）：',
    '· 不得盗用学校、学院或他方名义；对外材料涉及校方名义须先取得同意。',
    '· 不得利用协会名义为个人或关联企业输送利益；涉及关联方须回避并留痕。',
    '· 新媒体账号的数量、报备状态、历史内容都是考核项；开号、改用途、发通稿前先自查。',
    '· 协会若处于整改期，整改期内不得开展与整改无关的工作。',
    '',
    '默认用中文回答。涉及协会对外材料时，语气务实、不喊口号、不夸大成绩。',
  ].join('\n');
}

export function registerPrompt(ctx, env) {
  const sp = ctx.systemPrompt;
  if (sp === undefined || typeof sp.section !== 'function') {
    env.logger?.warn?.('[njau-ca] systemPrompt 服务不可用，协会惯例未注入系统提示词');
    return;
  }
  try {
    const disposer = sp.section({ name: 'njau-ca:identity', order: 650, text: sectionText(env) });
    if (typeof disposer === 'function') ctx.effect(() => disposer, '[njau-ca] systemPrompt section');
    env.stats.promptSections = (env.stats.promptSections ?? 0) + 1;
  } catch (error) {
    env.logger?.warn?.('[njau-ca] 系统提示词段落注册失败：' + String(error));
  }
}
