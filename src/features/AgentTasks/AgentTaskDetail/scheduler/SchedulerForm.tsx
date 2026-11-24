import {
  Accordion,
  Checkbox,
  createStaticStyles,
  cssVar,
  Flexbox,
  Icon,
  InputNumber,
  Select,
  Tag,
  Text,
  ToggleGroup,
} from '@lobehub/ui';
import { Globe, Hash, SlidersHorizontal } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessPreciseSchedule } from '@/business/client/hooks/useBusinessPreciseSchedule';
import { densityVars } from '@/styles/densityVars';

import {
  getMinuteChoices,
  SCHEDULE_TYPE_OPTIONS,
  TIMEZONE_OPTIONS,
  type TimezoneOption,
  WEEKDAYS,
} from './CronConfig';
import {
  CUSTOM_MINUTE_UPGRADE,
  type SchedulerFormChange,
  useSchedulerForm,
} from './useSchedulerForm';

export type { SchedulerFormChange } from './useSchedulerForm';

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
    gap: ${densityVars.contentGap};
    align-items: center;
    justify-content: space-between;

    min-width: 0;
  `,
}));

const pad = (n: number) => String(n).padStart(2, '0');

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({ label: pad(hour), value: hour }));

interface SchedulerFormProps {
  maxExecutions?: number | null;
  onChange: (change: SchedulerFormChange) => void;
  pattern?: string | null;
  timezone?: string | null;
}

const SchedulerForm = memo<SchedulerFormProps>(({ maxExecutions, onChange, pattern, timezone }) => {
  const { t } = useTranslation('chat');
  const { allowed: canUseCustomMinute, onUpgrade } = useBusinessPreciseSchedule();

  const weekdayOptions = useMemo(
    () => WEEKDAYS.map(({ key, label }) => ({ label: t(label as any), value: String(key) })),
    [t],
  );

  const {
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
  } = useSchedulerForm({ maxExecutions, onChange, onUpgrade, pattern, timezone });

  const showTimeRow = scheduleType !== 'hourly';

  const minuteSelect = (
    <Select
      popupMatchSelectWidth={false}
      showSearch={canUseCustomMinute}
      style={{ flexShrink: 0, width: 80 }}
      value={triggerTime.minute()}
      variant="filled"
      options={[
        ...getMinuteChoices(canUseCustomMinute, triggerTime.minute()).map((minute) => ({
          label: `:${pad(minute)}`,
          value: minute,
        })),
        ...(canUseCustomMinute
          ? []
          : [
              {
                label: (
                  <Flexbox horizontal align="center" gap={8}>
                    {t('taskSchedule.customMinute')}
                    <Tag color="gold" size="small" style={{ marginInlineEnd: 0 }}>
                      {t('taskSchedule.customMinute.badge')}
                    </Tag>
                  </Flexbox>
                ),
                value: CUSTOM_MINUTE_UPGRADE,
              },
            ]),
      ]}
      onChange={handleMinuteChange}
    />
  );

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
            <Flexbox horizontal align="center" gap={6}>
              <Select
                options={HOUR_OPTIONS}
                style={{ flex: 1, minWidth: 0 }}
                value={triggerTime.hour()}
                variant="filled"
                onChange={handleHourChange}
              />
              {minuteSelect}
            </Flexbox>
          </Flexbox>
        )}
        {scheduleType === 'hourly' && (
          <Flexbox flex={1.5} gap={6} style={{ minWidth: 0 }}>
            <Text className={styles.fieldLabel}>{t('taskSchedule.every')}</Text>
            <Flexbox horizontal align="center" gap={6}>
              <InputNumber
                max={24}
                min={1}
                style={{ flex: 1, minWidth: 0 }}
                suffix={<Text type="secondary">{t('taskSchedule.hours')}</Text>}
                value={hourlyInterval}
                variant="filled"
                onChange={handleHourlyIntervalChange}
              />
              {minuteSelect}
            </Flexbox>
          </Flexbox>
        )}
      </Flexbox>

      {scheduleType === 'weekly' && (
        <Flexbox gap={6}>
          <Text className={styles.fieldLabel}>{t('taskSchedule.weekday')}</Text>
          <ToggleGroup
            multiple
            options={weekdayOptions}
            size="small"
            value={weekdays.map(String)}
            onChange={handleWeekdaysChange}
          />
        </Flexbox>
      )}

      <Accordion
        defaultValue={[]}
        gap={0}
        indicatorPlacement="inline"
        styles={{ header: { paddingBlock: 6, paddingInline: 0 } }}
        items={[
          {
            children: (
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
            ),
            key: 'advanced',
            title: (
              <Flexbox horizontal align="center" gap={8}>
                <Icon color={cssVar.colorTextDescription} icon={SlidersHorizontal} size={14} />
                <Text style={{ color: cssVar.colorTextSecondary }}>
                  {t('taskSchedule.advancedSettings')}
                </Text>
              </Flexbox>
            ),
          },
        ]}
      />
    </Flexbox>
  );
});

export default SchedulerForm;
