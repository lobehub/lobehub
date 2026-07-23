import { HETEROGENEOUS_TYPE_LABELS } from '@lobechat/heterogeneous-agents';
import { Flexbox } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BubblesLoading from '@/components/BubblesLoading';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { type OperationType, type StreamRetryMetadata } from '@/store/chat/slices/operation/types';
import { elapsedTimeStyles, shinyTextStyles } from '@/styles/loading';

import { resolveOperationActivity } from '../../utils/operationActivity';

const ELAPSED_TIME_THRESHOLD = 2100; // Show elapsed time after 2 seconds

const NO_NEED_SHOW_DOT_OP_TYPES = new Set<OperationType>(['reasoning']);

// Container/runtime ops carry their own user-facing `operation.*` copy.
// Everything else is an internal/bookkeeping op without a dedicated key, so it
// routes through the shared activity mapping instead of leaking the raw key.
const DEDICATED_OPERATION_LABELS = new Set<OperationType>([
  'execAgentRuntime',
  'execClientSubAgent',
  'execServerAgentRuntime',
  'sendMessage',
]);

interface ContentLoadingProps {
  id: string;
  /**
   * Anchor the elapsed-time counter to this timestamp instead of the operation's
   * startTime. The operation's startTime marks the whole run's beginning (the run-
   * start assistant message), so a tail indicator sitting after several completed
   * steps would count the entire run. Passing the last message's `createdAt` here
   * makes the counter reflect "time since the last step" instead.
   */
  startTime?: number;
}

const ContentLoading = memo<ContentLoadingProps>(({ id, startTime: startTimeOverride }) => {
  const { t } = useTranslation('chat');
  const runningOp = useChatStore(operationSelectors.getDeepestRunningOperationByMessage(id));

  const startTime =
    startTimeOverride !== undefined && Number.isFinite(startTimeOverride)
      ? startTimeOverride
      : runningOp?.metadata?.startTime;
  const operationType = runningOp?.type as OperationType | undefined;

  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    startTime ? Math.floor((Date.now() - startTime) / 1000) : 0,
  );

  useEffect(() => {
    if (!startTime) {
      setElapsedSeconds(0);
      return;
    }

    const updateElapsed = () => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  // Heterogeneous agents interpolate their display name (e.g. "Claude Code is running")
  // so the user can tell which external agent is working.
  const getHeterogeneousAgentName = () => {
    const heterogeneousType = runningOp?.metadata?.heterogeneousType as string | undefined;
    return heterogeneousType
      ? (HETEROGENEOUS_TYPE_LABELS[heterogeneousType] ?? heterogeneousType)
      : t('operation.heterogeneousAgentFallback');
  };

  const getRetryStatusText = (retry: StreamRetryMetadata) => {
    const parts = [
      typeof retry.errorStatus === 'number' ? String(retry.errorStatus) : undefined,
      retry.error,
    ].filter(Boolean);
    return parts.join(' ') || t('operation.streamRetry.unknownStatus');
  };

  const getStreamRetryLabel = () => {
    const retry = runningOp?.metadata?.streamRetry;
    if (!retry) return undefined;

    const name = getHeterogeneousAgentName();
    const status = getRetryStatusText(retry);

    if (
      typeof retry.attempt === 'number' &&
      Number.isFinite(retry.attempt) &&
      typeof retry.maxAttempts === 'number' &&
      Number.isFinite(retry.maxAttempts)
    ) {
      return t('operation.streamRetry.withAttempt', {
        attempt: retry.attempt,
        maxAttempts: retry.maxAttempts,
        name,
        status,
      });
    }

    return t('operation.streamRetry', { name, status });
  };

  const getOperationLabel = () => {
    if (!operationType) return undefined;

    if (operationType === 'execHeterogeneousAgent') {
      return t('operation.execHeterogeneousAgent', { name: getHeterogeneousAgentName() });
    }

    if (DEDICATED_OPERATION_LABELS.has(operationType)) {
      return t(`operation.${operationType}` as any) as string;
    }

    // Internal/bookkeeping ops (toolCalling, callLLM, executeToolCall, ...) have
    // no `operation.*` copy. Reuse the localized op-status-tray phase label so we
    // never fall back to the raw i18n key. Unmappable container ops return
    // undefined and render the generic dot loader below.
    const activity = resolveOperationActivity(operationType);
    if (activity) return t(`opStatusTray.status.${activity}`);

    return undefined;
  };
  const streamRetryLabel = getStreamRetryLabel();
  const operationLabel = streamRetryLabel ?? getOperationLabel();
  const operationLabelClassName = streamRetryLabel
    ? shinyTextStyles.errorText
    : shinyTextStyles.shinyText;

  const showElapsedTime = elapsedSeconds >= ELAPSED_TIME_THRESHOLD / 1000;

  if (!runningOp) return null;

  if (operationType && NO_NEED_SHOW_DOT_OP_TYPES.has(operationType)) return null;

  if (operationType === 'contextCompression') {
    return (
      <Flexbox horizontal align={'center'} gap={8}>
        <NeuralNetworkLoading size={16} />
        <span className={shinyTextStyles.shinyText}>{t('operation.contextCompression')}</span>
      </Flexbox>
    );
  }

  if (operationLabel) {
    return (
      <Flexbox horizontal align={'center'} gap={4}>
        <span className={operationLabelClassName}>{operationLabel}...</span>
        {showElapsedTime && (
          <span className={elapsedTimeStyles.elapsedTime}>({elapsedSeconds}s)</span>
        )}
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align={'center'}>
      <BubblesLoading />
    </Flexbox>
  );
});

export default ContentLoading;
