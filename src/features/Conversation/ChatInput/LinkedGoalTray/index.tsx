'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight, CircleAlert, CircleDashed } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { goalStatusKey } from '@/features/AgentGoals/goalPresentation';
import GoalStatusGlyph from '@/features/AgentGoals/GoalStatusGlyph';
import type { GoalListItem } from '@/services/goal';
import { useChatStore } from '@/store/chat';
import { goalSelectors, useGoalStore } from '@/store/goal';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';
import { isGoalRequestGenerating, linkedGoalConfirmState, selectLinkedGoals } from './linkedGoals';
import { useMarkSidebarTopicGoal } from './useMarkSidebarTopicGoal';

const styles = stylex.create({
  container: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorFillSecondary,
    borderBlockEndWidth: 0,
    borderStartStartRadius: '12px',
    borderStartEndRadius: '12px',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  containerTopAttached: { borderStartStartRadius: 0, borderStartEndRadius: 0 },
  // Rows carry the default marker so each one can see the row before it.
  row: {
    cursor: 'pointer',
    paddingBlock: '6px',
    paddingInline: '12px',
    borderBlockStartWidth: { default: null, [stylex.when.siblingBefore(':is(*)')]: '1px' },
    borderBlockStartStyle: { default: null, [stylex.when.siblingBefore(':is(*)')]: 'solid' },
    borderBlockStartColor: {
      default: null,
      [stylex.when.siblingBefore(':is(*)')]: cssVar.colorFillTertiary,
    },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

/**
 * `confirmed` is false while the row is still the persisted copy: its status,
 * gates and progress are whatever they were when it was stored, so the row
 * names the goal and holds a neutral "confirming" state until the server
 * answers rather than presenting a stale "running" as live. `failed` is that
 * answer never arriving — the row says so and the click retries instead of
 * opening, because a row nobody confirmed has no live status to show.
 */
const LinkedGoalRow = memo<{
  confirmed: boolean;
  failed?: boolean;
  item: GoalListItem;
  onRetry?: () => void;
}>(({ confirmed, failed, item, onRetry }) => {
  const { t } = useTranslation('chat');
  const openGoal = useChatStore((s) => s.openGoal);
  const { goal, pendingDecisions, taskDone, taskTotal } = item;
  const activate = failed && onRetry ? onRetry : () => openGoal(goal.id);
  const planning = taskTotal === 0 && (goal.status === 'planning' || goal.status === 'running');

  return (
    <Flexbox
      horizontal
      align={'center'}
      aria-label={t(failed ? 'goalProcess.linked.retry' : 'goalProcess.linked.open')}
      {...stylex.props(styles.row, stylex.defaultMarker())}
      gap={8}
      role={'button'}
      tabIndex={0}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      }}
    >
      {confirmed ? (
        <GoalStatusGlyph size={14} status={goal.status} />
      ) : failed ? (
        <Icon color={cssVar.colorWarning} icon={CircleAlert} size={14} />
      ) : (
        <Icon color={cssVar.colorTextQuaternary} icon={CircleDashed} size={14} />
      )}
      <Text ellipsis fontSize={12} style={{ flex: 1, minWidth: 0 }} weight={500}>
        {goal.title}
      </Text>
      {/* Something blocked on the user outranks progress — it is the reason to click. */}
      {!confirmed ? null : pendingDecisions > 0 ? (
        <Text fontSize={12} style={{ color: cssVar.colorWarning, flexShrink: 0 }}>
          {t('goalList.needsYou', { count: pendingDecisions })}
        </Text>
      ) : (
        taskTotal > 0 && (
          <Text fontSize={12} style={{ flexShrink: 0 }} type={'secondary'}>
            {t('goalList.taskProgress', { done: taskDone, total: taskTotal })}
          </Text>
        )
      )}
      <Text
        fontSize={12}
        style={{ color: failed ? cssVar.colorWarning : undefined, flexShrink: 0 }}
        type={failed ? undefined : 'secondary'}
      >
        {/* A `/goal` run marks its goal running at creation; until the plan lands a Task it is still being planned. */}
        {!confirmed
          ? failed
            ? t('goalProcess.linked.checkFailed')
            : t('goalProcess.linked.checking')
          : planning
            ? t('goalTask.status.planning')
            : t(goalStatusKey(goal.status))}
      </Text>
      <Icon color={cssVar.colorTextQuaternary} icon={ChevronRight} size={14} />
    </Flexbox>
  );
});

LinkedGoalRow.displayName = 'LinkedGoalRow';

interface LinkedGoalTrayProps {
  topAttached?: boolean;
}

/**
 * The goals this conversation planned, floating above the composer with their
 * live status (behind the `enableGoals` lab). The conversation is the
 * goal's planning conversation, so its progress belongs here — clicking a row
 * opens the whole goal in the Portal, beside the chat that shaped it.
 */
const LinkedGoalTray = memo<LinkedGoalTrayProps>(({ topAttached }) => {
  const enabled = useUserStore(labPreferSelectors.enableGoals);
  const topicId = useConversationStore((s) => s.context.topicId);
  const displayMessages = useConversationStore(dataSelectors.displayMessages);
  const useFetchTopicGoals = useGoalStore((s) => s.useFetchTopicGoals);
  // Discovery polling is for the run that may create a goal — a `/goal` request —
  // not every generation; goals already found keep polling on their own status.
  const goalRequestGenerating = useConversationStore((s) =>
    isGoalRequestGenerating(
      dataSelectors.displayMessages(s),
      messageStateSelectors.isAIGenerating(s),
    ),
  );
  const { error, revalidate } = useFetchTopicGoals(
    enabled ? topicId : undefined,
    goalRequestGenerating,
  );
  const topicGoals = useGoalStore(goalSelectors.topicGoals(topicId));
  const confirmed = useGoalStore(goalSelectors.topicGoalsConfirmed(topicId));
  const confirmState = linkedGoalConfirmState(confirmed, error);
  const retry = useCallback(() => void revalidate(), [revalidate]);
  // Server-confirmed rows only, in both directions: a goal still pending in a
  // tool result may not exist yet, and a cached empty list proves nothing.
  useMarkSidebarTopicGoal(
    enabled ? topicId : undefined,
    confirmed ? !!topicGoals?.length : undefined,
  );

  const goals = useMemo(
    () => selectLinkedGoals(topicGoals, displayMessages),
    [topicGoals, displayMessages],
  );

  if (!enabled || !topicId || goals.length === 0) return null;

  return (
    <Flexbox {...stylex.props(styles.container, topAttached && styles.containerTopAttached)}>
      {goals.map((item) => (
        <LinkedGoalRow
          confirmed={confirmed}
          failed={confirmState === 'failed'}
          item={item}
          key={item.goal.id}
          onRetry={confirmState === 'failed' ? retry : undefined}
        />
      ))}
    </Flexbox>
  );
});

LinkedGoalTray.displayName = 'LinkedGoalTray';

export default LinkedGoalTray;
