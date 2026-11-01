import type { ChatTopicStatus, TaskStatus } from '@lobechat/types';
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { TASK_STATUS_VISUALS, TOPIC_STATUS_VISUALS } from '@/components/ExecutionStatus';

interface StatusGlyphProps {
  size?: number;
  status: ChatTopicStatus | TaskStatus;
  /** Tasks and topics share the visual family but not the full status set. */
  variant: 'task' | 'topic';
}

/**
 * The one true status glyph, straight from `ExecutionStatus.ts` — never invent
 * a second icon set for the same state. Note `task:paused` deliberately renders
 * as the "waiting for human" hand: it means *pending review*, not "suspended".
 */
const StatusGlyph = memo<StatusGlyphProps>(({ status, variant, size = 14 }) => {
  const { t } = useTranslation('chat');

  const visual =
    variant === 'task'
      ? TASK_STATUS_VISUALS[status as TaskStatus]
      : TOPIC_STATUS_VISUALS[status as ChatTopicStatus];

  if (!visual) return null;

  return (
    <Tooltip title={t(`taskDetail.status.${status}`, { defaultValue: status })}>
      <Flexbox flex={'none'}>
        <Icon color={visual.color} icon={visual.icon} size={size} />
      </Flexbox>
    </Tooltip>
  );
});

export default StatusGlyph;
