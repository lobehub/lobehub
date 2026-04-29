import {
  Accordion,
  AccordionItem,
  Checkbox,
  Flexbox,
  Icon,
  InputNumber,
  Select,
  Text,
} from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs, { type Dayjs } from 'dayjs';
import { Globe, Hash, SlidersHorizontal } from 'lucide-react';
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
  fieldLabel: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
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

    background: ${cssVar.colorFillTertiary};

    transition: all 0.15s ease;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
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

// The parent Popover (Base UI) treats any click outside its popup root as an
// outside-click and dismisses. antd Select's dropdown defaults to a body-level
// portal, which trips that detection — anchor it inside the Popover's DOM so
// option clicks stay "inside".
const getPopupContainer = (triggerNode: HTMLElement) => triggerNode.parentElement ?? document.body;

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

  const showTimeRow = scheduleType !== 'hourly';

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal gap={12}>
        <Flexbox flex={1} gap={6}>
          <Text className={styles.fieldLabel}>{t('taskSchedule.frequency')}</Text>
          <Select
            getPopupContainer={getPopupContainer}
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
              getPopupContainer={getPopupContainer}
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
                getPopupContainer={getPopupContainer}
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

      <Accordion gap={0}>
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
                getPopupContainer={getPopupContainer}
                options={TIMEZONE_OPTIONS}
                popupMatchSelectWidth={false}
                value={tz}
                variant="filled"
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
                  disabled={isUnlimited}
                  min={1}
                  placeholder={t('taskSchedule.maxExecutionsPlaceholder')}
                  style={{ flex: 1 }}
                  value={maxExec ?? undefined}
                  variant="filled"
                  onChange={handleMaxExecChange}
                />
                <Checkbox checked={isUnlimited} onChange={handleContinuousChange}>
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
