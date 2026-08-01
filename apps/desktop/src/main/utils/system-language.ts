import { app } from 'electron';

import { normalizeSystemLanguage } from '~common/systemLanguage';

/**
 * `app.getLocale()` resolves against the locales bundled with the app, so a
 * packaging step that prunes them (see `electronLanguages`) makes it — and the
 * renderer's `navigator.language` — report English on a non-English system.
 * `getPreferredSystemLanguages()` reads the OS setting directly and survives.
 */
export const getSystemLanguage = (): string =>
  normalizeSystemLanguage(app.getPreferredSystemLanguages()[0] || app.getLocale());

export const resolveUILocale = (storedLocale?: string): string =>
  !storedLocale || storedLocale === 'auto' ? getSystemLanguage() : storedLocale;
