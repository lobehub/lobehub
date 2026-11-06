'use client';

import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { CalendarClockIcon, XIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation';

const styles = stylex.create({
  chip: {
    flex: 'none',
    height: '28px',
    paddingInlineStart: '8px',
    paddingInlineEnd: '4px',
    borderRadius: '14px',
    backgroundColor: cssVar.colorInfoBg,
    backgroundImage: 'none',
  },
  label: { fontSize: '12px', lineHeight: 1, color: cssVar.colorInfoText, whiteSpace: 'nowrap' },
});

/**
 * The armed-schedule chip, sitting right next to the `+` menu that armed it.
 *
 * Picking a time from `+` only arms the send; this is what makes that armed
 * state visible — otherwise the send button would silently do something other
 * than send. Clearing the chip disarms it, so the way out is attached to the
 * promise.
 */
const ScheduledSendChip = memo(() => {
  const { t } = useTranslation('chat');

  const scheduledSendAt = useConversationStore((s) => s.scheduledSendAt);
  const setScheduledSendAt = useConversationStore((s) => s.setScheduledSendAt);

  if (!scheduledSendAt) return null;

  return (
    <Flexbox horizontal align={'center'} className={stylex.props(styles.chip).className} gap={4}>
      <Icon icon={CalendarClockIcon} size={12} style={{ color: cssVar.colorInfoText }} />
      <Text className={stylex.props(styles.label).className}>
        {dayjs(scheduledSendAt).format('MM-DD HH:mm')}
      </Text>
      <ActionIcon
        icon={XIcon}
        size={'small'}
        title={t('input.schedule.clear')}
        onClick={() => setScheduledSendAt(undefined)}
      />
    </Flexbox>
  );
});

ScheduledSendChip.displayName = 'ScheduledSendChip';

export default ScheduledSendChip;
