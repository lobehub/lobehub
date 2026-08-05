/**
 * On desktop, `navigator.language` reports English regardless of the OS setting
 * because packaging prunes the locales Chromium resolves its app locale from.
 * The main process reads the OS language directly and hands it to the preload.
 */
export const getSystemLanguage = (): string =>
  (typeof window !== 'undefined' && window.lobeEnv?.systemLanguage) || navigator.language;
