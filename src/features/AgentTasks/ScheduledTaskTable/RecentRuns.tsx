import type { TaskRecentRun } from '@lobechat/types';
import { Flexbox, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import { resolveRunOutcome, type RunOutcome } from './scheduleState';
import { formatRelativeToNow, formatRunMoment } from './scheduleText';

const styles = stylex.create({
  dot: {
    borderRadius: '50%',
    flexShrink: 0,
    height: 8,
    width: 8,
  },
  // A run still in flight has no outcome to fill the dot with.
  running: {
    borderColor: cssVar.colorWarning,
    borderStyle: 'solid',
    borderWidth: 2,
  },
});

const outcomeStyles = stylex.create({
  canceled: { backgroundColor: cssVar.colorTextQuaternary },
  failed: { backgroundColor: cssVar.colorError },
  interrupted: { backgroundColor: cssVar.colorWarning },
  running: { backgroundColor: 'transparent' },
  succeeded: { backgroundColor: cssVar.colorSuccess },
});

const OUTCOME_LABEL_KEYS = {
  canceled: 'taskList.scheduled.runs.outcome.canceled',
  failed: 'taskList.scheduled.runs.outcome.failed',
  interrupted: 'taskList.scheduled.runs.outcome.interrupted',
  running: 'taskList.scheduled.runs.outcome.running',
  succeeded: 'taskList.scheduled.runs.outcome.succeeded',
} as const satisfies Record<RunOutcome, string>;

interface RecentRunsProps {
  now: Date;
  /** Newest first, as the list returns them. */
  runs?: TaskRecentRun[];
}

/**
 * The last few runs of a recurring task as an outcome strip, oldest to newest,
 * followed by when the latest one happened. The strip answers "has this been
 * going well" without opening the task.
 */
export const RecentRuns = ({ now, runs }: RecentRunsProps) => {
  const { t, i18n } = useTranslation('chat');

  if (!runs || runs.length === 0) {
    return (
      <Text fontSize={12} type={'secondary'}>
        {t('taskList.scheduled.runs.none')}
      </Text>
    );
  }

  const locale = i18n.language;
  const dateTimeFormat = t('taskSchedule.nextRun.format');
  const chronological = runs.toReversed();
  const latest = runs[0];
  const outcomes = chronological.map((run) => t(OUTCOME_LABEL_KEYS[resolveRunOutcome(run.status)]));

  return (
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
      <Flexbox
        horizontal
        align={'center'}
        aria-label={outcomes.join(', ')}
        flex={'none'}
        gap={4}
        role={'img'}
      >
        {chronological.map((run, index) => {
          const outcome = resolveRunOutcome(run.status);
          return (
            <Tooltip
              key={run.seq}
              title={t('taskList.scheduled.runs.tooltip', {
                outcome: outcomes[index],
                seq: run.seq,
                time: formatRunMoment(run.completedAt ?? run.createdAt, {
                  dateTimeFormat,
                  locale,
                  now,
                }),
              })}
            >
              <span
                {...stylex.props(
                  styles.dot,
                  outcomeStyles[outcome],
                  outcome === 'running' && styles.running,
                )}
              />
            </Tooltip>
          );
        })}
      </Flexbox>
      <Text ellipsis fontSize={12} style={{ minWidth: 0 }} type={'secondary'}>
        {formatRelativeToNow(latest.completedAt ?? latest.createdAt, now, locale)}
      </Text>
    </Flexbox>
  );
};
