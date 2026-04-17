import { DEFAULT_AVATAR } from '@lobechat/const';
import { cssVar } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { isInboxAgentId } from './isInboxAgent';

interface AgentDisplayMeta {
  avatar: string;
  backgroundColor: string;
  title: string;
}

/**
 * Resolves agent display metadata from agent store with sidebar data as fallback.
 * The agent store only contains agents the user has actively visited, so sidebar
 * data (loaded eagerly) fills the gap for agents not yet in the store.
 */
export const useAgentDisplayMeta = (
  agentId: string | null | undefined,
): AgentDisplayMeta | undefined => {
  const { t } = useTranslation(['chat', 'common']);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const meta = useAgentStore((s) =>
    agentId ? agentSelectors.getAgentMetaById(agentId)(s) : undefined,
  );
  const sidebarAgent = useHomeStore(homeAgentListSelectors.getAgentById(agentId ?? ''));

  if (!agentId) return undefined;

  const isInbox = isInboxAgentId(agentId, inboxAgentId);
  const sidebarAvatar = typeof sidebarAgent?.avatar === 'string' ? sidebarAgent.avatar : undefined;

  return {
    avatar: meta?.avatar || sidebarAvatar || (isInbox ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR),
    backgroundColor:
      meta?.backgroundColor || sidebarAgent?.backgroundColor || cssVar.colorBgContainer,
    title:
      meta?.title?.trim() ||
      sidebarAgent?.title ||
      (isInbox ? t('inbox.title', { ns: 'chat' }) : t('defaultSession', { ns: 'common' })),
  };
};
