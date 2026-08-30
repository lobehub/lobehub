import { DEFAULT_AVATAR } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { cssVar } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

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
  const groupBySupervisorId = useAgentGroupStore((s) =>
    agentId
      ? Object.values(s.groupMap).find(
          (group) => group.supervisorAgentId === agentId && !!group.avatar,
        )
      : undefined,
  );
  const sidebarAgent = useHomeStore(homeAgentListSelectors.getAgentById(agentId ?? ''));

  if (!agentId) return undefined;

  const isInbox = isInboxAgentId(agentId, inboxAgentId);
  const sidebarAvatar = typeof sidebarAgent?.avatar === 'string' ? sidebarAgent.avatar : undefined;
  const hasResolvedMeta =
    isInbox ||
    !!groupBySupervisorId?.avatar ||
    !!meta?.avatar ||
    !!meta?.backgroundColor ||
    !!agentDisplayName(meta) ||
    !!sidebarAgent;

  if (!fallbackToDefault && !hasResolvedMeta) return undefined;

  return {
    avatar:
      groupBySupervisorId?.avatar ||
      meta?.avatar ||
      sidebarAvatar ||
      (isInbox ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR),
    backgroundColor:
      groupBySupervisorId?.backgroundColor ||
      meta?.backgroundColor ||
      sidebarAgent?.backgroundColor ||
      cssVar.colorBgContainer,
    title:
      groupBySupervisorId?.title ||
      agentDisplayName(meta) ||
      agentDisplayName(sidebarAgent) ||
      (isInbox ? t('inbox.title', { ns: 'chat' }) : t('defaultSession', { ns: 'common' })),
  };
};
