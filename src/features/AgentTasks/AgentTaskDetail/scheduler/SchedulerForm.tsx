import { Checkbox, Flexbox, InputNumber, Select, Text } from '@lobehub/ui';
import { TimePicker } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import dayjs, { type Dayjs } from 'dayjs';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildCronPattern,
  parseCronPattern,
  SCHEDULE_TYPE_OPTIONS,
  type ScheduleType,
  TIMEZONE_OPTIONS,
  WEEKDAYS,
} from './CronConfig';

const styles = createStaticStyles(({ css, cssVar }) => ({
  label: css`
    flex-shrink: 0;
    width: 80px;
    color: ${cssVar.colorTextSecondary};
  `,
  weekdayButton: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 32px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 6px;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};

    background: transparent;

    transition: all 0.15s ease;

    &:hover {
      border-color: ${cssVar.colorPrimary};
      color: ${cssVar.colorPrimary};
    }
  `,
  weekdayButtonActive: css`
    border-color: ${cssVar.colorPrimary};
    color: ${cssVar.colorTextLightSolid};
    background: ${cssVar.colorPrimary};

    &:hover {
      border-color: ${cssVar.colorPrimaryHover};
      color: ${cssVar.colorTextLightSolid};
      background: ${cssVar.colorPrimaryHover};
    }
  `,
}));

const DEFAULT_PATTERN = '0 9 * * *';
const DEFAULT_TIMEZONE = 'UTC';

export interface SchedulerFormChange {
  maxExecutions: number | null;
  pattern: string;
  timezone: string;
}

interface SchedulerFormProps {
  maxExecutions?: number | null;
  onChange: (change: SchedulerFormChange) => void;
  pattern?: string | null;
  timezone?: string | null;
}

const SchedulerForm = memo<SchedulerFormProps>(({ maxExecutions, onChange, pattern, timezone }) => {
  const { t } = useTranslation('chat');

  const initial = useMemo(() => {
    const parsed = parseCronPattern(pattern || DEFAULT_PATTERN);
    return {
      ...parsed,
      triggerTime: dayjs().hour(parsed.triggerHour).minute(parsed.triggerMinute),
    };
  }, [pattern]);

  const [scheduleType, setScheduleType] = useState<ScheduleType>(initial.scheduleType);
  const [triggerTime, setTriggerTime] = useState<Dayjs>(initial.triggerTime);
  const [hourlyInterval, setHourlyInterval] = useState<number>(initial.hourlyInterval ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(
    initial.weekdays ?? (initial.scheduleType === 'weekly' ? [1, 2, 3, 4, 5] : []),
  );
  const [tz, setTz] = useState<string>(timezone || DEFAULT_TIMEZONE);
  const [maxExec, setMaxExec] = useState<number | null>(maxExecutions ?? null);

  useEffect(() => {
    setScheduleType(initial.scheduleType);
    setTriggerTime(initial.triggerTime);
    setHourlyInterval(initial.hourlyInterval ?? 1);
    setWeekdays(initial.weekdays ?? (initial.scheduleType === 'weekly' ? [1, 2, 3, 4, 5] : []));
  }, [initial]);

  useEffect(() => {
    setTz(timezone || DEFAULT_TIMEZONE);
  }, [timezone]);

  useEffect(() => {
    setMaxExec(maxExecutions ?? null);
  }, [maxExecutions]);

  const emit = useCallback(
    (
      overrides: Partial<{
        hourlyInterval: number;
        maxExec: number | null;
        scheduleType: ScheduleType;
        triggerTime: Dayjs;
        tz: string;
        weekdays: number[];
      }>,
    ) => {
      const next = {
        hourlyInterval: overrides.hourlyInterval ?? hourlyInterval,
        maxExec: overrides.maxExec === undefined ? maxExec : overrides.maxExec,
        scheduleType: overrides.scheduleType ?? scheduleType,
        triggerTime: overrides.triggerTime ?? triggerTime,
        tz: overrides.tz ?? tz,
        weekdays: overrides.weekdays ?? weekdays,
      };
      const nextPattern = buildCronPattern(
        next.scheduleType,
        next.triggerTime,
        next.hourlyInterval,
        next.weekdays,
      );
      onChange({ maxExecutions: next.maxExec, pattern: nextPattern, timezone: next.tz });
    },
    [hourlyInterval, maxExec, onChange, scheduleType, triggerTime, tz, weekdays],
  );

  const handleScheduleTypeChange = (value: ScheduleType) => {
    const nextWeekdays = value === 'weekly' ? (weekdays.length ? weekdays : [1, 2, 3, 4, 5]) : [];
    setScheduleType(value);
    setWeekdays(nextWeekdays);
    emit({ scheduleType: value, weekdays: nextWeekdays });
  };

  const handleTimeChange = (value: Dayjs | null) => {
    if (!value) return;
    setTriggerTime(value);
    emit({ triggerTime: value });
  };

  const handleHourlyMinuteChange = (minute: number) => {
    const next = dayjs().hour(0).minute(minute);
    setTriggerTime(next);
    emit({ triggerTime: next });
  };

  const handleHourlyIntervalChange = (value: number | string | null) => {
    const next = typeof value === 'number' && value > 0 ? value : 1;
    setHourlyInterval(next);
    emit({ hourlyInterval: next });
  };

  const toggleWeekday = (day: number) => {
    const next = weekdays.includes(day) ? weekdays.filter((d) => d !== day) : [...weekdays, day];
    setWeekdays(next);
    emit({ weekdays: next });
  };

  const handleTimezoneChange = (value: string) => {
    setTz(value);
    emit({ tz: value });
  };

  const handleMaxExecChange = (value: number | string | null) => {
    const next = typeof value === 'number' && value > 0 ? value : null;
    setMaxExec(next);
    emit({ maxExec: next });
  };

  const handleContinuousChange = (checked: boolean) => {
    const next = checked ? null : 100;
    setMaxExec(next);
    emit({ maxExec: next });
  };

  const isUnlimited = maxExec === null || maxExec === undefined;

  return (
    <Flexbox gap={14} paddingBlock={4}>
      <Flexbox horizontal align="center" gap={12} justify="space-between">
        <Text className={styles.label}>{t('taskSchedule.frequency')}</Text>
        <Select
          style={{ width: 200 }}
          value={scheduleType}
          variant="outlined"
          options={SCHEDULE_TYPE_OPTIONS.map((opt) => ({
            label: t(opt.label as any),
            value: opt.value,
          }))}
          onChange={handleScheduleTypeChange}
        />
      </Flexbox>

      {scheduleType !== 'hourly' && (
        <Flexbox horizontal align="center" gap={12} justify="space-between">
          <Text className={styles.label}>{t('taskSchedule.time')}</Text>
          <TimePicker
            format="HH:mm"
            minuteStep={15}
            style={{ width: 200 }}
            value={triggerTime}
            onChange={handleTimeChange}
          />
        </Flexbox>
      )}

      {scheduleType === 'hourly' && (
        <Flexbox horizontal align="center" gap={12} justify="space-between">
          <Text className={styles.label}>{t('taskSchedule.every')}</Text>
          <Flexbox horizontal align="center" gap={8}>
            <InputNumber
              max={24}
              min={1}
              style={{ width: 70 }}
              value={hourlyInterval}
              onChange={handleHourlyIntervalChange}
            />
            <Text type="secondary">{t('taskSchedule.hours')}</Text>
            <Select
              style={{ width: 80 }}
              value={triggerTime.minute()}
              variant="outlined"
              options={[
                { label: ':00', value: 0 },
                { label: ':15', value: 15 },
                { label: ':30', value: 30 },
                { label: ':45', value: 45 },
              ]}
              onChange={handleHourlyMinuteChange}
            />
          </Flexbox>
        </Flexbox>
      )}

      {scheduleType === 'weekly' && (
        <Flexbox horizontal align="center" gap={12} justify="space-between">
          <Text className={styles.label}>{t('taskSchedule.weekday')}</Text>
          <Flexbox horizontal gap={6}>
            {WEEKDAYS.map(({ key, label }) => (
              <div
                key={key}
                className={cx(
                  styles.weekdayButton,
                  weekdays.includes(key) && styles.weekdayButtonActive,
                )}
                onClick={() => toggleWeekday(key)}
              >
                {t(label as any)}
              </div>
            ))}
          </Flexbox>
        </Flexbox>
      )}

      <Flexbox horizontal align="center" gap={12} justify="space-between">
        <Text className={styles.label}>{t('taskSchedule.timezone')}</Text>
        <Select
          showSearch
          options={TIMEZONE_OPTIONS}
          popupMatchSelectWidth={false}
          style={{ width: 280 }}
          value={tz}
          variant="outlined"
          onChange={handleTimezoneChange}
        />
      </Flexbox>

      <Flexbox horizontal align="center" gap={12} justify="space-between">
        <Text className={styles.label}>{t('taskSchedule.maxExecutions')}</Text>
        <Flexbox horizontal align="center" gap={10}>
          <InputNumber
            disabled={isUnlimited}
            min={1}
            placeholder="100"
            style={{ width: 90 }}
            value={maxExec ?? undefined}
            onChange={handleMaxExecChange}
          />
          <Checkbox checked={isUnlimited} onChange={handleContinuousChange}>
            {t('taskSchedule.continuous')}
          </Checkbox>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default SchedulerForm;
