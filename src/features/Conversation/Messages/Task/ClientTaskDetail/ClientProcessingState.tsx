'use client';

import { type TaskDetail } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, keyframes } from 'antd-style';
import { Footprints, Timer, Wrench } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import { MAX_PROGRESS, PROGRESS_INCREMENT, PROGRESS_INTERVAL } from '../../Tasks/shared/constants';
import { formatElapsedTime } from '../../Tasks/shared/utils';

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

export type ClientProcessingStateVariant = 'detail' | 'compact';

interface ClientProcessingStateProps {
  messageId: string;
  taskDetail: TaskDetail;
  variant?: ClientProcessingStateVariant;
}

/**
 * ClientProcessingState - Processing state for client-mode tasks
 *
 * Unlike server-side ProcessingState, this component does NOT poll for status
 * since the task is executed locally on the client (desktop).
 * Status updates come from the local execution context.
 */
const ClientProcessingState = memo<ClientProcessingStateProps>(
  ({ taskDetail, variant = 'detail' }) => {
    const { t } = useTranslation('chat');
    const [progress, setProgress] = useState(5);
    const [elapsedTime, setElapsedTime] = useState(0);

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

    const hasMetrics =
      startedAt ||
      (totalSteps !== undefined && totalSteps > 0) ||
      (totalToolCalls !== undefined && totalToolCalls > 0);

    // Detail variant: Task version layout
    if (variant === 'detail') {
      return (
        <Flexbox>
          {/* Activity indicator */}
          <div className={styles.activityRow}>
            <Flexbox align={'center'} gap={4} horizontal>
              <NeuralNetworkLoading size={14} />
              <Text as={'span'} fontSize={12} type={'secondary'}>
                {t('task.activity.clientExecuting')}
              </Text>
            </Flexbox>
          </div>

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
                <Text as={'span'} fontSize={12} type={'secondary'}>
                  <Timer size={12} />
                  <Text as={'span'} fontSize={12} type={'secondary'} weight={500}>
                    {formatElapsedTime(elapsedTime)}
                  </Text>
                </Text>
              )}
            </Flexbox>
            <Flexbox align="center" gap={12} horizontal>
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

    // Compact variant: Tasks version layout
    return (
      <Flexbox gap={8}>
        {/* Activity indicator */}
        <Flexbox align="center" gap={8} horizontal>
          <NeuralNetworkLoading size={14} />
          <Text
            as={'span'}
            ellipsis
            fontSize={12}
            style={{ whiteSpace: 'nowrap' }}
            type={'secondary'}
          >
            {t('task.activity.clientExecuting')}
          </Text>
        </Flexbox>

        {/* Progress Bar */}
        <div className={styles.progressCompact}>
          <div className={styles.progressBar} style={{ width: `${progress}%` }} />
          <div className={styles.progressShimmer} />
        </div>

        {/* Footer with metrics */}
        {hasMetrics && (
          <Flexbox
            align="center"
            className={styles.footer}
            gap={12}
            horizontal
            justify="space-between"
            wrap="wrap"
          >
            {/* Left side: Elapsed Time */}
            <Flexbox align="center" gap={8} horizontal>
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
            <Flexbox align="center" gap={12} horizontal>
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

ClientProcessingState.displayName = 'ClientProcessingState';

export default ClientProcessingState;
