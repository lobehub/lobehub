import type { TaskAutomationMode } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  Flexbox,
  InputNumber,
  Popover,
  Segmented,
  Select,
  Text,
} from '@lobehub/ui';
import { Switch } from 'antd';
import { TimerIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import SchedulerForm, { type SchedulerFormChange } from './scheduler/SchedulerForm';

type IntervalUnit = 'hours' | 'minutes' | 'seconds';

interface IntervalTabProps {
  currentInterval: number;
  taskId?: string;
}

const IntervalTab = memo<IntervalTabProps>(({ currentInterval, taskId }) => {
  const { t } = useTranslation('chat');
  const updatePeriodicInterval = useTaskStore((s) => s.updatePeriodicInterval);

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
    (val: number | string | null) => {
      let normalized: number | undefined;
      if (val === null || val === '') {
        normalized = undefined;
      } else if (typeof val === 'string') {
        const n = Number(val);
        normalized = Number.isNaN(n) ? undefined : n;
      } else {
        normalized = val;
      }
      setLocalValue(normalized);
      if (!taskId) return;
      const seconds = toSeconds(normalized ?? null, localUnit);
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
    <>
      <Flexbox horizontal align="center" gap={16} justify={'space-between'}>
        <Text weight={500}>{t('taskSchedule.every')}</Text>
        <Flexbox horizontal align="center" gap={8}>
          <InputNumber
            min={1}
            placeholder="10"
            style={{ width: 100 }}
            value={localValue}
            onChange={handleValueChange}
          />
          <Select
            style={{ width: 110 }}
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
      {currentInterval > 0 && <Button onClick={handleClear}>{t('taskSchedule.clear')}</Button>}
    </>
  );
});

interface SchedulerTabProps {
  taskId?: string;
}

const SchedulerTab = memo<SchedulerTabProps>(({ taskId }) => {
  const updateSchedule = useTaskStore((s) => s.updateSchedule);
  const pattern = useTaskStore(taskDetailSelectors.activeTaskSchedulePattern);
  const timezone = useTaskStore(taskDetailSelectors.activeTaskScheduleTimezone);
  const maxExecutions = useTaskStore(taskDetailSelectors.activeTaskScheduleMaxExecutions);

  const handleChange = useCallback(
    (change: SchedulerFormChange) => {
      if (!taskId) return;
      updateSchedule(taskId, change);
    },
    [taskId, updateSchedule],
  );

  return (
    <SchedulerForm
      maxExecutions={maxExecutions}
      pattern={pattern}
      timezone={timezone}
      onChange={handleChange}
    />
  );
});

interface TaskScheduleConfigProps {
  children?: ReactNode;
  currentInterval?: number;
  taskId?: string;
}

const TaskScheduleConfig = memo(function TaskScheduleConfig({
  children,
  currentInterval,
  taskId,
}: TaskScheduleConfigProps) {
  const { t } = useTranslation('chat');
  const activeTaskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const activeTaskInterval = useTaskStore(taskDetailSelectors.activeTaskPeriodicInterval);
  const automationMode = useTaskStore(taskDetailSelectors.activeTaskAutomationMode);
  const setAutomationMode = useTaskStore((s) => s.setAutomationMode);
  const finalTaskId = taskId ?? activeTaskId;
  const finalCurrentInterval = currentInterval ?? activeTaskInterval;

  const enabled = !!automationMode;

  const handleEnableChange = useCallback(
    (checked: boolean) => {
      if (!finalTaskId) return;
      // When enabling, default to heartbeat (the more common mode)
      setAutomationMode(finalTaskId, checked ? 'heartbeat' : null);
    },
    [finalTaskId, setAutomationMode],
  );

  const handleModeChange = useCallback(
    (value: string | number) => {
      if (!finalTaskId) return;
      setAutomationMode(finalTaskId, value as TaskAutomationMode);
    },
    [finalTaskId, setAutomationMode],
  );

  const content = (
    <Flexbox gap={16} style={{ padding: 8, width: 420 }} onClick={(e) => e.stopPropagation()}>
      <Flexbox horizontal align="center" gap={8}>
        <Text weight={500}>{t('taskSchedule.enable')}</Text>
        <Switch checked={enabled} onChange={handleEnableChange} />
      </Flexbox>
      {enabled && (
        <>
          <Segmented
            block
            value={automationMode ?? 'heartbeat'}
            options={[
              { label: t('taskSchedule.schedulerTab'), value: 'schedule' },
              { label: t('taskSchedule.intervalTab'), value: 'heartbeat' },
            ]}
            onChange={handleModeChange}
          />
          {automationMode === 'heartbeat' && (
            <IntervalTab currentInterval={finalCurrentInterval} taskId={finalTaskId} />
          )}
          {automationMode === 'schedule' && <SchedulerTab taskId={finalTaskId} />}
        </>
      )}
    </Flexbox>
  );

  return (
    <Popover content={content} placement="bottomRight" trigger="click">
      {children ? (
        <div onClick={(e) => e.stopPropagation()}>{children}</div>
      ) : (
        <ActionIcon
          icon={TimerIcon}
          size="small"
          title={t('taskSchedule.title')}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </Popover>
  );
});

export default TaskScheduleConfig;
