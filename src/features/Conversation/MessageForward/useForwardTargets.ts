import { agentDisplayName, type SidebarAgentItem } from '@lobechat/types';
import { useMemo, useState } from 'react';

import type { ForwardTarget } from '@/store/chat/slices/forward/action';

/** The candidate labels and submitted labels come from the same options. */
export const useForwardTargets = (agents: SidebarAgentItem[], sourceAgentId?: string) => {
  const [keyword, setKeyword] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const options = useMemo(
    () =>
      agents
        .filter((agent) => agent.type === 'agent' && agent.id !== sourceAgentId)
        .map((agent) => ({
          avatar: agent.avatar,
          backgroundColor: agent.backgroundColor,
          id: agent.id,
          label: agentDisplayName(agent),
        })),
    [agents, sourceAgentId],
  );
  const query = keyword.trim().toLowerCase();
  const candidates = options.filter(
    (agent) => !query || (agent.label ?? '').toLowerCase().includes(query),
  );
  const targets: ForwardTarget[] = selectedIds.flatMap((id) => {
    const agent = options.find((option) => option.id === id);
    return agent ? [{ id, title: agent.label }] : [];
  });
  const toggle = (id: string) =>
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((selected) => selected !== id) : [...ids, id],
    );

  return { candidates, keyword, selectedIds, setKeyword, targets, toggle };
};
