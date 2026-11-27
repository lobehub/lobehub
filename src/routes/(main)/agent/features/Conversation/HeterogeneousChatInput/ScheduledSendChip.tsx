'use client';

import { ActionIcon, createStaticStyles, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { CalendarClockIcon, XIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation';
import { densityVars } from '@/styles/densityVars';

const styles = createStaticStyles(({ css }) => ({
  chip: css`
    flex: none;

    height: ${densityVars.smallControlHeight};
    padding-inline: 8px 4px;
    border-radius: calc(${densityVars.smallControlHeight} / 2);

    background: ${cssVar.colorInfoBg};
  `,
  label: css`
    font-size: 12px;
    line-height: 1;
    color: ${cssVar.colorInfoText};
    white-space: nowrap;
  `,
}));

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
    <Flexbox horizontal align={'center'} className={styles.chip} gap={4}>
      <Icon icon={CalendarClockIcon} size={12} style={{ color: cssVar.colorInfoText }} />
      <Text className={styles.label}>{dayjs(scheduledSendAt).format('MM-DD HH:mm')}</Text>
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
