import { Flexbox, Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useActivityTime } from '@/hooks/useActivityTime';

import { timelineEntryMarker } from '../markers.stylex';
import { NODE_GUTTER, styles } from './styles';

/** A persisted event, shared by the interactive discussion and read-only report. */
const TimelineEvent = ({
  at,
  children,
  icon,
  text,
}: {
  at: Date;
  /** What the event said, under its one line — a send-back's reason. */
  children?: ReactNode;
  icon: LucideIcon;
  text: ReactNode;
}) => {
  const time = useActivityTime(at);
  return (
    <Flexbox
      horizontal
      align={'flex-start'}
      gap={NODE_GUTTER}
      {...stylex.props(styles.timelineEntry, timelineEntryMarker)}
    >
      <span {...stylex.props(styles.timelineNode)}>
        <span {...stylex.props(styles.eventDot)}>
          <Icon icon={icon} size={14} />
        </span>
      </span>
      <Flexbox flex={1} gap={6} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'} {...stylex.props(styles.event)}>
          <span>{text}</span>
          <span {...stylex.props(styles.meta)} title={time.title}>
            {time.text}
          </span>
        </Flexbox>
        {children}
      </Flexbox>
    </Flexbox>
  );
};

export default TimelineEvent;
