import { t } from 'i18next';

import { DEFAULT_AVATAR } from '@/const/meta';
import { type MetaData } from '@/types/meta';

const getAvatar = (s: MetaData) => s.avatar || DEFAULT_AVATAR;
const getTitle = (s: MetaData) => s.title || t('defaultSession', { ns: 'common' });

export const sessionMetaSelectors = {
  getAvatar,
  getTitle,
};
