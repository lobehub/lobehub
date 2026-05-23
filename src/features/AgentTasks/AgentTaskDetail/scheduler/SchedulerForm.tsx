import { Accordion, AccordionItem, Checkbox, Flexbox, Icon, InputNumber, Text } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs, { type Dayjs } from 'dayjs';
import { Globe, Hash, SlidersHorizontal } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildCronPattern,
  parseCronPattern,
  SCHEDULE_TYPE_OPTIONS,
  type ScheduleType,
  TIMEZONE_OPTIONS,
  type TimezoneOption,
  WEEKDAYS,
} from './CronConfig';

const styles = createStaticStyles(({ css, cssVar }) => ({
  fieldLabel: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  timezoneOffset: css`
    flex-shrink: 0;
    margin-inline-start: 12px;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  timezoneOption: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    min-width: 0;
  `,
  weekdayButton: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 32px;
    border-radius: 6px;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};

    background: transparent;

    transition: all 0.15s ease;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  weekdayButtonActive: css`
    color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBg};

    &:hover {
      color: ${cssVar.colorPrimary};
      background: ${cssVar.colorPrimaryBgHover};
    }
  `,
}));

const DEFAULT_PATTERN = '0 9 * * *';
const DEFAULT_TIMEZONE = 'UTC';

// Cron storage rounds minutes to 0 or 30 (see buildCronPattern), so the picker
// only needs to offer half-hour slots — flatten to a single column instead of
// antd's hour×minute grid.
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.floor(i / 2);
  const minute = i % 2 === 0 ? 0 : 30;
  const label = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { label, value: hour * 60 + minute };
});

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

  // Local state seeded once from props at mount; never re-synced. Keeps the
  // form in user control even if an unrelated detail refresh runs concurrently.
  // Parent should `key={taskId}` this component to remount cleanly across tasks.
  const [initial] = useState(() => {
    const parsed = parseCronPattern(pattern || DEFAULT_PATTERN);
    return {
      ...parsed,
      triggerTime: dayjs().hour(parsed.triggerHour).minute(parsed.triggerMinute),
    };
  });

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
        hourlyInterval: number;
        maxExec: number | null;
        scheduleType: ScheduleType;
        triggerTime: Dayjs;
        tz: string;
        weekdays: number[];
      }>,
    ) => {
      // When the user is mid-editing maxExec (cleared the input but hasn't
      // typed yet), local maxExec is null but `continuous` is still false.
      // Falling back to the persisted prop here avoids emitting null for an
      // unrelated field change — which would otherwise flip Continuous on.
      const fallbackMaxExec = continuous ? null : (maxExec ?? maxExecutions ?? null);
      const next = {
        hourlyInterval: overrides.hourlyInterval ?? hourlyInterval,
        maxExec: overrides.maxExec === undefined ? fallbackMaxExec : overrides.maxExec,
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
    [
      continuous,
      hourlyInterval,
      maxExec,
      maxExecutions,
      onChange,
      scheduleType,
      triggerTime,
      tz,
      weekdays,
    ],
  );

  const handleScheduleTypeChange = (value: ScheduleType) => {
    const nextWeekdays = value === 'weekly' ? (weekdays.length ? weekdays : [1, 2, 3, 4, 5]) : [];
    setScheduleType(value);
    setWeekdays(nextWeekdays);
    emit({ scheduleType: value, weekdays: nextWeekdays });
  };

  const handleTimeChange = (totalMinutes: number) => {
    const next = dayjs()
      .hour(Math.floor(totalMinutes / 60))
      .minute(totalMinutes % 60);
    setTriggerTime(next);
    emit({ triggerTime: next });
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

  const showTimeRow = scheduleType !== 'hourly';

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal gap={12}>
        <Flexbox flex={1} gap={6}>
          <Text className={styles.fieldLabel}>{t('taskSchedule.frequency')}</Text>
          <Select
            value={scheduleType}
            variant="filled"
            options={SCHEDULE_TYPE_OPTIONS.map((opt) => ({
              label: t(opt.label as any),
              value: opt.value,
            }))}
            onChange={handleScheduleTypeChange}
          />
        </Flexbox>
        {showTimeRow && (
          <Flexbox flex={1} gap={6}>
            <Text className={styles.fieldLabel}>{t('taskSchedule.time')}</Text>
            <Select
              options={TIME_OPTIONS}
              value={triggerTime.hour() * 60 + triggerTime.minute()}
              variant="filled"
              onChange={handleTimeChange}
            />
          </Flexbox>
        )}
        {scheduleType === 'hourly' && (
          <Flexbox flex={1} gap={6}>
            <Text className={styles.fieldLabel}>{t('taskSchedule.every')}</Text>
            <Flexbox horizontal align="center" gap={6}>
              <InputNumber
                max={24}
                min={1}
                style={{ flex: 1 }}
                value={hourlyInterval}
                variant="filled"
                onChange={handleHourlyIntervalChange}
              />
              <Text type="secondary">{t('taskSchedule.hours')}</Text>
              <Select
                style={{ width: 80 }}
                value={triggerTime.minute()}
                variant="filled"
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
      </Flexbox>

      {scheduleType === 'weekly' && (
        <Flexbox gap={6}>
          <Text className={styles.fieldLabel}>{t('taskSchedule.weekday')}</Text>
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

      <Accordion defaultExpandedKeys={[]} gap={0}>
        <AccordionItem
          itemKey="advanced"
          paddingBlock={6}
          paddingInline={0}
          title={
            <Flexbox horizontal align="center" gap={8}>
              <Icon color={cssVar.colorTextDescription} icon={SlidersHorizontal} size={14} />
              <Text style={{ color: cssVar.colorTextSecondary }}>
                {t('taskSchedule.advancedSettings')}
              </Text>
            </Flexbox>
          }
        >
          <Flexbox gap={14} paddingBlock={'8px 4px'}>
            <Flexbox gap={6}>
              <Flexbox horizontal align="center" gap={6}>
                <Icon color={cssVar.colorTextDescription} icon={Globe} size={14} />
                <Text className={styles.fieldLabel}>{t('taskSchedule.timezone')}</Text>
              </Flexbox>
              <Select
                showSearch
                options={TIMEZONE_OPTIONS}
                popupMatchSelectWidth={false}
                value={tz}
                variant="filled"
                optionRender={(option) => {
                  const data = option as TimezoneOption;
                  return (
                    <div className={styles.timezoneOption}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {data.label}
                      </span>
                      <span className={styles.timezoneOffset}>{data.offset}</span>
                    </div>
                  );
                }}
                onChange={handleTimezoneChange}
              />
            </Flexbox>

            <Flexbox gap={6}>
              <Flexbox horizontal align="center" gap={6}>
                <Icon color={cssVar.colorTextDescription} icon={Hash} size={14} />
                <Text className={styles.fieldLabel}>{t('taskSchedule.maxExecutions')}</Text>
              </Flexbox>
              <Flexbox horizontal align="center" gap={12}>
                <InputNumber
                  disabled={continuous}
                  min={1}
                  placeholder={t('taskSchedule.maxExecutionsPlaceholder')}
                  style={{ flex: 1 }}
                  value={maxExec ?? undefined}
                  variant="filled"
                  onChange={handleMaxExecChange}
                />
                <Checkbox checked={continuous} onChange={handleContinuousChange}>
                  {t('taskSchedule.continuous')}
                </Checkbox>
              </Flexbox>
            </Flexbox>
          </Flexbox>
        </AccordionItem>
      </Accordion>
    </Flexbox>
  );
});

export default SchedulerForm;
