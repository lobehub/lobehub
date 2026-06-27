'use client';

import { Button, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { CircleAlert, CircleCheck, CircleSlash, SquareArrowOutUpRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { dataSelectors, useConversationStore } from '../../store';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    overflow: hidden;

    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 16px;

    background: ${token.colorBgElevated};
  `,
  identifier: css`
    font-family: ${token.fontFamilyCode};
    color: ${token.colorTextSecondary};
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
    color: string;
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
 */
const TaskCallbackMessage = memo<TaskCallbackMessageProps>(({ id }) => {
  const { styles, theme } = useStyles();
  const { t } = useTranslation('chat');
  // Open the task in the right-side detail portal (in-context), instead of
  // navigating away from the conversation to the full task page.
  const openTaskDetail = useChatStore((s) => s.openTaskDetail);
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual);

  const callback = item?.metadata?.taskCallback;
  if (!callback) return null;

  const reason = (callback.reason ?? 'done') as CallbackReason;
  const { color, i18nKey, icon } = reasonMeta[reason] ?? reasonMeta.done;
  const content = typeof item?.content === 'string' ? item.content : '';

  return (
    <Flexbox paddingBlock={8}>
      <Flexbox className={styles.card} gap={8}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Icon color={(theme as any)[color]} icon={icon} size={18} />
            <Text strong>{t(i18nKey)}</Text>
            <span className={styles.identifier}>{callback.identifier}</span>
          </Flexbox>
          <Button
            icon={SquareArrowOutUpRight}
            size={'small'}
            type={'text'}
            onClick={() => openTaskDetail(callback.identifier)}
          >
            {t('taskCallback.viewTask')}
          </Button>
        </Flexbox>
        {content ? <Markdown variant={'chat'}>{content}</Markdown> : null}
      </Flexbox>
    </Flexbox>
  );
});

TaskCallbackMessage.displayName = 'TaskCallbackMessage';

export default TaskCallbackMessage;
