// Fixture: event types as colored tags, a blue in-app link and heavy metadata.
import { Flexbox } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  openLink: css`
    cursor: pointer;
    color: ${cssVar.colorLink};
  `,
  time: css`
    font-size: 12px;
    color: ${cssVar.colorText};
  `,
}));

interface EventRowProps {
  at: string;
  kindLabel: string;
  onOpen: () => void;
  title: string;
}

const EventRow = memo<EventRowProps>(({ at, kindLabel, onOpen, title }) => {
  return (
    <Flexbox horizontal gap={8}>
      {/* alint-expect */}
      <Tag color={'blue'}>{kindLabel}</Tag>
      <span className={styles.openLink} onClick={onOpen}>
        {title}
      </span>
      <span className={styles.time}>{at}</span>
    </Flexbox>
  );
});

export default EventRow;
