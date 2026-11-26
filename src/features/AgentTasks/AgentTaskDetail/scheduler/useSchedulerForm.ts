import dayjs, { type Dayjs } from 'dayjs';
import { useCallback, useState } from 'react';

import {
  buildCronPattern,
  parseCronPattern,
  type ScheduleType,
  updateCronPatternField,
} from './CronConfig';

const DEFAULT_PATTERN = '0 9 * * *';
const DEFAULT_TIMEZONE = 'UTC';

/** Sentinel minute option that opens the upgrade flow instead of changing the value. */
export const CUSTOM_MINUTE_UPGRADE = -1;

export interface SchedulerFormChange {
  maxExecutions: number | null;
  pattern: string;
  timezone: string;
}

export interface UseSchedulerFormOptions {
  maxExecutions?: number | null;
  onChange: (change: SchedulerFormChange) => void;
  onUpgrade?: () => void;
  pattern?: string | null;
  timezone?: string | null;
}

export const useSchedulerForm = ({
  maxExecutions,
  onChange,
  onUpgrade,
  pattern,
  timezone,
}: UseSchedulerFormOptions) => {
  // Local state seeded once from props at mount; never re-synced. Keeps the
  // form in user control even if an unrelated detail refresh runs concurrently.
  // Parent should `key={taskId}` this component to remount cleanly across tasks.
  const [initial] = useState(() => {
    const initialPattern = pattern || DEFAULT_PATTERN;
    const parsed = parseCronPattern(initialPattern);
    return {
      ...parsed,
      pattern: initialPattern,
      triggerTime: dayjs().hour(parsed.triggerHour).minute(parsed.triggerMinute),
    };
  });

  const [currentPattern, setCurrentPattern] = useState<string>(initial.pattern);
  const [scheduleType, setScheduleType] = useState<ScheduleType>(initial.scheduleType);
  const [triggerTime, setTriggerTime] = useState<Dayjs>(initial.triggerTime);
  const [hourlyInterval, setHourlyInterval] = useState<number>(initial.hourlyInterval ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(
    initial.weekdays ?? (initial.scheduleType === 'weekly' ? [1, 2, 3, 4, 5] : []),
  );
  const [tz, setTz] = useState<string>(timezone || DEFAULT_TIMEZONE);
  const [maxExec, setMaxExec] = useState<number | null>(maxExecutions ?? null);
  const [continuous, setContinuous] = useState<boolean>(
    maxExecutions === null || maxExecutions === undefined,
  );

  const emit = useCallback(
    (
      overrides: Partial<{
        maxExec: number | null;
        pattern: string;
        tz: string;
      }>,
    ) => {
      // When the user is mid-editing maxExec (cleared the input but hasn't
      // typed yet), local maxExec is null but `continuous` is still false.
      // Falling back to the persisted prop here avoids emitting null for an
      // unrelated field change — which would otherwise flip Continuous on.
      const fallbackMaxExec = continuous ? null : (maxExec ?? maxExecutions ?? null);
      onChange({
        maxExecutions: overrides.maxExec === undefined ? fallbackMaxExec : overrides.maxExec,
        pattern: overrides.pattern ?? currentPattern,
        timezone: overrides.tz ?? tz,
      });
    },
    [continuous, currentPattern, maxExec, maxExecutions, onChange, tz],
  );

  const handleScheduleTypeChange = (value: ScheduleType) => {
    if (value === scheduleType) return;
    const nextWeekdays = value === 'weekly' ? (weekdays.length ? weekdays : [1, 2, 3, 4, 5]) : [];
    const nextPattern = buildCronPattern(value, triggerTime, hourlyInterval, nextWeekdays);
    setScheduleType(value);
    setWeekdays(nextWeekdays);
    setCurrentPattern(nextPattern);
    emit({ pattern: nextPattern });
  };

  const handleHourChange = (hour: number) => {
    const next = triggerTime.hour(hour);
    const nextPattern =
      updateCronPatternField(currentPattern, 1, String(hour)) ??
      buildCronPattern(scheduleType, next, hourlyInterval, weekdays);
    setTriggerTime(next);
    setCurrentPattern(nextPattern);
    emit({ pattern: nextPattern });
  };

  const handleMinuteChange = (minute: number) => {
    if (minute === CUSTOM_MINUTE_UPGRADE) {
      onUpgrade?.();
      return;
    }
    const next = triggerTime.minute(minute);
    const nextPattern =
      updateCronPatternField(currentPattern, 0, String(minute)) ??
      buildCronPattern(scheduleType, next, hourlyInterval, weekdays);
    setTriggerTime(next);
    setCurrentPattern(nextPattern);
    emit({ pattern: nextPattern });
  };

  const handleHourlyIntervalChange = (value: number | string | null) => {
    const next = typeof value === 'number' && value > 0 ? value : 1;
    const nextPattern =
      updateCronPatternField(currentPattern, 1, next === 1 ? '*' : `*/${next}`) ??
      buildCronPattern(scheduleType, triggerTime, next, weekdays);
    setHourlyInterval(next);
    setCurrentPattern(nextPattern);
    emit({ pattern: nextPattern });
  };

  const handleWeekdaysChange = (values: string[]) => {
    const next = values.map(Number).sort((a, b) => a - b);
    const nextPattern = buildCronPattern(scheduleType, triggerTime, hourlyInterval, next);
    setWeekdays(next);
    setCurrentPattern(nextPattern);
    emit({ pattern: nextPattern });
  };

  const handleTimezoneChange = (value: string) => {
    setTz(value);
    emit({ tz: value });
  };

  const handleMaxExecChange = (value: number | string | null) => {
    if (typeof value === 'number' && value > 0) {
      setMaxExec(value);
      emit({ maxExec: value });
      return;
    }
    // Mid-edit clear (e.g. user is replacing 100 with 5): keep the field
    // empty locally but don't toggle Continuous or emit a null upstream.
    setMaxExec(null);
  };

  const handleContinuousChange = (checked: boolean) => {
    setContinuous(checked);
    if (checked) {
      emit({ maxExec: null });
    } else {
      const next = maxExec ?? 100;
      setMaxExec(next);
      emit({ maxExec: next });
    }
  };

  return {
    continuous,
    handleContinuousChange,
    handleHourChange,
    handleHourlyIntervalChange,
    handleMaxExecChange,
    handleMinuteChange,
    handleScheduleTypeChange,
    handleTimezoneChange,
    handleWeekdaysChange,
    hourlyInterval,
    maxExec,
    scheduleType,
    triggerTime,
    tz,
    weekdays,
  };
};
