'use client';

import { memo } from 'react';

import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';

interface AssigneeProfileAvatarProps {
  agentId: string;
  size?: number;
}

/**
 * The agent doing a goal task, as its avatar with the agent's profile card on
 * hover — the same card a group shows for its members, so "who is on it" reads
 * as a person with a role rather than a bare name.
 */
const AssigneeProfileAvatar = memo<AssigneeProfileAvatarProps>(({ agentId, size }) => {
  const meta = useAgentDisplayMeta(agentId);

  return (
    <AgentProfilePopup
      agentId={agentId}
      trigger={'hover'}
      agent={
        meta
          ? { avatar: meta.avatar, backgroundColor: meta.backgroundColor, title: meta.title }
          : undefined
      }
    >
      {/* The card renders in a portal but its clicks still bubble through React:
          without this, clicking inside it would also open the row / graph node. */}
      <span
        style={{ cursor: 'default', display: 'inline-flex', flex: 'none' }}
        onClick={(event) => event.stopPropagation()}
      >
        <AssigneeAvatar agentId={agentId} size={size} />
      </span>
    </AgentProfilePopup>
  );
});

AssigneeProfileAvatar.displayName = 'GoalAssigneeProfileAvatar';

export default AssigneeProfileAvatar;
