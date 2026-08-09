'use client';

import { Center, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import {
  CircleAlert,
  CircleCheck,
  CircleSlash,
  SquareArrowOutUpRight,
  TargetIcon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { dataSelectors, useConversationStore } from '../../store';
import GoalStatusLine from '../GoalWorkCard/GoalStatusLine';
import { useGoalWorkStatus } from '../GoalWorkCard/useGoalWorkStatus';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    overflow: hidden;

    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgElevated};
  `,
  goalDivider: css`
    margin-inline: -16px;
    border-block-start: 1px dashed ${cssVar.colorBorderSecondary};
  `,
  // Full-bleed clickable Goal header inside the card: negative margins undo the
  // card padding so the hover surface reaches the card edges.
  goalHeader: css`
    margin-block: -12px 0;
    margin-inline: -16px;
    padding-block: 12px 10px;
    padding-inline: 16px;
  `,
  goalHeaderMain: css`
    cursor: pointer;
    min-width: 0;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  goalIcon: css`
    flex-shrink: 0;

    width: 36px;
    height: 36px;
    border-radius: 8px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  goalIdentifier: css`
    flex-shrink: 0;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  goalTitle: css`
    min-width: 0;
    font-size: 14px;
    font-weight: 500;
  `,
  identifier: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorTextSecondary};
  `,
}));

interface TaskCallbackMessageProps {
  id: string;
  index: number;
}

type CallbackReason = 'done' | 'error' | 'interrupted';

const reasonMeta: Record<
  CallbackReason,
  {
    color: keyof typeof cssVar;
    i18nKey: 'taskCallback.done' | 'taskCallback.error' | 'taskCallback.interrupted';
    icon: typeof CircleCheck;
  }
> = {
  done: { color: 'colorSuccess', i18nKey: 'taskCallback.done', icon: CircleCheck },
  error: { color: 'colorError', i18nKey: 'taskCallback.error', icon: CircleAlert },
  interrupted: { color: 'colorWarning', i18nKey: 'taskCallback.interrupted', icon: CircleSlash },
};

/**
 * Renders a `role='taskCallback'` message — the result-bridge card that reports
 * a finished task's handoff back into its creator conversation. The
 * task pointer (identifier / reason / taskId) is carried on
 * `metadata.taskCallback`; the handoff summary lives in the message content.
 * Renders as a standalone card (no avatar bubble), like the verify card.
 *
 * For Goal tasks (an acceptance aggregate exists) the card absorbs the Goal
 * status header — 🎯 title + live phase/round/coverage line — and becomes the
 * single surface for that task; the creating turn's tracker card retires (see
 * `useOperationGoals`). Plain tasks keep the simple outcome header.
 */
const TaskCallbackMessage = memo<TaskCallbackMessageProps>(({ id }) => {
  const { t } = useTranslation('chat');
  // Open the task in the right-side detail portal (in-context), instead of
  // navigating away from the conversation to the full task page.
  const openTaskDetail = useChatStore((s) => s.openTaskDetail);
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual);

  const callback = item?.metadata?.taskCallback;
  // Hooks stay unconditional; the status hook waits for Goal classification
  // before enabling acceptance polling.
  const { isGoal, progress, taskName } = useGoalWorkStatus({
    identifier: callback?.identifier,
    taskId: callback?.taskId,
  });
  if (!callback) return null;

  const reason = (callback.reason ?? 'done') as CallbackReason;
  const { color, i18nKey, icon } = reasonMeta[reason] ?? reasonMeta.done;
  const content = typeof item?.content === 'string' ? item.content : '';
  const openTask = () => openTaskDetail(callback.identifier);

  const viewTaskButton = (
    <Button icon={SquareArrowOutUpRight} size={'small'} type={'text'} onClick={openTask}>
      {t('taskCallback.viewTask')}
    </Button>
  );

  return (
    <Flexbox paddingBlock={8}>
      <Flexbox className={styles.card} gap={isGoal ? 12 : 8}>
        {isGoal ? (
          <>
            <Flexbox horizontal align={'center'} className={styles.goalHeader} gap={10}>
              <Flexbox
                horizontal
                align={'center'}
                className={styles.goalHeaderMain}
                flex={1}
                gap={10}
                role={'button'}
                tabIndex={0}
                onClick={openTask}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  openTask();
                }}
              >
                <Center className={styles.goalIcon}>
                  <Icon icon={TargetIcon} size={20} />
                </Center>
                <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                  <Flexbox horizontal align={'center'} gap={8}>
                    <Text ellipsis className={styles.goalTitle}>
                      {taskName ?? callback.identifier}
                    </Text>
                    <span className={styles.goalIdentifier}>{callback.identifier}</span>
                  </Flexbox>
                  <GoalStatusLine {...progress} />
                </Flexbox>
              </Flexbox>
              {viewTaskButton}
            </Flexbox>
            <div className={styles.goalDivider} />
          </>
        ) : (
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Flexbox horizontal align={'center'} gap={8}>
              <Icon color={cssVar[color]} icon={icon} size={18} />
              <Text strong>{t(i18nKey)}</Text>
              <span className={styles.identifier}>{callback.identifier}</span>
            </Flexbox>
            {viewTaskButton}
          </Flexbox>
        )}
        {content ? <Markdown variant={'chat'}>{content}</Markdown> : null}
      </Flexbox>
    </Flexbox>
  );
});

TaskCallbackMessage.displayName = 'TaskCallbackMessage';

export default TaskCallbackMessage;
