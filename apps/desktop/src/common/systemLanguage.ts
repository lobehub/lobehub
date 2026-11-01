export const SYSTEM_LANGUAGE_ARG_PREFIX = '--lobe-system-language=';

export const FALLBACK_LOCALE = 'en-US';

const SUPPORTED_LOCALES = [
  'ar',
  'bg-BG',
  'de-DE',
  'en-US',
  'es-ES',
  'fa-IR',
  'fr-FR',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'nl-NL',
  'pl-PL',
  'pt-BR',
  'ru-RU',
  'tr-TR',
  'vi-VN',
  'zh-CN',
  'zh-TW',
];

export const normalizeSystemLanguage = (locale?: string): string => {
  if (!locale) return FALLBACK_LOCALE;

  const lower = locale.toLowerCase().replaceAll('_', '-');

  if (lower.startsWith('ar')) return 'ar';
  if (lower.startsWith('fa')) return 'fa-IR';
  // Traditional-Chinese regions must be matched before the generic `zh` branch
  if (/^zh-(?:hant|tw|hk|mo)/.test(lower)) return 'zh-TW';
  if (lower.startsWith('zh')) return 'zh-CN';

  const exact = SUPPORTED_LOCALES.find((item) => item.toLowerCase() === lower);
  if (exact) return exact;

  const base = lower.split('-')[0];

  return (
    SUPPORTED_LOCALES.find((item) => item.toLowerCase().split('-')[0] === base) ?? FALLBACK_LOCALE
  );
};

export const readSystemLanguageArg = (argv: readonly string[]): string | undefined => {
  const arg = argv.find((item) => item.startsWith(SYSTEM_LANGUAGE_ARG_PREFIX));

  return arg ? arg.slice(SYSTEM_LANGUAGE_ARG_PREFIX.length) || undefined : undefined;
};
