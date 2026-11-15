import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('lazy locale loading', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('starts without the non-active locale and fills it in on demand', async () => {
    const mod = await import('../../src/i18n/index.js');
    await mod.i18nReady;

    const initialLocale = mod.i18n.locale.value;
    const otherLocale = initialLocale === 'zh-CN' ? 'en-US' : 'zh-CN';

    expect(mod.isLocaleLoaded(initialLocale)).toBe(true);
    expect(mod.isLocaleLoaded(otherLocale)).toBe(false);

    // Missing bundles fall back to the default locale instead of leaking keys.
    expect(mod.t('nav.dashboard', {}, otherLocale))
      .toBe(mod.t('nav.dashboard', {}, mod.DEFAULT_LOCALE));

    await mod.loadLocaleMessages(otherLocale);
    expect(mod.isLocaleLoaded(otherLocale)).toBe(true);
    expect(mod.t('nav.dashboard', {}, 'en-US')).toBe('Dashboard');
    expect(mod.t('nav.dashboard', {}, 'zh-CN')).toBe('仪表盘');
  });

  it('loads the newly selected locale before it becomes available', async () => {
    const mod = await import('../../src/i18n/index.js');
    await mod.i18nReady;

    const target = mod.i18n.locale.value === 'zh-CN' ? 'en-US' : 'zh-CN';
    expect(mod.isLocaleLoaded(target)).toBe(false);

    await mod.setLocale(target);

    expect(mod.i18n.locale.value).toBe(target);
    expect(mod.isLocaleLoaded(target)).toBe(true);
  });
});
