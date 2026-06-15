// dayjs registers some locales under shorter keys than the i18next language code
// (e.g. `en` for `en-US`, `zh-cn` for `zh`). Keep the alias map alongside the
// loader logic in `SPAGlobalProvider/Locale.tsx` so reads and writes stay in sync.
const DAYJS_LOCALE_ALIASES: Record<string, string> = {
  'en-us': 'en',
  'zh': 'zh-cn',
};

interface DayjsLocaleModule {
  default: ILocale;
}

type DayjsLocaleLoader = () => DayjsLocaleModule | Promise<DayjsLocaleModule>;

export type DayjsLocaleGlobEntry = DayjsLocaleLoader | DayjsLocaleModule;

export const loadDayjsLocaleModule = async (
  entry: DayjsLocaleGlobEntry,
): Promise<DayjsLocaleModule> => (typeof entry === 'function' ? entry() : entry);

export const normalizeDayjsLocale = (lang: string): string => {
  const lower = lang.toLowerCase();
  if (lower.startsWith('zh-hans')) return 'zh-cn';
  if (lower.startsWith('zh-hant')) return 'zh-tw';

  return DAYJS_LOCALE_ALIASES[lower] ?? lower;
};
