import { loadLocaleMessages } from '../../src/i18n/index.js';

// Locale bundles are dynamically imported in the app. Unit tests mount
// components synchronously and assert on translated text, so preload every
// supported bundle once per test file.
await Promise.all([
  loadLocaleMessages('zh-CN'),
  loadLocaleMessages('en-US')
]);
