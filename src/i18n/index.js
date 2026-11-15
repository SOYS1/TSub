import { computed, inject, readonly, ref, shallowReactive } from 'vue';

export const DEFAULT_LOCALE = 'zh-CN';
export const LOCALE_STORAGE_KEY = 'tsub:locale';
export const SUPPORTED_LOCALES = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en-US', label: 'English' }
];

const supportedCodes = new Set(SUPPORTED_LOCALES.map((item) => item.code));
const I18N_KEY = Symbol('tsub-i18n');

/**
 * Locale bundles are code-split so the entry chunk only carries the active
 * language. The loaders are lazy `import()` calls, which Vite turns into
 * separate chunks fetched on demand.
 */
const localeLoaders = {
  'zh-CN': () => import('./locales/zh-CN.js'),
  'en-US': () => import('./locales/en-US.js')
};

// shallowReactive keeps the bundles themselves untouched while letting Vue
// re-render templates once a lazily loaded locale lands.
const loadedMessages = shallowReactive({});
const localeLoadPromises = new Map();

function canUseLocalStorage() {
  return typeof localStorage !== 'undefined';
}

function readStoredLocale() {
  if (!canUseLocalStorage()) return '';
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function writeStoredLocale(locale) {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage failures in private/incognito contexts.
  }
}

export function normalizeLocale(locale) {
  if (!locale || typeof locale !== 'string') return DEFAULT_LOCALE;
  if (supportedCodes.has(locale)) return locale;
  const lower = locale.toLowerCase();
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('en')) return 'en-US';
  return DEFAULT_LOCALE;
}

export function detectInitialLocale(browserLanguages = []) {
  const stored = readStoredLocale();
  if (supportedCodes.has(stored)) return stored;

  const candidates = Array.isArray(browserLanguages) && browserLanguages.length > 0
    ? browserLanguages
    : (typeof navigator !== 'undefined' ? [navigator.language, ...(navigator.languages || [])] : []);

  for (const candidate of candidates) {
    const normalized = normalizeLocale(candidate);
    if (supportedCodes.has(normalized) && normalized !== DEFAULT_LOCALE) return normalized;
  }

  return DEFAULT_LOCALE;
}

function extractMessages(module) {
  return module?.default ?? module?.messages ?? {};
}

/**
 * Load (and memoize) a locale bundle. Safe to call repeatedly: concurrent
 * callers share the same in-flight promise.
 */
export function loadLocaleMessages(locale) {
  const normalized = normalizeLocale(locale);
  if (loadedMessages[normalized]) return Promise.resolve(loadedMessages[normalized]);

  const inFlight = localeLoadPromises.get(normalized);
  if (inFlight) return inFlight;

  const loader = localeLoaders[normalized];
  if (!loader) return Promise.resolve({});

  const promise = loader()
    .then((module) => {
      const bundle = extractMessages(module);
      loadedMessages[normalized] = bundle;
      return bundle;
    })
    .catch((error) => {
      // Allow a later attempt to retry instead of caching the failure forever.
      localeLoadPromises.delete(normalized);
      console.warn(`[i18n] Failed to load locale "${normalized}"`, error);
      return {};
    });

  localeLoadPromises.set(normalized, promise);
  return promise;
}

export function isLocaleLoaded(locale) {
  return Boolean(loadedMessages[normalizeLocale(locale)]);
}

function lookupMessage(locale, key) {
  const bundle = loadedMessages[locale];
  if (!bundle) return undefined;
  return key.split('.').reduce((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[part];
  }, bundle);
}

function interpolate(template, params = {}) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}

export function createI18n(options = {}) {
  const initialLocale = normalizeLocale(options.initialLocale || detectInitialLocale());
  const locale = ref(initialLocale);

  // Begin fetching immediately; `ready()` lets bootstrap await the first paint.
  const ready = () => loadLocaleMessages(locale.value);

  const translate = (key, params = {}, forcedLocale) => {
    const targetLocale = normalizeLocale(forcedLocale || locale.value);
    const resolved = lookupMessage(targetLocale, key) ?? lookupMessage(DEFAULT_LOCALE, key);
    return resolved === undefined ? key : interpolate(resolved, params);
  };

  const applyLocale = (normalized) => {
    locale.value = normalized;
    writeStoredLocale(normalized);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = normalized;
    }
  };

  const set = (nextLocale) => {
    const normalized = normalizeLocale(nextLocale);
    // Switch immediately so the UI reacts, then fill in the bundle when the
    // dynamic import resolves (shallowReactive triggers the re-render).
    applyLocale(normalized);
    return loadLocaleMessages(normalized);
  };

  const instance = {
    locale,
    supportedLocales: SUPPORTED_LOCALES,
    t: translate,
    setLocale: set,
    ready,
    install(app) {
      app.provide(I18N_KEY, instance);
      app.config.globalProperties.$t = translate;
      app.config.globalProperties.$locale = readonly(locale);
      if (typeof document !== 'undefined') {
        document.documentElement.lang = locale.value;
      }
    }
  };

  loadLocaleMessages(initialLocale);

  return instance;
}

export const i18n = createI18n();

/** Resolves once the initially detected locale is available. */
export const i18nReady = i18n.ready();

export function t(key, params = {}, forcedLocale) {
  return i18n.t(key, params, forcedLocale);
}

export function setLocale(locale) {
  return i18n.setLocale(locale);
}

export function useI18n() {
  const instance = inject(I18N_KEY, i18n);
  return {
    locale: instance.locale,
    supportedLocales: instance.supportedLocales,
    t: instance.t,
    setLocale: instance.setLocale,
    currentLocaleLabel: computed(() => SUPPORTED_LOCALES.find((item) => item.code === instance.locale.value)?.label || instance.locale.value)
  };
}
