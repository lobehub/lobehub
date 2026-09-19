import { agentDisplayName } from '@lobechat/types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

export const directoryAgentName = (
  agent: { name?: string | null; title?: string | null } | undefined,
  isInbox: boolean,
  inboxName: string,
) => agentDisplayName(agent) ?? (isInbox ? inboxName : undefined);

export const useDirectoryAgent = (coordinatorAgentId: string) => {
  const [agentId, setAgentId] = useState(coordinatorAgentId);
  const { t } = useTranslation('chat');
  const inboxId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const listName = useHomeStore((s) =>
    agentDisplayName(homeAgentListSelectors.getAgentById(agentId)(s)),
  );
  const agentName = listName ?? (agentId === inboxId ? t('inbox.title') : undefined);

  return { agentId, agentName, setAgentId };
};
