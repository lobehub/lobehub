import { t } from 'i18next';

import { type MetaData } from '@/types/meta';

const getTitle = (s: MetaData) => s.title || t('defaultSession', { ns: 'common' });

export const sessionMetaSelectors = {
  getTitle,
};
