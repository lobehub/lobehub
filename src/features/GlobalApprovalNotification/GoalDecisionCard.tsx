'use client';

import { ActionIcon, Button } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpRight, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openGateReportModal } from '@/features/Acceptance/Viewer/Gate';
import GoalDecisionCase, {
  GoalDecisionAsker,
  type GoalGateCategory,
  goalGateCategory,
  useGateSummary,
} from '@/features/AgentGoals/GoalDecision';
import {
  coordinatorGateReason,
  localizedCoordinatorReason,
} from '@/features/AgentGoals/ProcessControl/coordinatorCopy';
import { openGoalSignOffModal } from '@/features/AgentGoals/SignOffReport';
import SignOffDigest from '@/features/AgentGoals/SignOffReport/SignOffDigest';
import { useGoalSignOff } from '@/features/AgentGoals/SignOffReport/useGoalSignOff';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useGoalStore } from '@/store/goal';

import { refreshGoalAsks } from './refreshGoalAsks';
import { styles } from './styles';
import type { IslandGoalItem } from './usePendingGoalDecisions';

interface GoalDecisionCardProps {
  item: IslandGoalItem;
  onCollapse?: () => void;
  /** Hide this ask from the island; it keeps waiting in the Home inbox. */
  onDismiss?: () => void;
}

/**
 * A goal gate or a goal sign-off in the island: the same question the goal
 * page asks, answerable from wherever the user is. The goal's own title leads,
 * the way a run approval leads with its agent — several goals can be waiting.
 */
const GoalDecisionCard = ({ item, onCollapse, onDismiss }: GoalDecisionCardProps) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const decideGoal = useGoalStore((s) => s.decideGoal);
  const gateSummary = useGateSummary();
  const [actionsPortalTarget, setActionsPortalTarget] = useState<HTMLDivElement | null>(null);

  const goal =
    item.type === 'decision'
      ? { agentId: item.decision.agentId, id: item.decision.goalId, title: item.decision.goalTitle }
      : { agentId: item.signOff.agentId, id: item.signOff.goalId, title: item.signOff.goalTitle };

  const category =
    item.type === 'decision'
      ? (goalGateCategory({
          nodeTitle: item.decision.nodeTitle,
          options: item.decision.options,
        }) as Exclude<GoalGateCategory, 'clarify'>)
      : undefined;

  // A held batch release is a decision gate: reviewed in its report, never
  // answered with one click from wherever the user happens to be.
  const reviewAcceptanceId =
    item.type === 'decision' ? (item.decision.releaseGateAcceptanceId ?? undefined) : undefined;
  const openReview = () =>
    reviewAcceptanceId &&
    openGateReportModal({
      acceptanceId: reviewAcceptanceId,
      onDecided: () => void refreshGoalAsks(goal.id),
    });

  const openGoal = () =>
    navigate(goal.agentId ? `/agent/${goal.agentId}/goal/${goal.id}` : `/goal/${goal.id}`);

  // A sign-off closes the goal, so it is decided over the delivery itself —
  // the report opens first, never a bare yes/no from wherever the user is.
  const openSignOff = () =>
    item.type === 'signOff' &&
    openGoalSignOffModal({
      acceptanceId: item.signOff.acceptanceId,
      agentId: item.signOff.agentId,
      goalId: item.signOff.goalId,
      goalTitle: item.signOff.goalTitle,
      // The inbox carries the same sign-off; it is settled on the server with
      // the acceptance, so re-read it there too.
      onDecided: () => refreshGoalAsks(item.signOff.goalId),
      onOpenGoal: openGoal,
    });

  // The digest says what was delivered, so a sign-off the owner agrees with
  // needs no detour; asking for changes goes through the full report, where
  // the feedback is written.
  const { accept, pending } = useGoalSignOff({
    acceptanceId: item.type === 'signOff' ? item.signOff.acceptanceId : '',
    onClose: () => {},
    onDecided: () => refreshGoalAsks(goal.id),
  });

  return (
    <div data-pending-hotkey-scope {...stylex.props(styles.card)}>
      {/* The goal's agent asks, the way a run approval leads with the agent
          whose run is waiting; a machine gate is asked by the system. */}
      <div {...stylex.props(styles.header)}>
        <div {...stylex.props(styles.headerMeta)}>
          <GoalDecisionAsker
            agentId={goal.agentId}
            category={category ?? 'judgment'}
            subtitle={
              item.type === 'signOff'
                ? t('goalProcess.signOff.islandSubtitle')
                : reviewAcceptanceId
                  ? t('goalProcess.gate.releaseReports')
                  : undefined
            }
          />
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

      <div {...stylex.props(styles.requestContext)}>
        <div {...stylex.props(styles.headerTitle)}>{goal.title}</div>
      </div>

      <div {...stylex.props(styles.content)}>
        {item.type === 'decision' && reviewAcceptanceId ? (
          <div {...stylex.props(styles.reviewSummary)}>
            {localizedCoordinatorReason(coordinatorGateReason(item.decision.question), t as any)}
          </div>
        ) : item.type === 'decision' ? (
          <GoalDecisionCase
            hideAsker
            actionsPortalTarget={actionsPortalTarget}
            basis={item.decision.description}
            category={category!}
            summary={gateSummary(category!, item.decision.sourceTitle)}
            task={item.decision.sourceTitle ? { title: item.decision.sourceTitle } : undefined}
            decision={{
              id: item.decision.decisionId,
              options: item.decision.options,
              question: item.decision.question,
              recommendedOptionId: item.decision.recommendedOptionId,
            }}
            onDecide={(optionId, resolution) =>
              decideGoal(item.decision.goalId, {
                decisionId: item.decision.decisionId,
                optionId,
                resolution,
              })
            }
          />
        ) : (
          <SignOffDigest goalId={item.signOff.goalId} key={item.signOff.goalId} />
        )}
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
        <div
          className={stylex.props(styles.goalActionsSlot).className}
          ref={setActionsPortalTarget}
        />
        {/* One primary per card: a sign-off commits from its digest, a held
            release is reviewed in its report — never both on one card. */}
        {item.type === 'signOff' ? (
          <>
            <Button disabled={!!pending} size="small" onClick={openSignOff}>
              {t('goalProcess.signOff.openReport')}
            </Button>
            <Button
              disabled={!!pending}
              loading={pending === 'accept'}
              size="small"
              title={t('goalProcess.signOff.acceptEffect')}
              type="primary"
              onClick={accept}
            >
              {t('goalProcess.signOff.accept')}
            </Button>
          </>
        ) : (
          reviewAcceptanceId && (
            <Button size="small" type="primary" onClick={openReview}>
              {t('goalProcess.gate.openReview')}
            </Button>
          )
        )}
      </div>
    </div>
  );
};

export default GoalDecisionCard;
