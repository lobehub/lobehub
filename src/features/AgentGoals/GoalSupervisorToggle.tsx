'use client';

import { ActionIcon } from '@lobehub/ui';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';

/** Fits the 28px header control without crowding it. */
const AVATAR_SIZE = 20;

interface GoalSupervisorToggleProps {
  /** The agent that supervises the goal; its avatar is the panel's entry. */
  agentId: string;
  /** Whether the panel is open — drives the pressed state. */
  expand: boolean;
  hideWhenExpanded?: boolean;
  /** What a press opens, so the tooltip names the action rather than a generic toggle. */
  label: string;
  onToggle: () => void;
}

/**
 * The supervising agent's avatar as the goal panel's entry.
 *
 * The header used to carry two entries for one destination — a panel toggle and a
 * separate "view supervision progress" button. The avatar replaces both, so who
 * is watching and where to see it read as one affordance, and the entry names a
 * person instead of a generic panel glyph.
 */
const GoalSupervisorToggle = ({
  agentId,
  expand,
  hideWhenExpanded,
  label,
  onToggle,
}: GoalSupervisorToggleProps) => {
  const meta = useAgentDisplayMeta(agentId);

  if (hideWhenExpanded && expand) return null;

  // The avatar carries the identity; the tooltip has to carry the action too,
  // because an avatar alone does not tell a screen reader (or a hovering user)
  // that pressing it opens something.
  const title = meta?.title ? `${meta.title} · ${label}` : label;

  return (
    <ActionIcon
      active={expand}
      aria-label={title}
      data-testid={'goal-supervisor-toggle'}
      icon={<AssigneeAvatar agentId={agentId} size={AVATAR_SIZE} />}
      size={DESKTOP_HEADER_ICON_SMALL_SIZE}
      title={title}
      onClick={onToggle}
    />
  );
};

GoalSupervisorToggle.displayName = 'GoalSupervisorToggle';

export default GoalSupervisorToggle;
