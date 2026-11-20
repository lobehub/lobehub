'use client';

import { ActionIcon } from '@lobehub/ui';
import { PanelRightOpenIcon } from 'lucide-react';

import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { useHeaderActionSize } from '@/styles/density';

interface GoalSupervisorToggleProps {
  /** The agent that supervises the goal; its name goes into the tooltip. */
  agentId: string;
  /** Whether the panel is open — drives the pressed state. */
  expand: boolean;
  hideWhenExpanded?: boolean;
  /** What a press opens, so the tooltip names the action rather than a generic toggle. */
  label: string;
  onToggle: () => void;
}

/**
 * The goal panel's single header entry once the panel is folded.
 *
 * The panel opens by default, so this only shows after someone folds it. It is
 * the same open-panel glyph the task detail page and the document editor use,
 * and the mirror of the panel's own fold button, so folding and unfolding read
 * as one control. It used to be the supervising agent's avatar, which people
 * did not read as a way back into the conversation; the tooltip still names
 * the agent and what the panel holds.
 */
const GoalSupervisorToggle = ({
  agentId,
  expand,
  hideWhenExpanded,
  label,
  onToggle,
}: GoalSupervisorToggleProps) => {
  const meta = useAgentDisplayMeta(agentId);
  const headerActionSmallSize = useHeaderActionSize(true);

  if (hideWhenExpanded && expand) return null;

  // The icon carries the action; the tooltip says whose conversation it reopens.
  const title = meta?.title ? `${meta.title} · ${label}` : label;

  return (
    <ActionIcon
      active={expand}
      aria-label={title}
      data-testid={'goal-supervisor-toggle'}
      icon={PanelRightOpenIcon}
      size={headerActionSmallSize}
      title={title}
      onClick={onToggle}
    />
  );
};

GoalSupervisorToggle.displayName = 'GoalSupervisorToggle';

export default GoalSupervisorToggle;
