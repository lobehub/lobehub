import { Flexbox, Icon } from '@lobehub/ui';
import { cx } from 'antd-style';
import type { LucideIcon } from 'lucide-react';

import { useActivityTime } from '@/hooks/useActivityTime';

import { styles } from './styles';

/** A persisted event, shared by the interactive discussion and read-only report. */
const TimelineEvent = ({ at, icon, text }: { at: Date; icon: LucideIcon; text: string }) => {
  const time = useActivityTime(at);
  return (
    <Flexbox
      horizontal
      align={'center'}
      className={cx(styles.timelineEntry, styles.eventEntry)}
      gap={12}
    >
      <span className={styles.eventDot}>
        <Icon icon={icon} size={12} />
      </span>
      <Flexbox horizontal align={'center'} className={styles.event} gap={8} wrap={'wrap'}>
        <span>{text}</span>
        <span className={styles.meta} title={time.title}>
          {time.text}
        </span>
      </Flexbox>
    </Flexbox>
  );
};

export default TimelineEvent;
