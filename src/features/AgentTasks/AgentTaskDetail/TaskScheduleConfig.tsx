import type { TaskAutomationMode } from '@lobechat/types';
import {
  ActionIcon,
  Avatar,
  Button,
  Flexbox,
  Icon,
  InputNumber,
  Popover,
  Segmented,
  Select,
  Text,
} from '@lobehub/ui';
import { Switch } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { CalendarClockIcon, CalendarDays, Clock, RefreshCw, TimerIcon, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import {
  formatIntervalLabel,
  formatScheduleDescription,
  formatTimezoneName,
  nextHeartbeatFiring,
  nextScheduleFiring,
} from './scheduler/helpers';
import SchedulerForm, { type SchedulerFormChange } from './scheduler/SchedulerForm';

type IntervalUnit = 'hours' | 'minutes';

const MIN_MINUTES = 10;

const styles = createStaticStyles(({ css, cssVar }) => ({
  fieldLabel: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  popover: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    background: ${cssVar.colorBgContainer};
  `,
  preview: css`
    padding-block: 12px;
    padding-inline: 14px;
    border-radius: 12px;
    background: ${cssVar.colorFillQuaternary};
  `,
}));

interface IntervalTabProps {
  currentInterval: number;
  taskId?: string;
}

const IntervalTab = memo<IntervalTabProps>(({ currentInterval, taskId }) => {
  const { t } = useTranslation('chat');
  const updatePeriodicInterval = useTaskStore((s) => s.updatePeriodicInterval);

  const derived = useMemo(() => {
    if (!currentInterval || currentInterval === 0)
      return { displayValue: MIN_MINUTES, unit: 'minutes' as IntervalUnit };
    if (currentInterval >= 3600 && currentInterval % 3600 === 0)
      return { displayValue: currentInterval / 3600, unit: 'hours' as IntervalUnit };
    return {
      displayValue: Math.max(MIN_MINUTES, Math.round(currentInterval / 60)),
      unit: 'minutes' as IntervalUnit,
    };
  }, [currentInterval]);

  const [localUnit, setLocalUnit] = useState<IntervalUnit>(derived.unit);
  const [localValue, setLocalValue] = useState<number | undefined>(derived.displayValue);

  useEffect(() => {
    setLocalUnit(derived.unit);
    setLocalValue(derived.displayValue);
  }, [derived.unit, derived.displayValue]);

  const toSeconds = (val: number | null, u: IntervalUnit): number | null => {
    if (!val || val <= 0) return null;
    return u === 'hours' ? val * 3600 : val * 60;
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
      const clamped = u === 'minutes' ? Math.max(MIN_MINUTES, localValue) : localValue;
      if (clamped !== localValue) setLocalValue(clamped);
      const seconds = toSeconds(clamped, u);
      updatePeriodicInterval(taskId, seconds);
    },
    [taskId, localValue, updatePeriodicInterval],
  );

  return (
    <Flexbox gap={6}>
      <Text className={styles.fieldLabel}>{t('taskSchedule.intervalLabel')}</Text>
      <Flexbox horizontal align="center" gap={8}>
        <Text type="secondary">{t('taskSchedule.every')}</Text>
        <InputNumber
          min={localUnit === 'minutes' ? MIN_MINUTES : 1}
          placeholder={localUnit === 'minutes' ? String(MIN_MINUTES) : '1'}
          style={{ width: 100 }}
          value={localValue}
          variant="filled"
          onChange={handleValueChange}
        />
        <Select
          style={{ flex: 1 }}
          value={localUnit}
          variant="filled"
          options={[
            { label: t('taskSchedule.minutes'), value: 'minutes' },
            { label: t('taskSchedule.hours'), value: 'hours' },
          ]}
          onChange={handleUnitChange}
        />
        <Text type="secondary">{t('taskSchedule.intervalSuffix')}</Text>
      </Flexbox>
    </Flexbox>
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
  const { t, i18n } = useTranslation('chat');
  const activeTaskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const activeTaskInterval = useTaskStore(taskDetailSelectors.activeTaskPeriodicInterval);
  const automationMode = useTaskStore(taskDetailSelectors.activeTaskAutomationMode);
  const setAutomationMode = useTaskStore((s) => s.setAutomationMode);
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus);
  const detail = useTaskStore(taskDetailSelectors.activeTaskDetail);
  const schedulePattern = useTaskStore(taskDetailSelectors.activeTaskSchedulePattern);
  const scheduleTimezone = useTaskStore(taskDetailSelectors.activeTaskScheduleTimezone);

  const finalTaskId = taskId ?? activeTaskId;
  const finalCurrentInterval = currentInterval ?? activeTaskInterval;

  const enabled = !!automationMode;
  const [isStartingSchedule, setIsStartingSchedule] = useState(false);
  // Heartbeat tasks are re-armed only by maybeRearmHeartbeat after a topic
  // completes; there is no dispatcher that picks up `scheduled` heartbeat tasks,
  // so flipping one to `scheduled` from here would leave it dormant.
  const canStartSchedule =
    automationMode === 'schedule' &&
    !!finalTaskId &&
    status !== 'scheduled' &&
    status !== 'running';

  const summary = useMemo<{ primary: string; secondary?: string } | null>(() => {
    if (automationMode === 'heartbeat' && finalCurrentInterval > 0) {
      return {
        primary: t('taskSchedule.summary.heartbeat', {
          interval: formatIntervalLabel(finalCurrentInterval, t),
        }),
      };
    }
    if (automationMode === 'schedule' && schedulePattern) {
      return {
        primary: formatScheduleDescription(schedulePattern, t),
        secondary: scheduleTimezone
          ? formatTimezoneName(scheduleTimezone, i18n.language)
          : undefined,
      };
    }
    return null;
  }, [automationMode, finalCurrentInterval, schedulePattern, scheduleTimezone, t, i18n.language]);

  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [enabled]);

  const nextRun = useMemo(() => {
    if (!enabled) return null;
    if (automationMode === 'heartbeat') {
      return nextHeartbeatFiring(detail?.heartbeat?.lastAt, finalCurrentInterval);
    }
    if (automationMode === 'schedule' && schedulePattern) {
      return nextScheduleFiring(schedulePattern, scheduleTimezone);
    }
    return null;
  }, [
    automationMode,
    detail?.heartbeat?.lastAt,
    enabled,
    finalCurrentInterval,
    schedulePattern,
    scheduleTimezone,
    nowTick,
  ]);

  const nextRunText = useMemo(() => {
    if (!nextRun) return null;
    return dayjs(nextRun.toDate()).format(t('taskSchedule.nextRun.format'));
  }, [nextRun, t]);

  const handleEnableChange = useCallback(
    (checked: boolean) => {
      if (!finalTaskId) return;
      // Schedule (cron) is the more common, predictable choice; users who want
      // a fixed interval can switch to the heartbeat tab from there.
      setAutomationMode(finalTaskId, checked ? 'schedule' : null);
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

  const handleStartScheduling = useCallback(async () => {
    if (!finalTaskId) return;
    setIsStartingSchedule(true);
    try {
      await updateTaskStatus(finalTaskId, 'scheduled');
    } finally {
      setIsStartingSchedule(false);
    }
  }, [finalTaskId, updateTaskStatus]);

  const content = (
    <Flexbox gap={16} style={{ padding: 4, width: 440 }} onClick={(e) => e.stopPropagation()}>
      <Flexbox horizontal align="center" gap={12}>
        <Avatar
          avatar={<Icon color={cssVar.colorSuccess} icon={Zap} size={20} />}
          background={cssVar.colorSuccessBg}
          shape="square"
          size={40}
        />
        <Flexbox flex={1} gap={2}>
          <Text weight={500}>{t('taskSchedule.heading')}</Text>
          <Text style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
            {summary?.primary ?? t('taskSchedule.summary.disabled')}
          </Text>
          {summary?.secondary && (
            <Text style={{ color: cssVar.colorTextDescription, fontSize: 11 }}>
              {summary.secondary}
            </Text>
          )}
        </Flexbox>
        <Switch checked={enabled} onChange={handleEnableChange} />
      </Flexbox>

      {enabled && nextRunText && (
        <Flexbox horizontal align="center" className={styles.preview} gap={10}>
          <Icon color={cssVar.colorTextDescription} icon={Clock} size={16} />
          <Text style={{ color: cssVar.colorTextSecondary }}>{t('taskSchedule.nextRun')}</Text>
          <Text style={{ flex: 1, textAlign: 'right' }} weight={500}>
            {nextRunText}
          </Text>
        </Flexbox>
      )}

      {enabled && (
        <>
          <Segmented
            block
            value={automationMode ?? 'heartbeat'}
            options={[
              {
                label: (
                  <Flexbox horizontal align="center" gap={6} justify="center">
                    <Icon icon={CalendarDays} size={14} />
                    <span>{t('taskSchedule.schedulerTab')}</span>
                  </Flexbox>
                ),
                value: 'schedule',
              },
              {
                label: (
                  <Flexbox horizontal align="center" gap={6} justify="center">
                    <Icon icon={RefreshCw} size={14} />
                    <span>{t('taskSchedule.intervalTab')}</span>
                  </Flexbox>
                ),
                value: 'heartbeat',
              },
            ]}
            onChange={handleModeChange}
          />
          {automationMode === 'heartbeat' && (
            <IntervalTab currentInterval={finalCurrentInterval} taskId={finalTaskId} />
          )}
          {automationMode === 'schedule' && <SchedulerTab taskId={finalTaskId} />}
          {canStartSchedule && (
            <Button
              block
              icon={CalendarClockIcon}
              loading={isStartingSchedule}
              type="primary"
              onClick={handleStartScheduling}
            >
              {t('taskSchedule.startScheduling')}
            </Button>
          )}
        </>
      )}
    </Flexbox>
  );

  return (
    <Popover className={styles.popover} content={content} placement="bottomRight" trigger="click">
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
