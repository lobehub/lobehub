import { DEFAULT_LANG, LOBE_LOCALE_COOKIE } from '@/const/locale';

import { type Locales, matchLocale, normalizeLocale } from './resources';

const LOCALE_QUERY = 'hl';
const AUTO_LOCALE = 'auto';

const decodeCookieValue = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    // A cookie carrying a malformed percent-escape must not take an SSR render down.
    return value;
  }
};

const readCookie = (cookieHeader: string | null, name: string): string | undefined => {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;

    if (part.slice(0, separatorIndex).trim() !== name) continue;

    return decodeCookieValue(part.slice(separatorIndex + 1).trim());
  }

  return undefined;
};

// Accept-Language is case-insensitive, but the supported list is canonical
// BCP 47 — without this `zh-cn` misses `zh-CN` and silently degrades to English.
const canonicalizeTag = (tag: string) => {
  const [language, ...rest] = tag.split('-');

  return [
    language!.toLowerCase(),
    ...rest.map((part) => (part.length === 2 ? part.toUpperCase() : part)),
  ].join('-');
};

const parseAcceptLanguage = (header: string | null): string[] =>
  (header ?? '')
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const quality = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
      const weight = quality ? Number(quality.slice(2)) : 1;

      return { tag: tag?.trim() ?? '', weight: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((candidate) => candidate.tag.length > 0 && candidate.tag !== '*')
    .sort((a, b) => b.weight - a.weight)
    .map((candidate) => candidate.tag);

// An explicit choice naming no supported locale falls back to the default instead of
// deferring to the browser, matching the lobehub gateway's `resolveOriginPathVars`: a
// request routed through the gateway and one hitting a worker directly must agree.
export const resolveRequestLocale = (request: Request): Locales => {
  const explicit =
    new URL(request.url).searchParams.get(LOCALE_QUERY) ||
    readCookie(request.headers.get('cookie'), LOBE_LOCALE_COOKIE);

  if (explicit && explicit !== AUTO_LOCALE) return normalizeLocale(canonicalizeTag(explicit));

  for (const tag of parseAcceptLanguage(request.headers.get('accept-language'))) {
    const matched = matchLocale(canonicalizeTag(tag));
    if (matched) return matched;
  }

  return DEFAULT_LANG;
};
