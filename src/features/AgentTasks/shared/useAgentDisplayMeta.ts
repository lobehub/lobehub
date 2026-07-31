import { DEFAULT_AVATAR } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { cssVar } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { useHomeAgentIdentity } from '@/client-data';
import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';

import { isInboxAgentId } from './isInboxAgent';

interface AgentDisplayMeta {
  avatar: string;
  backgroundColor: string;
  title: string;
}

interface UseAgentDisplayMetaOptions {
  fallbackToDefault?: boolean;
}

/**
 * Resolves agent display metadata from agent store with sidebar data as fallback.
 * The agent store only contains agents the user has actively visited, so sidebar
 * data (loaded eagerly) fills the gap for agents not yet in the store.
 */
export const useAgentDisplayMeta = (
  agentId: string | null | undefined,
  { fallbackToDefault = true }: UseAgentDisplayMetaOptions = {},
): AgentDisplayMeta | undefined => {
  const { t } = useTranslation(['chat', 'common']);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const meta = useAgentStore((s) =>
    agentId ? agentSelectors.getAgentMetaById(agentId)(s) : undefined,
  );
  const entityAgent = useHomeAgentIdentity(agentId ?? undefined);

  if (!agentId) return undefined;

  const isInbox = isInboxAgentId(agentId, inboxAgentId);
  const sidebarAvatar = typeof entityAgent?.avatar === 'string' ? entityAgent.avatar : undefined;
  const hasResolvedMeta =
    isInbox ||
    !!meta?.avatar ||
    !!meta?.backgroundColor ||
    !!agentDisplayName(meta) ||
    !!entityAgent;

  if (!fallbackToDefault && !hasResolvedMeta) return undefined;

  return {
    avatar: meta?.avatar || sidebarAvatar || (isInbox ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR),
    backgroundColor:
      meta?.backgroundColor || entityAgent?.backgroundColor || cssVar.colorBgContainer,
    title:
      agentDisplayName(meta) ||
      agentDisplayName(entityAgent) ||
      (isInbox ? t('inbox.title', { ns: 'chat' }) : t('defaultSession', { ns: 'common' })),
  };
};
