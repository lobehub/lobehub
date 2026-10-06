'use client';

import { Icon } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { ArrowUpRight, ChevronUp, Target } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import GoalClarification from '@/features/AgentGoals/GoalClarification';
import MarkdownMessage from '@/features/Conversation/Markdown';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { styles } from './styles';
import type { GoalClarificationGroup } from './usePendingGoalClarifications';

interface GoalClarificationCardProps {
  group: GoalClarificationGroup;
  onCollapse?: () => void;
}

/**
 * A goal's clarification round in the island: the same form the goal page
 * shows, answerable from wherever the user is.
 */
const GoalClarificationCard = memo<GoalClarificationCardProps>(({ group, onCollapse }) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const [actionsPortalTarget, setActionsPortalTarget] = useState<HTMLDivElement | null>(null);

  const openGoal = () =>
    navigate(
      group.agentId ? `/agent/${group.agentId}/goal/${group.goalId}` : `/goal/${group.goalId}`,
    );

  return (
    <div data-pending-hotkey-scope className={styles.card}>
      <div className={styles.header}>
        <Icon icon={Target} size={18} />
        {/* The goal's own title leads, the same way a run approval leads with its
            agent — several goals can be waiting, and this is how to tell them apart. */}
        <div className={styles.headerMeta} title={group.title}>
          <div className={styles.headerSubtitle}>
            <span>{group.title}</span>
            {t('goalProcess.clarify.islandSubtitle')}
          </div>
        </div>
        <ActionIcon
          icon={ArrowUpRight}
          size="small"
          title={t('goalProcess.clarify.openGoal')}
          onClick={openGoal}
        />
        {onCollapse && (
          <ActionIcon
            icon={ChevronUp}
            size="small"
            title={t('globalApproval.collapse')}
            onClick={onCollapse}
          />
        )}
      </div>

      {group.requirement && (
        <div className={styles.requestContext}>
          <div className={styles.userRequestBody}>
            <MarkdownMessage>{group.requirement}</MarkdownMessage>
          </div>
        </div>
      )}

      <div className={styles.content}>
        <GoalClarification
          actionsPortalTarget={actionsPortalTarget}
          goalId={group.goalId}
          key={group.goalId}
          pending={group.questions}
        />
      </div>

      <div className={styles.actions} ref={setActionsPortalTarget} />
    </div>
  );
});

GoalClarificationCard.displayName = 'GoalClarificationCard';

export default GoalClarificationCard;
