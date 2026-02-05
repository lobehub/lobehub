import type { LobeAgentSession, LobeGroupSession } from '@lobechat/types';
import { LobeSessionType } from '@lobechat/types';

import { DEFAULT_AGENT_META, DEFAULT_INBOX_AVATAR } from './meta';
import { DEFAULT_AGENT_CONFIG } from './settings';
import { merge } from './utils/merge';

export const INBOX_SESSION_ID = 'inbox';

export const WELCOME_GUIDE_CHAT_ID = 'welcome';

export const DEFAULT_AGENT_LOBE_SESSION: LobeAgentSession = {
  config: DEFAULT_AGENT_CONFIG,
  createdAt: new Date(),
  id: '',
  meta: DEFAULT_AGENT_META,
  model: DEFAULT_AGENT_CONFIG.model,
  type: LobeSessionType.Agent,
  updatedAt: new Date(),
};

export const DEFAULT_GROUP_LOBE_SESSION: LobeGroupSession = {
  createdAt: new Date(),
  id: '',
  members: [],
  meta: DEFAULT_AGENT_META,
  type: LobeSessionType.Group,
  updatedAt: new Date(),
};

export const DEFAULT_INBOX_SESSION: LobeAgentSession = merge(DEFAULT_AGENT_LOBE_SESSION, {
  id: 'inbox',
  meta: {
    avatar: DEFAULT_INBOX_AVATAR,
  },
});
