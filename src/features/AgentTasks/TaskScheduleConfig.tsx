import { ActionIcon, Flexbox, Segmented, Text } from '@lobehub/ui';
import { InputNumber, Popover, Select } from 'antd';
import { createStaticStyles } from 'antd-style';
import { TimerIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

type ScheduleMode = 'interval' | 'scheduler';
type IntervalUnit = 'hours' | 'minutes' | 'seconds';

const styles = createStaticStyles(({ css, cssVar }) => ({
  configured: css`
    position: relative;

    &::after {
      content: '';

      position: absolute;
      inset-block-start: 4px;
      inset-inline-end: 4px;

      width: 6px;
      height: 6px;
      border-radius: 50%;

      background: ${cssVar.colorPrimary};
    }
  `,
  label: css`
    flex-shrink: 0;
    width: 80px;
  `,
  row: css`
    min-height: 44px;
    padding-block: 10px;
    padding-inline: 0;
  `,
}));

const IntervalTab = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const currentInterval = useTaskStore(taskDetailSelectors.activeTaskPeriodicInterval);
  const updatePeriodicInterval = useTaskStore((s) => s.updatePeriodicInterval);

  // Derive display unit and value from seconds
  const derived = useMemo(() => {
    if (!currentInterval || currentInterval === 0)
      return { displayValue: undefined, unit: 'minutes' as IntervalUnit };
    if (currentInterval >= 3600 && currentInterval % 3600 === 0)
      return { displayValue: currentInterval / 3600, unit: 'hours' as IntervalUnit };
    if (currentInterval >= 60 && currentInterval % 60 === 0)
      return { displayValue: currentInterval / 60, unit: 'minutes' as IntervalUnit };
    return { displayValue: currentInterval, unit: 'seconds' as IntervalUnit };
  }, [currentInterval]);

  const [localUnit, setLocalUnit] = useState<IntervalUnit>(derived.unit);
  const [localValue, setLocalValue] = useState<number | undefined>(derived.displayValue);

  // Resync local state when active task changes
  useEffect(() => {
    setLocalUnit(derived.unit);
    setLocalValue(derived.displayValue);
  }, [derived.unit, derived.displayValue]);

  const toSeconds = (val: number | null, u: IntervalUnit): number | null => {
    if (!val || val <= 0) return null;
    switch (u) {
      case 'hours': {
        return val * 3600;
      }
      case 'minutes': {
        return val * 60;
      }
      default: {
        return val;
      }
    }
  };

  const handleValueChange = useCallback(
    (val: number | null) => {
      setLocalValue(val ?? undefined);
      if (!taskId) return;
      const seconds = toSeconds(val, localUnit);
      updatePeriodicInterval(taskId, seconds);
    },
    [taskId, localUnit, updatePeriodicInterval],
  );

  const handleUnitChange = useCallback(
    (u: IntervalUnit) => {
      setLocalUnit(u);
      if (!taskId || !localValue) return;
      const seconds = toSeconds(localValue, u);
      updatePeriodicInterval(taskId, seconds);
    },
    [taskId, localValue, updatePeriodicInterval],
  );

  const handleClear = useCallback(() => {
    setLocalValue(undefined);
    if (taskId) updatePeriodicInterval(taskId, null);
  }, [taskId, updatePeriodicInterval]);

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align="center" className={styles.row} gap={16}>
        <Text className={styles.label}>{t('taskSchedule.every')}</Text>
        <Flexbox horizontal align="center" gap={8}>
          <InputNumber
            min={1}
            placeholder="10"
            style={{ width: 80 }}
            value={localValue}
            onChange={handleValueChange}
          />
          <Select
            style={{ width: 90 }}
            value={localUnit}
            variant="outlined"
            options={[
              { label: t('taskSchedule.seconds'), value: 'seconds' },
              { label: t('taskSchedule.minutes'), value: 'minutes' },
              { label: t('taskSchedule.hours'), value: 'hours' },
            ]}
            onChange={handleUnitChange}
          />
        </Flexbox>
      </Flexbox>
      {currentInterval > 0 && (
        <Flexbox horizontal justify="flex-end" style={{ paddingBlockEnd: 4 }}>
          <Text style={{ cursor: 'pointer', fontSize: 12 }} type="secondary" onClick={handleClear}>
            {t('taskSchedule.clear')}
          </Text>
        </Flexbox>
      )}
    </Flexbox>
  );
});

const SchedulerTab = memo(() => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox align="center" justify="center" style={{ minHeight: 80, padding: 16 }}>
      <Text type="secondary">{t('taskSchedule.schedulerNotReady')}</Text>
    </Flexbox>
  );
});

const TaskScheduleConfig = memo(() => {
  const { t } = useTranslation('chat');
  const currentInterval = useTaskStore(taskDetailSelectors.activeTaskPeriodicInterval);
  const isConfigured = currentInterval > 0;

  const [mode, setMode] = useState<ScheduleMode>('interval');

  const content = (
    <Flexbox gap={12} style={{ minWidth: 340, padding: 4 }}>
      <Segmented
        block
        value={mode}
        options={[
          { label: t('taskSchedule.intervalTab'), value: 'interval' },
          { label: t('taskSchedule.schedulerTab'), value: 'scheduler' },
        ]}
        onChange={(v) => setMode(String(v) as ScheduleMode)}
      />
      {mode === 'interval' ? <IntervalTab /> : <SchedulerTab />}
    </Flexbox>
  );

  return (
    <Popover content={content} placement="bottomLeft" trigger="click">
      <ActionIcon
        className={isConfigured ? styles.configured : undefined}
        icon={TimerIcon}
        size="small"
        title={t('taskSchedule.title')}
      />
    </Popover>
  );
});

export default TaskScheduleConfig;
