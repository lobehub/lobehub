// dayjs registers some locales under shorter keys than the i18next language code
// (e.g. `en` for `en-US`). Keep the alias map alongside the
// loader logic in `SPAGlobalProvider/Locale.tsx` so reads and writes stay in sync.
const DAYJS_LOCALE_ALIASES: Record<string, string> = {
  'en-us': 'en',
  'te-in': 'en',
};

export const normalizeDayjsLocale = (lang: string): string => {
  const lower = lang.toLowerCase();
  return DAYJS_LOCALE_ALIASES[lower] ?? lower;
};
