import { Button } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useState } from 'react';

import { groupByMonth } from '../derive';
import { useEntityFormat } from '../format';
import { type MemoryActivity } from '../types';
import Section from './Section';
import TimelineEntry from './TimelineEntry';

const styles = stylex.create({
  list: { display: 'flex', flexDirection: 'column', gap: '20px' },
  month: { display: 'flex', flexDirection: 'column', gap: '16px' },
  monthLabel: {
    backgroundColor: cssVar.colorBgContainer,
    color: cssVar.colorTextTertiary,
    fontSize: '12px',
    fontWeight: 500,
    insetBlockStart: 0,
    paddingBlock: '6px',
    position: 'sticky',
    zIndex: 1,
  },
  empty: { color: cssVar.colorTextTertiary, fontSize: '13px', lineHeight: '20px', margin: 0 },
  more: { alignSelf: 'flex-start' },
});

/** Long timelines show the most recent entries first and expand on request. */
const PAST_PREVIEW = 12;

type Entry = { activity: MemoryActivity; names: string[] };

interface TimelineProps {
  entries: Entry[];
}

/**
 * Activities are not linked to contexts in the backend; these are the ones that mention a name
 * this page mentions. The header says so, and each entry shows which name matched.
 */
const Timeline = memo<TimelineProps>(({ entries }) => {
  const format = useEntityFormat();
  const { t } = format;
  const [expanded, setExpanded] = useState(false);
  const upcoming = entries.filter((e) => e.activity.planned);
  const past = entries.filter((e) => !e.activity.planned);
  const shown = expanded ? past : past.slice(0, PAST_PREVIEW);

  return (
    <>
      {upcoming.length > 0 && (
        <Section title={t('entity.timeline.upcoming')}>
          <div {...stylex.props(styles.list)}>
            {upcoming.map(({ activity, names }) => (
              <TimelineEntry upcoming activity={activity} key={activity.id} matched={names} />
            ))}
          </div>
        </Section>
      )}
      <Section
        extra={past.length > 0 ? t('entity.timeline.pastExtra', { count: past.length }) : undefined}
        title={t('entity.timeline.past')}
      >
        {past.length === 0 ? (
          <p {...stylex.props(styles.empty)}>{t('entity.timeline.empty')}</p>
        ) : (
          <div {...stylex.props(styles.list)}>
            {groupByMonth(shown, format.month).map((group) => (
              <div key={group.label} {...stylex.props(styles.month)}>
                <div {...stylex.props(styles.monthLabel)}>{group.label}</div>
                {group.entries.map(({ activity, names }) => (
                  <TimelineEntry activity={activity} key={activity.id} matched={names} />
                ))}
              </div>
            ))}
            {past.length > shown.length && (
              <Button
                size={'small'}
                type={'text'}
                {...stylex.props(styles.more)}
                onClick={() => setExpanded(true)}
              >
                {t('entity.timeline.showAll', { count: past.length })}
              </Button>
            )}
          </div>
        )}
      </Section>
    </>
  );
});

Timeline.displayName = 'EntityTimeline';

export default Timeline;
