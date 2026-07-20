'use client';

import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { BanIcon, ClockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { useConversationStore } from '../../store';

interface ScheduledRunFooterProps {
  id: string;
}

/**
 * Pending-run footer under the user bubble a deferred run is parked on.
 *
 * A `delayed_start` persists its prompt as a real user message and points
 * `scheduledRun.userMessageId` at it, so the promise ("this will run at …") is
 * shown exactly where the user left it, with the way out attached. Deliberately
 * unboxed and muted — it is a quiet status line under the message, not an alert
 * demanding attention. Renders nothing for any other message.
 */
const ScheduledRunFooter = memo<ScheduledRunFooterProps>(({ id }) => {
  const { t } = useTranslation('chat');

  const runAt = useChatStore((s) => {
    const topic = topicSelectors.currentActiveTopic(s);
    if (topic?.status !== 'scheduled') return;

    const scheduledRun = topic.metadata?.scheduledRun;
    if (scheduledRun?.kind !== 'delayed_start' || scheduledRun.userMessageId !== id) return;

    return scheduledRun.runAt;
  });

  const cancelScheduledRun = useConversationStore((s) => s.cancelScheduledRun);

  if (!runAt) return null;

  return (
    <Flexbox horizontal align={'center'} gap={4} justify={'flex-end'} paddingBlock={4}>
      <Icon icon={ClockIcon} size={14} style={{ color: cssVar.colorTextQuaternary }} />
      <Text style={{ fontSize: 12 }} type={'secondary'}>
        {t('input.schedule.pending', { time: dayjs(runAt).format('MM-DD HH:mm') })}
      </Text>
      <ActionIcon
        icon={BanIcon}
        size={'small'}
        title={t('input.schedule.cancel')}
        onClick={() => void cancelScheduledRun()}
      />
    </Flexbox>
  );
});

ScheduledRunFooter.displayName = 'ScheduledRunFooter';

export default ScheduledRunFooter;
