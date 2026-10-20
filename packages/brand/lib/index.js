/**
 * index.js —— @njau-ca/dsh-njau-brand 宿主侧（Node）。
 *
 * 职责只有两件：
 *   1. 立协会人设：往系统提示词里加一段。段名必须自取（njau-ca:brand），
 *      因为 @deepseek-ai/dsh-persona 占用的 deployment:persona-* 段名同层重复注册会抛。
 *   2. 品牌化 Web 界面：通过 webserver/index-inject 注入 <style> 与 <script>，
 *      设定主题色与窗口标题。
 *
 * 界面上的「侧栏标识 / 侧栏名称」由同包的 lib/client.js（浏览器侧）占 slot 完成 ——
 * 占 slot 是 DSH 唯一的品牌组合路径，不存在品牌配置面。
 *
 * 零运行时依赖：只用本文件内的常量，不 import 任何 @deepseek-ai/* 运行时包，
 * 因此 DSH 升级不会因为 peer 版本声明不匹配而拒载。
 */

const BRAND_TITLE = '南农计协 · DSH';

// --dsw-alias-brand-primary 是 DSH 的品牌主色令牌。
// 同一组色值给两处用：这里的 CSS 变量，以及浏览器侧的 theme.overrideTokens。
const BRAND_PRIMARY_LIGHT = '#0B5FFF';
const BRAND_PRIMARY_DARK = '#4D93F8';

const BRAND_CSS = [
  ':root{',
  '  --njau-ca-brand-primary: ' + BRAND_PRIMARY_LIGHT + ';',
  '}',
  '@media (prefers-color-scheme: dark){',
  '  :root{',
  '    --njau-ca-brand-primary: ' + BRAND_PRIMARY_DARK + ';',
  '  }',
  '}',
  '/* 侧栏品牌名比默认文本更长，收一点字距避免换行 */',
  '[data-njau-ca-brand-name]{',
  '  font-weight: 600;',
  '  letter-spacing: 0.02em;',
  '}',
].join('\n');

const BRAND_SCRIPT = [
  '(function(){',
  '  try {',
  '    document.title = ' + JSON.stringify(BRAND_TITLE) + ';',
  '  } catch (error) { /* 标题设不上不影响使用 */ }',
  '})();',
].join('\n');

const PERSONA = [
  '# 你是谁',
  '你是「南农计协」自己的 DSH —— 南京农业大学计算机爱好者协会的协会操作系统。',
  '你不是通用助手，你是这个协会的学长学姐：懂协会的业务流，认得协会的文件，知道红线在哪。',
  '',
  '## 说话方式',
  '- 直接、务实。能一句话说完就别写三段。',
  '- 先给结论，再给依据。不确定就说不确定，别编。',
  '- 面向在校学生：术语要解释，命令要给例子。',
  '',
  '## 做事方式',
  '- 先查再答：协会的事优先看数据目录与知识库，不要凭印象。',
  '- 数据落文件：协会的台账一律写进数据目录，不要只留在对话里。',
  '- 按学年组织：跨届协作按 <学年>/ 归档，方便交接。',
  '- 交接优先：凡是「以后还会再用」的东西，都要留下下一届读得懂的文件。',
  '',
  '## 红线（不可越）',
  '- 学生社团不能签商业合同、不能收款。',
  '- 不冒充学校官方，不滥用协会名义。',
  '- 不把内部敏感材料（整改、关联方、举报）写进仓库或对外文档。',
  '- 不替学校系统做自动登录、刷接口或模拟点击。',
].join('\n');

export const name = '@njau-ca/dsh-njau-brand';

export const inject = ['systemPrompt'];

export function apply(ctx, config = {}) {
  // 1) 人设：段名 njau-ca:brand 与 core 的 njau-ca:identity 并存不冲突。
  if (typeof ctx.systemPrompt?.section === 'function') {
    ctx.effect(
      () => ctx.systemPrompt.section({
        name: 'njau-ca:brand',
        order: 651,
        text: PERSONA,
      }),
      'njau-ca: brand persona',
    );
  }

  // 2) Web 品牌：可选注入 —— 没有 webServer（纯 CLI 场景）时插件照样能加载。
  ctx.inject(['webServer'], (web) => {
    web.on('webserver/index-inject', (table) => {
      table.push({ kind: 'style', text: BRAND_CSS });
      table.push({ kind: 'script', placement: 'head', text: BRAND_SCRIPT });
    });
    console.log('[njau-ca] brand 已接管 Web 品牌：窗口标题 + 主题色（侧栏标识由浏览器侧占 slot 完成）');
  });
}

export default { name, inject, apply };