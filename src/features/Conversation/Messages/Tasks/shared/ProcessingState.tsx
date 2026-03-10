'use client';

import { type TaskDetail } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, keyframes } from 'antd-style';
import { Footprints, Timer, Wrench } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useChatStore } from '@/store/chat';

import { MAX_PROGRESS, PROGRESS_INCREMENT, PROGRESS_INTERVAL } from './constants';
import { formatElapsedTime, formatToolName } from './utils';

const shimmer = keyframes`
  0% {
    transform: translateX(-100%);
  }

  100% {
    transform: translateX(100%);
  }
`;

const styles = createStaticStyles(({ css, cssVar }) => ({
  activityRow: css`
    display: flex;
    gap: 8px;
    align-items: center;
    padding-block: 8px;
  `,
  footer: css`
    padding-block-start: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  progress: css`
    position: relative;

    overflow: hidden;

    height: 3px;
    margin-block: 12px;
    margin-inline: 8px;
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
  progressCompact: css`
    position: relative;

    overflow: hidden;

    height: 3px;
    border-radius: 2px;

    background: ${cssVar.colorFillSecondary};
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
}));

export type ProcessingStateVariant = 'detail' | 'compact';

interface ProcessingStateProps {
  /**
   * Message ID for updating task status in store
   */
  messageId: string;
  taskDetail: TaskDetail;
  variant?: ProcessingStateVariant;
}

const ProcessingState = memo<ProcessingStateProps>(
  ({ taskDetail, messageId, variant = 'detail' }) => {
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

    // Render current activity text
    const renderActivityText = () => {
      if (!currentActivity) return null;

      switch (currentActivity.type) {
        case 'tool_calling': {
          const toolName = formatToolName(currentActivity);
          return toolName
            ? t('task.activity.toolCalling', { toolName })
            : t('task.activity.calling');
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

    const hasMetrics =
      startedAt ||
      (totalSteps !== undefined && totalSteps > 0) ||
      (totalToolCalls !== undefined && totalToolCalls > 0);

    // Detail variant: Task version layout (activity row with content preview)
    if (variant === 'detail') {
      return (
        <Flexbox>
          {/* Current Activity */}
          {currentActivity && (
            <div className={styles.activityRow}>
              <Flexbox horizontal align={'center'} gap={4}>
                <NeuralNetworkLoading size={14} />
                <Text as={'span'} fontSize={12} type={'secondary'}>
                  {renderActivityText()}
                </Text>
              </Flexbox>
              {currentActivity.contentPreview && (
                <Text
                  ellipsis
                  as={'span'}
                  fontSize={12}
                  style={{ whiteSpace: 'nowrap' }}
                  type={'secondary'}
                >
                  {currentActivity.contentPreview}
                </Text>
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
            horizontal
            align="center"
            className={styles.footer}
            gap={12}
            justify={'space-between'}
            wrap="wrap"
          >
            <Flexbox horizontal align="center" gap={12}>
              {/* Elapsed Time */}
              {startedAt && (
                <Text as={'span'} fontSize={12} type={'secondary'}>
                  <Timer size={12} />
                  <Text as={'span'} fontSize={12} type={'secondary'} weight={500}>
                    {formatElapsedTime(elapsedTime)}
                  </Text>
                </Text>
              )}
            </Flexbox>
            <Flexbox horizontal align="center" gap={12}>
              {/* Steps */}
              {totalSteps !== undefined && totalSteps > 0 && (
                <Text as={'span'} fontSize={12} type={'secondary'}>
                  <Footprints size={12} />
                  <Text as={'span'} fontSize={12} type={'secondary'} weight={500}>
                    {totalSteps}
                  </Text>
                  <span>{t('task.metrics.stepsShort')}</span>
                </Text>
              )}
              {/* Tool Calls */}
              {totalToolCalls !== undefined && totalToolCalls > 0 && (
                <>
                  {hasMetrics && totalSteps !== undefined && totalSteps > 0 && (
                    <div className={styles.separator} />
                  )}
                  <Text as={'span'} fontSize={12} type={'secondary'}>
                    <Wrench size={12} />
                    <Text as={'span'} fontSize={12} type={'secondary'} weight={500}>
                      {totalToolCalls}
                    </Text>
                    <span>{t('task.metrics.toolCallsShort')}</span>
                  </Text>
                </>
              )}
            </Flexbox>
          </Flexbox>
        </Flexbox>
      );
    }

    // Compact variant: Tasks version layout (simplified activity, no content preview)
    return (
      <Flexbox gap={8}>
        {/* Current Activity */}
        {currentActivity && (
          <Flexbox horizontal align="center" gap={8}>
            <NeuralNetworkLoading size={14} />
            <Text
              ellipsis
              as={'span'}
              fontSize={12}
              style={{ whiteSpace: 'nowrap' }}
              type={'secondary'}
            >
              {renderActivityText()}
            </Text>
          </Flexbox>
        )}

        {/* Progress Bar */}
        <div className={styles.progressCompact}>
          <div className={styles.progressBar} style={{ width: `${progress}%` }} />
          <div className={styles.progressShimmer} />
        </div>

        {/* Footer with metrics */}
        {hasMetrics && (
          <Flexbox
            horizontal
            align="center"
            className={styles.footer}
            gap={12}
            justify="space-between"
            wrap="wrap"
          >
            {/* Left side: Elapsed Time */}
            <Flexbox horizontal align="center" gap={8}>
              {startedAt && (
                <Text as={'span'} fontSize={12} type={'secondary'}>
                  <Timer size={12} />
                  <Text as={'span'} fontSize={12} type={'secondary'} weight={500}>
                    {formatElapsedTime(elapsedTime)}
                  </Text>
                </Text>
              )}
            </Flexbox>

            {/* Right side: Steps, Tool Calls */}
            <Flexbox horizontal align="center" gap={12}>
              {totalSteps !== undefined && totalSteps > 0 && (
                <Text as={'span'} fontSize={12} type={'secondary'}>
                  <Footprints size={12} />
                  <Text as={'span'} fontSize={12} type={'secondary'} weight={500}>
                    {totalSteps}
                  </Text>
                  <span>{t('task.metrics.stepsShort')}</span>
                </Text>
              )}
              {totalToolCalls !== undefined && totalToolCalls > 0 && (
                <>
                  {totalSteps !== undefined && totalSteps > 0 && (
                    <div className={styles.separator} />
                  )}
                  <Text as={'span'} fontSize={12} type={'secondary'}>
                    <Wrench size={12} />
                    <Text as={'span'} fontSize={12} type={'secondary'} weight={500}>
                      {totalToolCalls}
                    </Text>
                    <span>{t('task.metrics.toolCallsShort')}</span>
                  </Text>
                </>
              )}
            </Flexbox>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

ProcessingState.displayName = 'ProcessingState';

export default ProcessingState;
