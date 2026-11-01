import defaultAuth from '@/locales/default/auth';
import defaultAuthError from '@/locales/default/authError';
import defaultCommon from '@/locales/default/common';
import defaultError from '@/locales/default/error';
import defaultMarketAuth from '@/locales/default/marketAuth';
import defaultOauth from '@/locales/default/oauth';

import { DEFAULT_PRERENDER_LOCALE, resolveDocumentLocale } from '../lib/prerender';
import type { AuthNamespace, AuthResourceBundle } from './i18nScript';

// Prerender-only: `vite.config.shared.mts` swaps this module for the `.client`
// twin, so no dictionary enters the browser bundle — each document carries just
// its own locale, inlined by `root.tsx`.
const translated = import.meta.glob<{ default: Record<string, string> }>(
  '../../../../locales/*/{auth,authError,common,error,marketAuth,oauth}.json',
  { eager: true },
);

const BUNDLES: Record<string, Partial<AuthResourceBundle>> = {};

for (const [file, module] of Object.entries(translated)) {
  const match = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(file);
  if (!match) continue;

  const [, locale, namespace] = match;
  (BUNDLES[locale!] ??= {})[namespace as AuthNamespace] = module.default;
}

// English comes from the typed source the other locales are generated from, so
// a key added there is never missing here while the mirror catches up.
BUNDLES[DEFAULT_PRERENDER_LOCALE] = {
  auth: defaultAuth,
  authError: defaultAuthError,
  common: defaultCommon,
  error: defaultError,
  marketAuth: defaultMarketAuth,
  oauth: defaultOauth,
};

export const readAuthResources = (locale: string): AuthResourceBundle =>
  BUNDLES[resolveDocumentLocale(locale)] as AuthResourceBundle;

export const serializeAuthResources = (locale: string): string =>
  // `<` must not appear raw inside a script element; `\u003c` is still valid JSON.
  JSON.stringify(readAuthResources(locale)).replaceAll('<', String.raw`\u003c`);
