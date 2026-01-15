import { Flexbox, Text } from '@lobehub/ui';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import BubblesLoading from '@/components/BubblesLoading';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import type { OperationType } from '@/store/chat/slices/operation/types';
import { dotLoading } from '@/styles/loading';

interface ContentLoadingProps {
  id: string;
}

const ContentLoading = memo<ContentLoadingProps>(({ id }) => {
  const { t } = useTranslation('chat');
  const operations = useChatStore(operationSelectors.getOperationsByMessage(id));

  // Get the running operation's type
  const runningOp = operations.find((op) => op.status === 'running');
  const operationType = runningOp?.type as OperationType | undefined;

  // Get localized label based on operation type
  const operationLabel = operationType
    ? (t(`operation.${operationType}` as any) as string)
    : undefined;

  return (
    <Flexbox align={'center'} horizontal>
      <BubblesLoading />
      {operationLabel && (
        <Text className={cx(dotLoading)} type={'secondary'}>
          {operationLabel}
        </Text>
      )}
    </Flexbox>
  );
});

export default ContentLoading;
