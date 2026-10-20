// 浏览器侧：占 sidebar.brand.mark / sidebar.brand.name 两个 slot。
//
// 占 slot 是 DSH 唯一的品牌组合路径 —— 不存在品牌配置面，占住 slot 就是品牌。
// 官方占位者（dsh-client-ui-brand-official）以默认 priority 0 注册，
// 本插件用 priority -1 注册；entriesOfSlot 按 priority 升序取第一个，
// 因此本插件胜出，且不会抛错（single slot 只在 priority 相同时才抛）。
//
// 包格式由 dsh-client-modules 规定：window.__ModuleLoader__.load({ id, factory })，
// factory(require) 直接 return 出模块的 { inject, apply }。
window.__ModuleLoader__.load({
  id: '@njau-ca/dsh-njau-brand',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const BRAND_TOKENS = {
      '--dsw-alias-brand-primary': { light: '#0B5FFF', dark: '#4D93F8' },
    };

    // 协会标识：圆角方块 + 三角（取自「计」的构成感）。
    // 刻意不画校徽、不写学校全称，避免被误认为学校官方。
    function NjauBrandMark() {
      return h('svg', {
        viewBox: '0 0 32 32',
        width: 24,
        height: 24,
        'aria-hidden': true,
        style: { display: 'block', flex: '0 0 auto' },
      },
        h('rect', { x: 1, y: 1, width: 30, height: 30, rx: 8, fill: '#0B5FFF' }),
        h('path', { d: 'M9 22.5 L16 8.5 L23 22.5 Z', fill: '#ffffff' }),
      );
    }

    function NjauBrandName() {
      return h('span', {
        'data-njau-ca-brand-name': '',
        style: { fontWeight: 600, letterSpacing: '0.02em', whiteSpace: 'nowrap' },
      }, '南农计协');
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // theme 是可选的：没有主题服务也不该拖垮品牌占位。
        ctx.inject(['theme'], (themed) => {
          themed.effect(
            () => themed.theme.overrideTokens('@njau-ca/dsh-njau-brand', BRAND_TOKENS),
            'njau-ca: brand tokens',
          );
        });

        ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
          name: 'sidebar.brand.mark',
          id: 'njau-ca',
          priority: -1,
        }, NjauBrandMark));

        ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
          name: 'sidebar.brand.name',
          id: 'njau-ca',
          priority: -1,
        }, NjauBrandName));
      },
    };
  },
});