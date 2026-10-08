import { Flexbox, Icon } from '@lobehub/ui';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useActivityTime } from '@/hooks/useActivityTime';

import { styles } from './styles';

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
    <Flexbox horizontal align={'flex-start'} className={styles.timelineEntry} gap={12}>
      <span className={styles.timelineNode}>
        <span className={styles.eventDot}>
          <Icon icon={icon} size={12} />
        </span>
      </span>
      <Flexbox flex={1} gap={6} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} className={styles.event} gap={8} wrap={'wrap'}>
          <span>{text}</span>
          <span className={styles.meta} title={time.title}>
            {time.text}
          </span>
        </Flexbox>
        {children}
      </Flexbox>
    </Flexbox>
  );
};

export default TimelineEvent;
