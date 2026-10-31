'use client';

import { type TaskDetail } from '@lobechat/types';
import { Flexbox, Spin, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BrainCircuit, Timer, Wrench } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { sx } from '@/styles/sx';

import { MAX_PROGRESS, PROGRESS_INCREMENT, PROGRESS_INTERVAL } from './constants';
import { formatElapsedTime, formatToolName } from './utils';

const shimmer = stylex.keyframes({
  '0%': { transform: 'translateX(-100%)' },
  '100%': { transform: 'translateX(100%)' },
});

const styles = stylex.create({
  activityRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '8px',
  },
  footer: {
    paddingBlockStart: '8px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  progress: {
    position: 'relative',
    overflow: 'hidden',
    height: '3px',
    marginBlock: '12px',
    marginInline: '8px',
    borderRadius: '2px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  progressBar: {
    position: 'absolute',
    insetBlockStart: 0,
    insetInlineStart: 0,
    height: '100%',
    borderRadius: '2px',
    backgroundImage: `linear-gradient(90deg, ${cssVar.colorPrimary}, ${cssVar.colorPrimaryHover})`,
    transition: 'width 0.5s ease-out',
  },
  progressCompact: {
    position: 'relative',
    overflow: 'hidden',
    height: '3px',
    borderRadius: '2px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  progressShimmer: {
    position: 'absolute',
    insetBlockStart: 0,
    insetInlineStart: 0,
    display: { 'default': null, '@media (prefers-reduced-motion: reduce)': 'none' },
    width: '100%',
    height: '100%',
    backgroundImage: `linear-gradient(90deg, transparent, ${cssVar.colorPrimaryBgHover}, transparent)`,
    animationName: shimmer,
    animationDuration: '2s',
    animationIterationCount: 'infinite',
  },
  separator: {
    width: '3px',
    height: '3px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorTextQuaternary,
    backgroundImage: 'none',
  },
});

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
            <div {...stylex.props(styles.activityRow)}>
              <Flexbox horizontal align={'center'} gap={4}>
                <Spin size="small" variant="network" />
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
          <div {...stylex.props(styles.progress)}>
            <div {...sx([styles.progressBar], undefined, { width: `${progress}%` })} />
            <div {...stylex.props(styles.progressShimmer)} />
          </div>

          {/* Footer with metrics */}
          <Flexbox
            horizontal
            align="center"
            className={stylex.props(styles.footer).className}
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
              {/* LLM calls (`totalSteps` holds the LLM-call total) */}
              {totalSteps !== undefined && totalSteps > 0 && (
                <Text as={'span'} fontSize={12} type={'secondary'}>
                  <BrainCircuit size={12} />
                  <Text as={'span'} fontSize={12} type={'secondary'} weight={500}>
                    {totalSteps}
                  </Text>
                  <span>{t('task.metrics.llmCallsShort')}</span>
                </Text>
              )}
              {/* Tool Calls */}
              {totalToolCalls !== undefined && totalToolCalls > 0 && (
                <>
                  {hasMetrics && totalSteps !== undefined && totalSteps > 0 && (
                    <div {...stylex.props(styles.separator)} />
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
            <Spin size="small" variant="network" />
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
        <div {...stylex.props(styles.progressCompact)}>
          <div {...sx([styles.progressBar], undefined, { width: `${progress}%` })} />
          <div {...stylex.props(styles.progressShimmer)} />
        </div>

        {/* Footer with metrics */}
        {hasMetrics && (
          <Flexbox
            horizontal
            align="center"
            className={stylex.props(styles.footer).className}
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
                  <BrainCircuit size={12} />
                  <Text as={'span'} fontSize={12} type={'secondary'} weight={500}>
                    {totalSteps}
                  </Text>
                  <span>{t('task.metrics.llmCallsShort')}</span>
                </Text>
              )}
              {totalToolCalls !== undefined && totalToolCalls > 0 && (
                <>
                  {totalSteps !== undefined && totalSteps > 0 && (
                    <div {...stylex.props(styles.separator)} />
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
