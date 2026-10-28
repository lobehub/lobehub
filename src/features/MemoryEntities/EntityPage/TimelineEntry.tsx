import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { useEntityFormat } from '../format';
import { type MemoryActivity } from '../types';

const styles = stylex.create({
  row: { columnGap: '20px', display: 'grid', gridTemplateColumns: '64px 1fr' },
  date: {
    display: 'flex',
    flexDirection: 'column',
    fontVariantNumeric: 'tabular-nums',
    paddingBlockStart: '1px',
  },
  day: { fontSize: '16px', fontWeight: 600, lineHeight: '22px' },
  dayUpcoming: { fontSize: '14px' },
  inexact: { color: cssVar.colorTextSecondary, fontWeight: 400 },
  sub: { color: cssVar.colorTextTertiary, fontSize: '12px', lineHeight: '18px' },
  body: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
  narrative: { color: cssVar.colorText, fontSize: '14px', lineHeight: '22px', margin: 0 },
  meta: { color: cssVar.colorTextTertiary, fontSize: '12px', lineHeight: '20px' },
  name: { color: cssVar.colorTextSecondary },
});

interface TimelineEntryProps {
  activity: MemoryActivity;
  /** The names that tied this entry to the page; shown so a wrong match is easy to spot. */
  matched: string[];
  upcoming?: boolean;
}

const TimelineEntry = memo<TimelineEntryProps>(({ activity, matched, upcoming }) => {
  const format = useEntityFormat();
  const { t } = format;
  const status =
    upcoming || activity.statusValue === 'completed'
      ? undefined
      : format.status(activity.statusValue);

  return (
    <div {...stylex.props(styles.row)}>
      <div {...stylex.props(styles.date)}>
        {upcoming ? (
          <>
            <span {...stylex.props(styles.day, styles.dayUpcoming)}>
              {activity.whenIsExact ? format.monthDay(activity.when) : t('entity.timeline.undated')}
            </span>
            <span {...stylex.props(styles.sub)}>{t('entity.timeline.planned')}</span>
          </>
        ) : (
          <>
            <span {...stylex.props(styles.day, !activity.whenIsExact && styles.inexact)}>
              {format.day(activity.when)}
            </span>
            <span {...stylex.props(styles.sub)}>
              {activity.whenIsExact ? format.weekday(activity.when) : t('entity.timeline.recorded')}
            </span>
          </>
        )}
      </div>
      <div {...stylex.props(styles.body)}>
        <p {...stylex.props(styles.narrative)}>{activity.narrative || activity.title}</p>
        <span {...stylex.props(styles.meta)}>
          {t('entity.timeline.mentions')}{' '}
          <span {...stylex.props(styles.name)}>{format.names(matched)}</span>
          {status && ` · ${status}`}
        </span>
      </div>
    </div>
  );
});

TimelineEntry.displayName = 'TimelineEntry';

export default TimelineEntry;
