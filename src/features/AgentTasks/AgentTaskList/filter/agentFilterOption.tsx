import AgentAvatar from '@/components/AgentAvatar';

import type { TaskFilterValue } from './taskFilterState';

export const AGENT_OPTION_ICON_SIZE = 16;

interface AgentFilterOptionInput {
  avatar?: string | null;
  backgroundColor?: string | null;
  id: string;
  label: string;
}

/**
 * One agent in a filter menu. `AgentAvatar` draws the generated character for
 * an agent with no avatar of its own; a plain `Avatar` would leave it blank.
 */
export const toAgentFilterOption = (
  { avatar, backgroundColor, id, label }: AgentFilterOptionInput,
  value: TaskFilterValue = id,
) => ({
  icon: (
    <AgentAvatar
      agentId={id}
      avatar={avatar ?? undefined}
      background={backgroundColor ?? undefined}
      name={label}
      size={AGENT_OPTION_ICON_SIZE}
    />
  ),
  label,
  value,
});
