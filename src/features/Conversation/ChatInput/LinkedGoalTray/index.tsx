'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { goalStatusKey } from '@/features/AgentGoals/goalPresentation';
import GoalStatusGlyph from '@/features/AgentGoals/GoalStatusGlyph';
import type { GoalListItem } from '@/services/goal';
import { useChatStore } from '@/store/chat';
import { useGoalStore } from '@/store/goal';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';
import { isGoalRequestGenerating, selectLinkedGoals } from './linkedGoals';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    border: 1px solid ${cssVar.colorFillSecondary};
    border-block-end: none;
    border-start-start-radius: 12px;
    border-start-end-radius: 12px;

    background: ${cssVar.colorBgElevated};
  `,
  containerTopAttached: css`
    border-start-start-radius: 0;
    border-start-end-radius: 0;
  `,
  row: css`
    cursor: pointer;
    padding-block: 6px;
    padding-inline: 12px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorFillTertiary};
    }

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
}));

const LinkedGoalRow = memo<{ item: GoalListItem }>(({ item }) => {
  const { t } = useTranslation('chat');
  const openGoal = useChatStore((s) => s.openGoal);
  const { goal, pendingDecisions, taskDone, taskTotal } = item;
  const open = () => openGoal(goal.id);

  return (
    <Flexbox
      horizontal
      align={'center'}
      aria-label={t('goalProcess.linked.open')}
      className={styles.row}
      gap={8}
      role={'button'}
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      }}
    >
      <GoalStatusGlyph size={14} status={goal.status} />
      <Text ellipsis fontSize={12} style={{ flex: 1, minWidth: 0 }} weight={500}>
        {goal.title}
      </Text>
      {/* Something blocked on the user outranks progress — it is the reason to click. */}
      {pendingDecisions > 0 ? (
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
      <Text fontSize={12} style={{ flexShrink: 0 }} type={'secondary'}>
        {t(goalStatusKey(goal.status))}
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
 * live status (behind the `enableTopicAcceptance` lab). The conversation is the
 * goal's planning conversation, so its progress belongs here — clicking a row
 * opens the whole goal in the Portal, beside the chat that shaped it.
 *
 * Not the topic checklist (`VerifyTray/GoalTray`): that is a sentence and
 * tracking checks stored on the topic; this points at real `goals` rows.
 */
const LinkedGoalTray = memo<LinkedGoalTrayProps>(({ topAttached }) => {
  const enabled = useUserStore(labPreferSelectors.enableTopicAcceptance);
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
  const { data } = useFetchTopicGoals(enabled ? topicId : undefined, goalRequestGenerating);

  const goals = useMemo(
    () => selectLinkedGoals(data?.goals, displayMessages),
    [data, displayMessages],
  );

  if (!enabled || !topicId || goals.length === 0) return null;

  return (
    <Flexbox className={cx(styles.container, topAttached && styles.containerTopAttached)}>
      {goals.map((item) => (
        <LinkedGoalRow item={item} key={item.goal.id} />
      ))}
    </Flexbox>
  );
});

LinkedGoalTray.displayName = 'LinkedGoalTray';

export default LinkedGoalTray;
