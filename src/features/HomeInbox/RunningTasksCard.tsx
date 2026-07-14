import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import RingLoadingIcon from '@/components/RingLoading';

import TopicRow from './TopicRow';
import { type InboxTopic } from './useHomeInboxTopics';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    padding-block: 4px 8px;
    padding-inline: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  card: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  head: css`
    cursor: pointer;
    padding-block: 11px;
    padding-inline: 14px;
    transition: background ${cssVar.motionDurationFast};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
}));

/**
 * The ring track is a translucent wash of the same warning color, so the
 * spinner reads as one glyph rather than a colored arc on a grey donut.
 */
const RING_COLOR = `color-mix(in srgb, ${cssVar.colorWarning} 45%, transparent)`;

interface RunningTasksCardProps {
  running: InboxTopic[];
}

/**
 * Runs that are executing fine need no attention — so this collapses to a
 * single line by default and only opens on demand. Nothing here is actionable;
 * it exists so the user knows work is in flight.
 */
const RunningTasksCard = memo<RunningTasksCardProps>(({ running }) => {
  const { t } = useTranslation('home');
  const [open, setOpen] = useState(false);

  if (running.length === 0) return null;

  return (
    <Flexbox className={styles.card}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.head}
        gap={10}
        onClick={() => setOpen((v) => !v)}
      >
        <RingLoadingIcon ringColor={RING_COLOR} size={16} style={{ color: cssVar.colorWarning }} />
        <Text fontSize={13} style={{ flex: 1 }} weight={500}>
          {t('inbox.running.title', { count: running.length })}
        </Text>
        <Icon
          color={cssVar.colorTextQuaternary}
          icon={open ? ChevronDownIcon : ChevronRightIcon}
          size={14}
        />
      </Flexbox>

      {open && (
        <Flexbox className={styles.body}>
          {running.map((topic) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              leading={
                <RingLoadingIcon
                  ringColor={RING_COLOR}
                  size={14}
                  style={{ color: cssVar.colorWarning }}
                />
              }
            />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default RunningTasksCard;
