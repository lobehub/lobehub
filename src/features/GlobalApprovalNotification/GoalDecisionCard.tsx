'use client';

import { ActionIcon, toast } from '@lobehub/ui/base-ui';
import { ArrowUpRight, ChevronUp } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import GoalDecisionCase, {
  GoalDecisionAsker,
  type GoalGateCategory,
  goalGateCategory,
  useGateSummary,
} from '@/features/AgentGoals/GoalDecision';
import ClarificationQuestions, {
  type ClarificationAnswer,
} from '@/features/ClarificationQuestions';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { mutate } from '@/libs/swr';
import { goalKeys } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';
import { useGoalStore } from '@/store/goal';

import { styles } from './styles';
import type { IslandGoalItem } from './usePendingGoalDecisions';

interface GoalDecisionCardProps {
  item: IslandGoalItem;
  onCollapse?: () => void;
}

const SIGN_OFF = { accept: 'signOff', requestChanges: 'requestChanges' } as const;

/**
 * A goal gate or a goal sign-off in the island: the same question the goal
 * page asks, answerable from wherever the user is. The goal's own title leads,
 * the way a run approval leads with its agent — several goals can be waiting.
 */
const GoalDecisionCard = ({ item, onCollapse }: GoalDecisionCardProps) => {
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

  const openGoal = () =>
    navigate(goal.agentId ? `/agent/${goal.agentId}/goal/${goal.id}` : `/goal/${goal.id}`);

  const signOffQuestions = useMemo(
    () => [
      {
        description: t('goalProcess.signOff.description'),
        header: '',
        id: 'signOff',
        options: [
          {
            description: t('goalProcess.signOff.acceptEffect'),
            id: SIGN_OFF.accept,
            label: t('goalProcess.signOff.accept'),
            recommended: true,
          },
          {
            description: t('goalProcess.signOff.requestChangesEffect'),
            id: SIGN_OFF.requestChanges,
            label: t('goalProcess.signOff.requestChanges'),
          },
        ],
        question: t('goalProcess.signOff.question'),
      },
    ],
    [t],
  );

  const signOff = useCallback(
    async (answers: ClarificationAnswer[]) => {
      if (item.type !== 'signOff') return;
      const [answer] = answers;
      if (!answer) return;
      // Words with no pick are a change request: that is the only answer that
      // needs them.
      const accept = answer.type === 'option' && answer.optionId === SIGN_OFF.accept;
      const comment = (answer.type === 'option' ? answer.note : answer.text)?.trim() || undefined;
      if (accept) await verifyService.acceptDelivery(item.signOff.acceptanceId, comment);
      else
        await verifyService.rejectDelivery(item.signOff.acceptanceId, comment, { dispatch: true });
      toast.success({
        placement: 'top',
        title: accept ? t('goalProcess.signOff.accepted') : t('goalProcess.signOff.sentBack'),
      });
      // The inbox carries the same sign-off; it is settled on the server with
      // the acceptance, so re-read it there too.
      await Promise.all([
        mutate(goalKeys.pendingForIsland()),
        mutate((key) => Array.isArray(key) && key[0] === 'brief:list'),
      ]);
    },
    [item, t],
  );

  return (
    <div data-pending-hotkey-scope className={styles.card}>
      {/* The goal's agent asks, the way a run approval leads with the agent
          whose run is waiting; a machine gate is asked by the system. */}
      <div className={styles.header}>
        <div className={styles.headerMeta}>
          <GoalDecisionAsker
            agentId={goal.agentId}
            category={category ?? 'judgment'}
            subtitle={item.type === 'signOff' ? t('goalProcess.signOff.islandSubtitle') : undefined}
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

      <div className={styles.requestContext}>
        <div className={styles.headerTitle}>{goal.title}</div>
      </div>

      <div className={styles.content}>
        {item.type === 'decision' ? (
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
          <ClarificationQuestions
            actionsPortalTarget={actionsPortalTarget}
            draftKey={`goal-sign-off:${item.signOff.acceptanceId}`}
            key={item.signOff.acceptanceId}
            questions={signOffQuestions}
            submitLabel={t('goalProcess.decision.submit')}
            supplementPlaceholder={t('goalProcess.signOff.notePlaceholder')}
            onSubmit={signOff}
          />
        )}
      </div>

      <div className={styles.actions} ref={setActionsPortalTarget} />
    </div>
  );
};

export default GoalDecisionCard;
