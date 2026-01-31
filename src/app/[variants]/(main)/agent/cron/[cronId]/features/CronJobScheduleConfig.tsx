'use client';

import { Checkbox, Flexbox, FormGroup, LobeSelect as Select, Text } from '@lobehub/ui';
import { Divider, InputNumber, TimePicker } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { SCHEDULE_TYPE_OPTIONS, type ScheduleType, TIMEZONE_OPTIONS } from '../CronConfig';

const styles = createStaticStyles(({ css, cssVar }) => ({
  label: css`
    flex-shrink: 0;
    width: 120px;
  `,
  row: css`
    min-height: 48px;
    padding-block: 12px;
    padding-inline: 0;
  `,
  weekdayButton: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 40px;
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

interface CronJobScheduleConfigProps {
  hourlyInterval?: number;
  maxExecutions?: number | null;
  onScheduleChange: (updates: {
    hourlyInterval?: number;
    maxExecutions?: number | null;
    scheduleType?: ScheduleType;
    timezone?: string;
    triggerTime?: Dayjs;
    weekdays?: number[];
  }) => void;
  scheduleType: ScheduleType;
  timezone: string;
  triggerTime: Dayjs;
  weekdays: number[];
}

const WEEKDAYS = [
  { key: 1, label: 'agentCronJobs.weekdays.mon' },
  { key: 2, label: 'agentCronJobs.weekdays.tue' },
  { key: 3, label: 'agentCronJobs.weekdays.wed' },
  { key: 4, label: 'agentCronJobs.weekdays.thu' },
  { key: 5, label: 'agentCronJobs.weekdays.fri' },
  { key: 6, label: 'agentCronJobs.weekdays.sat' },
  { key: 0, label: 'agentCronJobs.weekdays.sun' },
];

const CronJobScheduleConfig = memo<CronJobScheduleConfigProps>(
  ({
    hourlyInterval,
    maxExecutions,
    onScheduleChange,
    scheduleType,
    timezone,
    triggerTime,
    weekdays,
  }) => {
    const { t } = useTranslation('setting');

    const toggleWeekday = (day: number) => {
      const newWeekdays = weekdays.includes(day)
        ? weekdays.filter((d) => d !== day)
        : [...weekdays, day];
      onScheduleChange({ weekdays: newWeekdays });
    };

    const isUnlimited = maxExecutions === null || maxExecutions === undefined;

    return (
      <FormGroup title={t('agentCronJobs.schedule')} variant="filled">
        {/* Frequency Row */}
        <Flexbox align="center" className={styles.row} gap={24} horizontal>
          <Text className={styles.label}>{t('agentCronJobs.form.frequency')}</Text>
          <Select
            onChange={(value: ScheduleType) =>
              onScheduleChange({
                scheduleType: value,
                weekdays: value === 'weekly' ? [1, 2, 3, 4, 5] : [],
              })
            }
            options={SCHEDULE_TYPE_OPTIONS.map((opt) => ({
              label: t(opt.label as any),
              value: opt.value,
            }))}
            style={{ width: 140 }}
            value={scheduleType}
            variant="outlined"
          />
        </Flexbox>

        <Divider style={{ margin: 0 }} />

        {/* Time Row (for daily/weekly) */}
        {scheduleType !== 'hourly' && (
          <>
            <Flexbox align="center" className={styles.row} gap={24} horizontal>
              <Text className={styles.label}>{t('agentCronJobs.form.time')}</Text>
              <TimePicker
                format="HH:mm"
                minuteStep={15}
                onChange={(value) => {
                  if (value) onScheduleChange({ triggerTime: value });
                }}
                style={{ width: 120 }}
                value={triggerTime ?? dayjs().hour(9).minute(0)}
              />
            </Flexbox>
            <Divider style={{ margin: 0 }} />
          </>
        )}

        {/* Hourly Interval Row */}
        {scheduleType === 'hourly' && (
          <>
            <Flexbox align="center" className={styles.row} gap={24} horizontal>
              <Text className={styles.label}>{t('agentCronJobs.form.every')}</Text>
              <Flexbox align="center" gap={8} horizontal>
                <InputNumber
                  max={24}
                  min={1}
                  onChange={(value) => onScheduleChange({ hourlyInterval: value ?? 1 })}
                  style={{ width: 70 }}
                  value={hourlyInterval ?? 1}
                />
                <Text type="secondary">{t('agentCronJobs.form.hours')}</Text>
                <Text type="secondary">{t('agentCronJobs.form.at')}</Text>
                <Select
                  onChange={(value: number) =>
                    onScheduleChange({ triggerTime: dayjs().hour(0).minute(value) })
                  }
                  options={[
                    { label: ':00', value: 0 },
                    { label: ':15', value: 15 },
                    { label: ':30', value: 30 },
                    { label: ':45', value: 45 },
                  ]}
                  style={{ width: '80px' }}
                  value={triggerTime?.minute() ?? 0}
                  variant="outlined"
                />
              </Flexbox>
            </Flexbox>
            <Divider style={{ margin: 0 }} />
          </>
        )}

        {/* Weekday Selector (only for weekly) */}
        {scheduleType === 'weekly' && (
          <>
            <Flexbox align="center" className={styles.row} gap={24} horizontal>
              <Text className={styles.label}>{t('agentCronJobs.weekdays')}</Text>
              <Flexbox gap={6} horizontal>
                {WEEKDAYS.map(({ key, label }) => (
                  <div
                    className={cx(
                      styles.weekdayButton,
                      weekdays.includes(key) && styles.weekdayButtonActive,
                    )}
                    key={key}
                    onClick={() => toggleWeekday(key)}
                  >
                    {t(label as any)}
                  </div>
                ))}
              </Flexbox>
            </Flexbox>
            <Divider style={{ margin: 0 }} />
          </>
        )}

        {/* Timezone Row */}
        <Flexbox align="center" className={styles.row} gap={24} horizontal>
          <Text className={styles.label}>{t('agentCronJobs.form.timezone')}</Text>
          <Select
            onChange={(value: string) => onScheduleChange({ timezone: value })}
            options={TIMEZONE_OPTIONS}
            popupMatchSelectWidth={false}
            showSearch
            style={{ minWidth: '200px', width: 'fit-content' }}
            value={timezone}
            variant="outlined"
          />
        </Flexbox>

        <Divider style={{ margin: 0 }} />

        {/* Execution Limit Row */}
        <Flexbox align="center" className={styles.row} gap={24} horizontal>
          <Text className={styles.label}>{t('agentCronJobs.maxExecutions')}</Text>
          <Flexbox align="center" gap={12} horizontal>
            <InputNumber
              disabled={isUnlimited}
              min={1}
              onChange={(value) => onScheduleChange({ maxExecutions: value })}
              placeholder="100"
              style={{ width: 100 }}
              value={maxExecutions ?? undefined}
            />
            <Text type="secondary">{t('agentCronJobs.form.times')}</Text>
            <Checkbox
              checked={isUnlimited}
              onChange={(checked) => onScheduleChange({ maxExecutions: checked ? null : 100 })}
            >
              {t('agentCronJobs.form.unlimited')}
            </Checkbox>
          </Flexbox>
        </Flexbox>
      </FormGroup>
    );
  },
);

export default CronJobScheduleConfig;
