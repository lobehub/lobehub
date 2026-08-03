// dayjs registers some locales under shorter keys than the i18next language code
// (e.g. `en` for `en-US`, `zh-cn` for `zh`). Keep the alias map alongside the
// loader logic in `SPAGlobalProvider/Locale.tsx` so reads and writes stay in sync.
const DAYJS_LOCALE_ALIASES: Record<string, string> = {
  'en-us': 'en',
  'zh': 'zh-cn',
  'zh-cn': 'zh-cn',
  'zh-tw': 'zh-tw',
  // dayjs ships `pt-br` (not `pt`) — must not be stripped to the language tag
  'pt-br': 'pt-br',
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

  const aliased = DAYJS_LOCALE_ALIASES[lower];
  if (aliased) return aliased;

  // App locales are usually BCP-47 with a region (`fa-IR`, `de-DE`, `ja-JP`),
  // while dayjs mostly registers language-only ids (`fa`, `de`, `ja`). Without
  // this strip, loaders miss and relativeTime falls back to English
  // ("a few seconds ago ذخیره شد").
  if (lower.startsWith('pt-br')) return 'pt-br';

  const [language] = lower.split('-');
  return language || lower;
};
