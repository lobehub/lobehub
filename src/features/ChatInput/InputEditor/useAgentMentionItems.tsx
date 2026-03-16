import { Avatar } from '@lobehub/ui';
import { useMemo } from 'react';

import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { useAgentId } from '../hooks/useAgentId';

const MAX_AGENT_ITEMS = 20;

export const useAgentMentionItems = () => {
  const allAgents = useHomeStore(homeAgentListSelectors.allAgents);
  const currentAgentId = useAgentId();

  return useMemo(() => {
    const otherAgents = allAgents.filter((a) => a.type === 'agent' && a.id !== currentAgentId);

    if (otherAgents.length === 0) return [];

    return otherAgents.slice(0, MAX_AGENT_ITEMS).map((agent) => ({
      icon: (
        <Avatar
          avatar={typeof agent.avatar === 'string' ? agent.avatar : undefined}
          background={agent.backgroundColor ?? undefined}
          size={24}
        />
      ),
      key: `agent-${agent.id}`,
      label: agent.title || 'Untitled Agent',
      metadata: { id: agent.id, type: 'agent' },
    }));
  }, [allAgents, currentAgentId]);
};
