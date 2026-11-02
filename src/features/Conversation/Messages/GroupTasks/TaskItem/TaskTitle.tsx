'use client';

import { ThreadStatus } from '@lobechat/types';
import { Block, cssVar, Flexbox, Icon, Spin, Text } from '@lobehub/ui';
import { BrainCircuit, ListChecksIcon, Wrench, XIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';

import { formatDuration, formatElapsedTime, isProcessingStatus } from '../../Tasks/shared';

export interface TaskMetrics {
  /** Task duration in milliseconds (for completed tasks) */
  duration?: number;
  /** Whether metrics are still loading */
  isLoading?: boolean;
  /** Number of LLM calls made by the task */
  llmCalls?: number;
  /** Start time timestamp for elapsed time calculation */
  startTime?: number;
  /** Total tool calls count */
  toolCalls?: number;
}

interface TaskTitleProps {
  /** Agent info for avatar display */
  agent?: {
    avatar?: string;
    backgroundColor?: string | null;
    id?: string | null;
  };
  /** Metrics to display (LLM calls, tool calls, elapsed time) */
  metrics?: TaskMetrics;
  status?: ThreadStatus;
  title?: string;
}

const TaskStatusIndicator = memo<{ status?: ThreadStatus }>(({ status }) => {
  const isCompleted = status === ThreadStatus.Completed;
  const isError = status === ThreadStatus.Failed || status === ThreadStatus.Cancel;
  const isProcessing = status ? isProcessingStatus(status) : false;
  const isInitializing = !status;

  let icon;

  if (isCompleted) {
    icon = <Icon color={cssVar.colorSuccess} icon={ListChecksIcon} />;
  } else if (isError) {
    icon = <Icon color={cssVar.colorError} icon={XIcon} />;
  } else if (isProcessing || isInitializing) {
    icon = <Spin size="small" variant="network" />;
  } else {
    return null;
  }

  return (
    <Block
      horizontal
      align={'center'}
      flex={'none'}
      gap={4}
      height={24}
      justify={'center'}
      variant={'outlined'}
      width={24}
      style={{
        fontSize: 12,
      }}
    >
      {icon}
    </Block>
  );
});

TaskStatusIndicator.displayName = 'TaskStatusIndicator';

interface MetricsDisplayProps {
  metrics: TaskMetrics;
  status?: ThreadStatus;
}

const MetricsDisplay = memo<MetricsDisplayProps>(({ metrics, status }) => {
  const { t } = useTranslation('chat');
  const { llmCalls, toolCalls, startTime, duration, isLoading } = metrics;
  const [elapsedTime, setElapsedTime] = useState(0);

  const isProcessing = status ? isProcessingStatus(status) : false;

  // Calculate initial elapsed time
  useEffect(() => {
    if (startTime && isProcessing) {
      setElapsedTime(Math.max(0, Date.now() - startTime));
    }
  }, [startTime, isProcessing]);

  // Timer for updating elapsed time every second (only when processing)
  useEffect(() => {
    if (!startTime || !isProcessing) return;

    const timer = setInterval(() => {
      setElapsedTime(Math.max(0, Date.now() - startTime));
    }, 1000);

    return () => clearInterval(timer);
  }, [startTime, isProcessing]);

  // Don't show metrics if loading or no data
  if (isLoading) return null;

  const hasLlmCalls = llmCalls !== undefined && llmCalls > 0;
  const hasToolCalls = toolCalls !== undefined && toolCalls > 0;
  const hasTime = isProcessing ? startTime !== undefined : duration !== undefined;

  // Don't render if no metrics to show
  if (!hasLlmCalls && !hasToolCalls && !hasTime) return null;

  return (
    <Flexbox horizontal align="center" gap={8}>
      {/* LLM calls */}
      {hasLlmCalls && (
        <Flexbox horizontal align="center" gap={2}>
          <Icon color={cssVar.colorTextTertiary} icon={BrainCircuit} size={12} />
          <Text fontSize={12} type="secondary">
            {llmCalls}
          </Text>
        </Flexbox>
      )}
      {/* Tool calls */}
      {hasToolCalls && (
        <Flexbox horizontal align="center" gap={2}>
          <Icon color={cssVar.colorTextTertiary} icon={Wrench} size={12} />
          <Text fontSize={12} type="secondary">
            {toolCalls}
          </Text>
        </Flexbox>
      )}
      {/* Time */}
      {hasTime && (
        <Text fontSize={12} type="secondary">
          {isProcessing
            ? formatElapsedTime(elapsedTime)
            : duration
              ? t('task.metrics.duration', { duration: formatDuration(duration) })
              : null}
        </Text>
      )}
    </Flexbox>
  );
});

MetricsDisplay.displayName = 'MetricsDisplay';

const TaskTitle = memo<TaskTitleProps>(({ title, status, metrics, agent }) => {
  return (
    <Flexbox horizontal align="center" gap={6}>
      <TaskStatusIndicator status={status} />
      {agent && (
        <AgentAvatar
          agentId={agent.id}
          avatar={agent.avatar}
          background={agent.backgroundColor || undefined}
          shape={'circle'}
          size={20}
        />
      )}
      <Text ellipsis fontSize={14}>
        {title}
      </Text>
      {metrics && <MetricsDisplay metrics={metrics} status={status} />}
    </Flexbox>
  );
});

TaskTitle.displayName = 'TaskTitle';

export default TaskTitle;
