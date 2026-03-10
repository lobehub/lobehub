import { t } from 'i18next';

import { DEFAULT_AVATAR } from '@/const/meta';
import { type SessionStore } from '@/store/session';
import { type MetaData } from '@/types/meta';
import { merge } from '@/utils/merge';

import { sessionSelectors } from './list';

// ==========   Meta   ============== //

/**
 * Get group chat meta data
 * Note: For agent-related meta, use agentSelectors from @/store/agent/selectors instead
 */
const currentGroupMeta = (s: SessionStore): MetaData => {
  const defaultMeta = {
    description: t('group.desc', { ns: 'chat' }),
    title: t('group.title', { ns: 'chat' }),
  };

  const session = sessionSelectors.currentSession(s);

  return merge(defaultMeta, session?.meta);
};

const getAvatar = (s: MetaData) => s.avatar || DEFAULT_AVATAR;
const getTitle = (s: MetaData) => s.title || t('defaultSession', { ns: 'common' });
// New session do not show 'noDescription'
export const getDescription = (s: MetaData) => s.description;

export const sessionMetaSelectors = {
  currentGroupMeta,
  getAvatar,
  getDescription,
  getTitle,
};
