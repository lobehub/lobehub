'use client';

import { type TaskCurrentActivity, type TaskDetail } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, keyframes } from 'antd-style';
import { Footprints, Loader2, Timer, Wrench } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

const shimmer = keyframes`
  0% {
    transform: translateX(-100%);
  }

  100% {
    transform: translateX(100%);
  }
`;

const spin = keyframes`
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
`;

const styles = createStaticStyles(({ css, cssVar }) => ({
  activityContent: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  activityRow: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 16px;
  `,
  activityType: css`
    display: flex;
    flex-shrink: 0;
    gap: 4px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  footer: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  metricItem: css`
    display: flex;
    gap: 4px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  metricValue: css`
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  progress: css`
    position: relative;

    overflow: hidden;

    height: 3px;
    margin-block: 12px;
    margin-inline: 16px;
    border-radius: 2px;

    background: ${cssVar.colorFillSecondary};
  `,
  progressBar: css`
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;

    height: 100%;
    border-radius: 2px;

    background: linear-gradient(90deg, ${cssVar.colorPrimary}, ${cssVar.colorPrimaryHover});

    transition: width 0.5s ease-out;
  `,
  progressShimmer: css`
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;

    width: 100%;
    height: 100%;

    background: linear-gradient(90deg, transparent, ${cssVar.colorPrimaryBgHover}, transparent);

    animation: ${shimmer} 2s infinite;
  `,
  separator: css`
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: ${cssVar.colorTextQuaternary};
  `,
  spin: css`
    animation: ${spin} 1s linear infinite;
  `,
  statusIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 16px;
    height: 16px;
    border-radius: 50%;

    color: ${cssVar.colorPrimaryText};

    background: ${cssVar.colorPrimaryBg};
  `,
}));

interface ProcessingStateProps {
  /**
   * Message ID for updating task status in store
   */
  messageId: string;
  taskDetail: TaskDetail;
}

// Progress increases by 5% every 30 seconds, max 95%
const PROGRESS_INTERVAL = 30_000;
const PROGRESS_INCREMENT = 5;
const MAX_PROGRESS = 95;

// Format elapsed time as mm:ss or hh:mm:ss
const formatElapsedTime = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
};

// Format tool name from identifier and apiName
const formatToolName = (activity: TaskCurrentActivity): string => {
  if (activity.identifier && activity.apiName) {
    return `${activity.identifier}/${activity.apiName}`;
  }
  return activity.identifier || activity.apiName || '';
};

const ProcessingState = memo<ProcessingStateProps>(({ taskDetail, messageId }) => {
  const { t } = useTranslation('chat');
  const [progress, setProgress] = useState(5);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Get polling hook and check if there's an active operation polling
  const [useEnablePollingTaskStatus, operations] = useChatStore((s) => [
    s.useEnablePollingTaskStatus,
    s.operations,
  ]);

  // Check if exec_async_task is already polling for this message
  const hasActiveOperationPolling = Object.values(operations).some(
    (op) =>
      op.status === 'running' &&
      op.type === 'execAgentRuntime' &&
      op.context?.messageId === messageId,
  );

  // Enable polling only when no active operation is already polling
  // This handles the case when user refreshes page and exec_async_task is no longer running
  const { data } = useEnablePollingTaskStatus(
    taskDetail.threadId,
    messageId,
    !hasActiveOperationPolling,
  );

  const currentActivity = data?.currentActivity;
  const { totalToolCalls, totalSteps, startedAt } = taskDetail;

  // Calculate initial progress and elapsed time based on startedAt
  useEffect(() => {
    if (startedAt) {
      const startTime = new Date(startedAt).getTime();
      const elapsed = Math.max(0, Date.now() - startTime);
      const intervals = Math.floor(elapsed / PROGRESS_INTERVAL);
      const initialProgress = Math.min(5 + intervals * PROGRESS_INCREMENT, MAX_PROGRESS);
      setProgress(initialProgress);
      setElapsedTime(elapsed);
    }
  }, [startedAt]);

  // Timer for updating elapsed time every second
  useEffect(() => {
    if (!startedAt) return;

    const timer = setInterval(() => {
      const startTime = new Date(startedAt).getTime();
      setElapsedTime(Math.max(0, Date.now() - startTime));
    }, 1000);

    return () => clearInterval(timer);
  }, [startedAt]);

  // Progress timer - increment every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((prev) => Math.min(prev + PROGRESS_INCREMENT, MAX_PROGRESS));
    }, PROGRESS_INTERVAL);

    return () => clearInterval(timer);
  }, []);

  const hasMetrics = totalSteps || totalToolCalls;

  // Render current activity text
  const renderActivityText = () => {
    if (!currentActivity) return null;

    switch (currentActivity.type) {
      case 'tool_calling': {
        const toolName = formatToolName(currentActivity);
        return toolName ? t('task.activity.toolCalling', { toolName }) : t('task.activity.calling');
      }
      case 'tool_result': {
        const toolName = formatToolName(currentActivity);
        return toolName
          ? t('task.activity.toolResult', { toolName })
          : t('task.activity.gotResult');
      }
      case 'generating': {
        return t('task.activity.generating');
      }
      default: {
        return null;
      }
    }
  };

  return (
    <Flexbox>
      {/* Current Activity */}
      {currentActivity && (
        <div className={styles.activityRow}>
          <div className={styles.activityType}>
            <Loader2 className={styles.spin} size={12} />
            <span>{renderActivityText()}</span>
          </div>
          {currentActivity.contentPreview && (
            <span className={styles.activityContent}>{currentActivity.contentPreview}</span>
          )}
        </div>
      )}

      {/* Progress Bar */}
      <div className={styles.progress}>
        <div className={styles.progressBar} style={{ width: `${progress}%` }} />
        <div className={styles.progressShimmer} />
      </div>

      {/* Footer with metrics */}
      <Flexbox
        align="center"
        className={styles.footer}
        gap={12}
        horizontal
        justify={'space-between'}
        wrap="wrap"
      >
        <Flexbox align="center" gap={12} horizontal>
          {/* Elapsed Time */}
          {startedAt && (
            <div className={styles.metricItem}>
              <Timer size={12} />
              <span className={styles.metricValue}>{formatElapsedTime(elapsedTime)}</span>
            </div>
          )}
        </Flexbox>
        <Flexbox align="center" gap={12} horizontal>
          {/* Steps */}
          {totalSteps !== undefined && totalSteps > 0 && (
            <div className={styles.metricItem}>
              <Footprints size={12} />
              <span className={styles.metricValue}>{totalSteps}</span>
              <span>{t('task.metrics.stepsShort')}</span>
            </div>
          )}
          {/* Tool Calls */}
          {totalToolCalls !== undefined && totalToolCalls > 0 && (
            <>
              {hasMetrics && totalSteps !== undefined && totalSteps > 0 && (
                <div className={styles.separator} />
              )}
              <div className={styles.metricItem}>
                <Wrench size={12} />
                <span className={styles.metricValue}>{totalToolCalls}</span>
                <span>{t('task.metrics.toolCallsShort')}</span>
              </div>
            </>
          )}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

ProcessingState.displayName = 'ProcessingState';

export default ProcessingState;
