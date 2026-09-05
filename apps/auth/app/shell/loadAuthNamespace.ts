import { normalizeLocale } from '@/locales/resources';

import { DEFAULT_PRERENDER_LOCALE } from '../lib/prerender';

// Only the served locale ships inside the document; the language switcher offers
// all of them, so every other dictionary is fetched on demand. Lazy on purpose —
// these become their own chunks and never touch the first-load path.
const translated = import.meta.glob<{ default: Record<string, string> }>(
  '../../../../locales/*/{auth,authError,common,error,marketAuth,oauth}.json',
);

const defaults = import.meta.glob<{ default: Record<string, string> }>(
  '../../../../packages/locales/src/default/{auth,authError,common,error,marketAuth,oauth}.ts',
);

const entry = <T>(map: Record<string, () => Promise<T>>, suffix: string) =>
  Object.entries(map).find(([file]) => file.endsWith(suffix))?.[1];

export const loadAuthNamespace = async (lng: string, namespace: string) => {
  const locale = normalizeLocale(lng);
  const load =
    locale === DEFAULT_PRERENDER_LOCALE
      ? entry(defaults, `/default/${namespace}.ts`)
      : entry(translated, `/${locale}/${namespace}.json`);

  return (await load?.())?.default;
};
