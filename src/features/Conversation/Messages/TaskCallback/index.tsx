'use client';

import type { InterfaceDensity } from '@lobechat/types';
import { Button, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { CircleAlert, CircleCheck, CircleSlash, SquareArrowOutUpRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { useDensity } from '@/styles/density';

import { dataSelectors, useConversationStore } from '../../store';

const CARD_PADDING_BLOCK = {
  compact: '6px',
  loose: '12px',
} as const satisfies Record<InterfaceDensity, string>;

const CARD_PADDING_INLINE = {
  compact: '10px',
  loose: '16px',
} as const satisfies Record<InterfaceDensity, string>;

const CARD_RADIUS = {
  compact: '12px',
  loose: '16px',
} as const satisfies Record<InterfaceDensity, string>;

const CARD_LAYOUT = {
  compact: { gap: 4, paddingBlock: 4, titleFontSize: 13 },
  loose: { gap: 8, paddingBlock: 8, titleFontSize: undefined },
} as const satisfies Record<
  InterfaceDensity,
  { gap: number; paddingBlock: number; titleFontSize: number | undefined }
>;

const styles = stylex.create({
  card: {
    overflow: 'hidden',
    paddingBlock: CARD_PADDING_BLOCK.loose,
    paddingInline: CARD_PADDING_INLINE.loose,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: CARD_RADIUS.loose,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  cardCompact: {
    paddingBlock: CARD_PADDING_BLOCK.compact,
    paddingInline: CARD_PADDING_INLINE.compact,
    borderRadius: CARD_RADIUS.compact,
  },
  identifier: { fontFamily: cssVar.fontFamilyCode, color: cssVar.colorTextSecondary },
});

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
 */
const TaskCallbackMessage = memo<TaskCallbackMessageProps>(({ id }) => {
  const { t } = useTranslation('chat');
  const { compact, density } = useDensity();
  const layout = CARD_LAYOUT[density];
  // Open the task in the right-side detail portal (in-context), instead of
  // navigating away from the conversation to the full task page.
  const openTaskDetail = useChatStore((s) => s.openTaskDetail);
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual);

  const callback = item?.metadata?.taskCallback;
  if (!callback) return null;

  const reason = (callback.reason ?? 'done') as CallbackReason;
  const { color, i18nKey, icon } = reasonMeta[reason] ?? reasonMeta.done;
  const content = typeof item?.content === 'string' ? item.content : '';
  const openTask = () => openTaskDetail(callback.taskId ?? callback.identifier);

  const viewTaskButton = (
    <Button icon={SquareArrowOutUpRight} size={'small'} type={'text'} onClick={openTask}>
      {t('taskCallback.viewTask')}
    </Button>
  );

  return (
    <Flexbox paddingBlock={layout.paddingBlock}>
      <Flexbox
        className={stylex.props(styles.card, compact && styles.cardCompact).className}
        gap={layout.gap}
      >
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Icon color={cssVar[color]} icon={icon} size={18} />
            <Text strong fontSize={layout.titleFontSize}>
              {t(i18nKey)}
            </Text>
            <span {...stylex.props(styles.identifier)}>{callback.identifier}</span>
          </Flexbox>
          {viewTaskButton}
        </Flexbox>
        {content ? <Markdown variant={'chat'}>{content}</Markdown> : null}
      </Flexbox>
    </Flexbox>
  );
});

TaskCallbackMessage.displayName = 'TaskCallbackMessage';

export default TaskCallbackMessage;
