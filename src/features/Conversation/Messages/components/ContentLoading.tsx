import { Flexbox, Text } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BubblesLoading from '@/components/BubblesLoading';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { type OperationType } from '@/store/chat/slices/operation/types';
import { shinyTextStyles } from '@/styles/loading';

const ELAPSED_TIME_THRESHOLD = 2100; // Show elapsed time after 2 seconds

const NO_NEED_SHOW_DOT_OP_TYPES = new Set<OperationType>(['reasoning']);

interface ContentLoadingProps {
  id: string;
}

const ContentLoading = memo<ContentLoadingProps>(({ id }) => {
  const { t } = useTranslation('chat');
  const runningOp = useChatStore(operationSelectors.getDeepestRunningOperationByMessage(id));

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [startTime, setStartTime] = useState(runningOp?.metadata?.startTime);

  const operationType = runningOp?.type as OperationType | undefined;

  // Track elapsed time, reset when operation type changes
  useEffect(() => {
    if (!startTime) {
      setElapsedSeconds(0);
      return;
    }

    const updateElapsed = () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedSeconds(elapsed);
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  useEffect(() => {
    setElapsedSeconds(0);
    setStartTime(Date.now());
  }, [operationType, id]);

  // Get localized label based on operation type
  const operationLabel = operationType
    ? (t(`operation.${operationType}` as any) as string)
    : undefined;

  const showElapsedTime = elapsedSeconds >= ELAPSED_TIME_THRESHOLD / 1000;

  if (operationType && NO_NEED_SHOW_DOT_OP_TYPES.has(operationType)) return null;

  if (operationType === 'contextCompression') {
    return (
      <Flexbox horizontal align={'center'} gap={8}>
        <NeuralNetworkLoading size={16} />
        <span className={shinyTextStyles.shinyText}>{t('operation.contextCompression')}</span>
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align={'center'}>
      <BubblesLoading />
      {operationLabel && (
        <Text type={'secondary'}>
          {operationLabel}...
          {showElapsedTime && ` (${elapsedSeconds}s)`}
        </Text>
      )}
    </Flexbox>
  );
});

export default ContentLoading;
