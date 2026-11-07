import { resolveRequestLocale as resolveWithVocabulary } from '@lobehub/edge-contract/request-locale';

import { DEFAULT_LANG } from '@/const/locale';

import { type Locales, locales } from './resources';

// Shared with the lobehub gateway, so a request routed through it and one hitting a worker
// directly pick the same locale.
export const resolveRequestLocale = (request: Request): Locales =>
  resolveWithVocabulary(request, { fallback: DEFAULT_LANG as Locales, tags: locales });
