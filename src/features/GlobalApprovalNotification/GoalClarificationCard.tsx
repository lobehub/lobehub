'use client';

import { ActionIcon, Button, Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpRight, ChevronUp, Target } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import GoalClarification from '@/features/AgentGoals/GoalClarification';
import MarkdownMessage from '@/features/Conversation/Markdown';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { sx } from '@/styles/sx';

import { styles } from './styles';
import type { GoalClarificationGroup } from './usePendingGoalClarifications';
import requestModule from './userRequest.module.css';

interface GoalClarificationCardProps {
  group: GoalClarificationGroup;
  onCollapse?: () => void;
  /** Hide this ask from the island; it keeps waiting in the Home inbox. */
  onDismiss?: () => void;
}

/**
 * A goal's clarification round in the island: the same form the goal page
 * shows, answerable from wherever the user is.
 */
const GoalClarificationCard = memo<GoalClarificationCardProps>(
  ({ group, onCollapse, onDismiss }) => {
    const { t } = useTranslation('chat');
    const navigate = useWorkspaceAwareNavigate();
    const [actionsPortalTarget, setActionsPortalTarget] = useState<HTMLDivElement | null>(null);

    const openGoal = () =>
      navigate(
        group.agentId ? `/agent/${group.agentId}/goal/${group.goalId}` : `/goal/${group.goalId}`,
      );

    return (
      <div data-pending-hotkey-scope {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.header)}>
          <Icon icon={Target} size={18} />
          {/* The goal's own title leads, the same way a run approval leads with its
            agent — several goals can be waiting, and this is how to tell them apart. */}
          <div {...stylex.props(styles.headerMeta)} title={group.title}>
            <div {...stylex.props(styles.headerSubtitle)}>
              <span {...stylex.props(styles.headerSubtitleName)}>{group.title}</span>
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
          <div {...stylex.props(styles.requestContext)}>
            <div {...sx([styles.userRequestBody], requestModule.body)}>
              <MarkdownMessage>{group.requirement}</MarkdownMessage>
            </div>
          </div>
        )}

        <div {...stylex.props(styles.content)}>
          <GoalClarification
            actionsPortalTarget={actionsPortalTarget}
            goalId={group.goalId}
            key={group.goalId}
            pending={group.questions}
          />
        </div>

        <div {...stylex.props(styles.goalActions)}>
          {onDismiss && (
            <Button
              size="small"
              title={t('globalApproval.dismissHint')}
              type="text"
              onClick={onDismiss}
            >
              {t('globalApproval.dismiss')}
            </Button>
          )}
          <div {...stylex.props(styles.goalActionsSlot)} ref={setActionsPortalTarget} />
        </div>
      </div>
    );
  },
);

GoalClarificationCard.displayName = 'GoalClarificationCard';

export default GoalClarificationCard;
