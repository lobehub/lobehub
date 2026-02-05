import { DEFAULT_LANG } from '@/const/locale';
import type {Locales} from '@/locales/resources';
import { isOnServerSide } from '@/utils/env';

import type {GlobalState} from '../initialState';
import { systemStatus } from './systemStatus';

const language = (s: GlobalState) => systemStatus(s).language || 'auto';

const currentLanguage = (s: GlobalState) => {
  const locale = language(s);

  if (locale === 'auto') {
    if (isOnServerSide) return DEFAULT_LANG;

    return navigator.language as Locales;
  }

  return locale as Locales;
};

export const globalGeneralSelectors = {
  currentLanguage,
  language,
};
