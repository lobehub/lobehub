import { Flexbox, Tag, Text } from '@lobehub/ui';
import { Card, InputNumber, Select, TimePicker } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  SCHEDULE_TYPE_OPTIONS,
  type ScheduleType,
  TIMEZONE_OPTIONS,
  WEEKDAY_LABELS,
  WEEKDAY_OPTIONS,
} from '../CronConfig';

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

    // Compute summary tags
    const summaryTags = useMemo(() => {
      const result: Array<{ key: string; label: string }> = [];

      // Schedule type
      const scheduleTypeLabel = SCHEDULE_TYPE_OPTIONS.find(
        (opt) => opt.value === scheduleType,
      )?.label;
      if (scheduleTypeLabel) {
        result.push({
          key: 'scheduleType',
          label: t(scheduleTypeLabel as any),
        });
      }

      // Trigger time
      if (scheduleType === 'hourly') {
        const minute = triggerTime.minute();
        result.push({
          key: 'interval',
          label: `Every ${hourlyInterval || 1} hour(s) at :${minute.toString().padStart(2, '0')}`,
        });
      } else {
        result.push({
          key: 'triggerTime',
          label: triggerTime.format('HH:mm'),
        });
      }

      // Timezone
      result.push({
        key: 'timezone',
        label: timezone,
      });

      // Weekdays for weekly schedule
      if (scheduleType === 'weekly' && weekdays.length > 0) {
        result.push({
          key: 'weekdays',
          label: weekdays.map((day) => WEEKDAY_LABELS[day]).join(', '),
        });
      }

      return result;
    }, [scheduleType, triggerTime, timezone, weekdays, hourlyInterval, t]);

    return (
      <Card size="small" style={{ borderRadius: 12 }} styles={{ body: { padding: 12 } }}>
        <Flexbox gap={12}>
          {/* Summary Tags */}
          {summaryTags.length > 0 && (
            <Flexbox align="center" gap={8} horizontal style={{ flexWrap: 'wrap' }}>
              {summaryTags.map((tag) => (
                <Tag key={tag.key} variant={'filled'}>
                  {tag.label}
                </Tag>
              ))}
            </Flexbox>
          )}
          {/* Schedule Configuration - All in one row */}
          <Flexbox align="center" gap={8} horizontal style={{ flexWrap: 'wrap' }}>
            <Tag variant={'borderless'}>{t('agentCronJobs.schedule')}</Tag>
            <Select
              onChange={(value: ScheduleType) =>
                onScheduleChange({
                  scheduleType: value,
                  weekdays: value === 'weekly' ? [0, 1, 2, 3, 4, 5, 6] : [],
                })
              }
              options={SCHEDULE_TYPE_OPTIONS.map((opt) => ({
                label: t(opt.label as any),
                value: opt.value,
              }))}
              size="small"
              style={{ minWidth: 120 }}
              value={scheduleType}
            />

            {/* Weekdays - show only for weekly */}
            {scheduleType === 'weekly' && (
              <Select
                maxTagCount="responsive"
                mode="multiple"
                onChange={(values: number[]) => onScheduleChange({ weekdays: values })}
                options={WEEKDAY_OPTIONS}
                placeholder="Select days"
                size="small"
                style={{ minWidth: 150 }}
                value={weekdays}
              />
            )}

            {/* Trigger Time - show for daily and weekly */}
            {scheduleType !== 'hourly' && (
              <TimePicker
                format="HH:mm"
                minuteStep={30}
                onChange={(value) => {
                  if (value) onScheduleChange({ triggerTime: value });
                }}
                size="small"
                style={{ minWidth: 120 }}
                value={triggerTime ?? dayjs().hour(0).minute(0)}
              />
            )}

            {/* Hourly Interval - show only for hourly */}
            {scheduleType === 'hourly' && (
              <>
                <Tag variant={'borderless'}>Every</Tag>
                <InputNumber
                  max={24}
                  min={1}
                  onChange={(value: number | null) =>
                    onScheduleChange({ hourlyInterval: value ?? 1 })
                  }
                  size="small"
                  style={{ width: 80 }}
                  value={hourlyInterval ?? 1}
                />
                <Text type="secondary">hour(s) at</Text>
                <Select
                  onChange={(value: number) =>
                    onScheduleChange({ triggerTime: dayjs().hour(0).minute(value) })
                  }
                  options={[
                    { label: ':00', value: 0 },
                    { label: ':30', value: 30 },
                  ]}
                  size="small"
                  style={{ width: 80 }}
                  value={triggerTime?.minute() ?? 0}
                />
              </>
            )}

            {/* Timezone */}
            <Select
              onChange={(value: string) => onScheduleChange({ timezone: value })}
              options={TIMEZONE_OPTIONS}
              showSearch
              size="small"
              style={{ maxWidth: 300, minWidth: 200 }}
              value={timezone}
            />
          </Flexbox>

          {/* Max Executions */}
          <Flexbox align="center" gap={8} horizontal style={{ flexWrap: 'wrap' }}>
            <Tag variant={'borderless'}>{t('agentCronJobs.maxExecutions')}</Tag>
            <InputNumber
              min={1}
              onChange={(value: number | null) =>
                onScheduleChange({ maxExecutions: value ?? null })
              }
              placeholder={t('agentCronJobs.form.maxExecutions.placeholder')}
              size="small"
              style={{ width: 160 }}
              value={maxExecutions ?? null}
            />
          </Flexbox>
        </Flexbox>
      </Card>
    );
  },
);

export default CronJobScheduleConfig;
