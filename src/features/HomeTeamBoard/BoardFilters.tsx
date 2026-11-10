import type { AgentRunBoardFilterOptions } from '@lobechat/types';
import { Flexbox, Select } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useWorkspaceMemberProfiles } from '@/business/client/hooks/useWorkspaceMemberProfiles';

const ALL = 'all';
const SELECT_STYLE = { width: 180 };

interface BoardFiltersProps {
  agentId?: string;
  onAgentChange: (agentId?: string) => void;
  onUserChange: (userId?: string) => void;
  options: AgentRunBoardFilterOptions;
  userId?: string;
}

const BoardFilters = ({
  agentId,
  onAgentChange,
  onUserChange,
  options,
  userId,
}: BoardFiltersProps) => {
  const { t } = useTranslation('home');
  const profiles = useWorkspaceMemberProfiles();

  return (
    <Flexbox horizontal data-testid={'team-board-filters'} gap={8} wrap={'wrap'}>
      <Select
        size={'small'}
        style={SELECT_STYLE}
        value={agentId ?? ALL}
        options={[
          { label: t('team.filter.allAgents'), value: ALL },
          ...options.agents.map((agent) => ({
            label: agent.title || t('team.agent.untitled'),
            value: agent.id,
          })),
        ]}
        onChange={(value) => onAgentChange(value === ALL ? undefined : String(value))}
      />
      <Select
        size={'small'}
        style={SELECT_STYLE}
        value={userId ?? ALL}
        options={[
          { label: t('team.filter.allMembers'), value: ALL },
          ...options.memberIds.map((id) => {
            const member = profiles.get(id);
            return { label: member?.fullName || member?.username || id, value: id };
          }),
        ]}
        onChange={(value) => onUserChange(value === ALL ? undefined : String(value))}
      />
    </Flexbox>
  );
};

export default BoardFilters;
