import { Flexbox, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { useTranslation } from 'react-i18next';

import type { ScheduleState } from './scheduleState';
import { formatElapsed, formatRelativeToNow, formatRunMoment } from './scheduleText';

interface ScheduleStateCellProps {
  now: Date;
  state: ScheduleState;
}

const FLEX_MIN_WIDTH_0 = { minWidth: 0 };

/**
 * When the task runs next, or, when it will not run on its own, the reason in
 * its place. The reason is the cell's text; the tooltip only adds what to do.
 */
export const ScheduleStateCell = ({ now, state }: ScheduleStateCellProps) => {
  const { t, i18n } = useTranslation('chat');
  const locale = i18n.language;

  if (state.health === 'scheduled') {
    if (!state.nextRunAt) {
      return (
        <Text ellipsis type={'secondary'}>
          {t('taskList.scheduled.state.nextRunUnknown')}
        </Text>
      );
    }
    return (
      <Flexbox horizontal align={'baseline'} gap={6} style={FLEX_MIN_WIDTH_0}>
        <Text style={{ flex: 'none' }} weight={500}>
          {formatRunMoment(state.nextRunAt, {
            dateTimeFormat: t('taskSchedule.nextRun.format'),
            locale,
            now,
          })}
        </Text>
        <Text ellipsis fontSize={12} style={FLEX_MIN_WIDTH_0} type={'secondary'}>
          {formatRelativeToNow(state.nextRunAt, now, locale)}
        </Text>
      </Flexbox>
    );
  }

  if (state.health === 'running') {
    return (
      <Text ellipsis>
        {state.runningSince
          ? t('taskList.scheduled.state.running', {
              duration: formatElapsed(state.runningSince, now, locale),
            })
          : t('taskList.scheduled.state.runningNoDuration')}
      </Text>
    );
  }

  const reason = {
    awaitingHuman: {
      color: cssVar.colorInfo,
      hint: t('taskList.scheduled.state.awaitingHuman.hint'),
      text: t('taskList.scheduled.state.awaitingHuman'),
    },
    awaitingReview: {
      color: cssVar.colorInfo,
      hint: t('taskList.scheduled.state.awaitingReview.hint'),
      text: t('taskList.scheduled.state.awaitingReview'),
    },
    overrun: {
      color: cssVar.colorWarning,
      hint: t('taskList.scheduled.state.overrun.hint'),
      text: state.runningSince
        ? t('taskList.scheduled.state.overrun', {
            duration: formatElapsed(state.runningSince, now, locale),
          })
        : t('taskList.scheduled.state.runningNoDuration'),
    },
    stopped: {
      color: cssVar.colorError,
      hint: t('taskList.scheduled.state.stopped.hint'),
      text: t('taskList.scheduled.state.stopped', { count: state.consecutiveFailures }),
    },
  }[state.health];

  return (
    <Tooltip title={reason.hint}>
      <Text ellipsis style={{ color: reason.color }} weight={500}>
        {reason.text}
      </Text>
    </Tooltip>
  );
};
