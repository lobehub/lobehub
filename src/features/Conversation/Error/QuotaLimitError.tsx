import { Icon } from '@lobehub/ui';
import { Button } from 'antd';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BaseErrorForm from '@/features/Conversation/Error/BaseErrorForm';
import { useConversationStore } from '@/features/Conversation/store';

interface QuotaLimitErrorProps {
  id: string;
}

const QuotaLimitError = memo<QuotaLimitErrorProps>(({ id }) => {
  const { t } = useTranslation('error');
  const [loading, setLoading] = useState(false);

  const regenerateUserMessage = useConversationStore((s) => s.regenerateUserMessage);
  const parentId = useConversationStore(
    (s) => s.displayMessages.find((m) => m.id === id)?.parentId,
  );

  const handleRetry = useCallback(async () => {
    if (!parentId) return;

    setLoading(true);
    try {
      await regenerateUserMessage(parentId);
    } finally {
      setLoading(false);
    }
  }, [parentId, regenerateUserMessage]);

  return (
    <BaseErrorForm
      avatar={<Icon icon={AlertTriangle} size={24} />}
      title={t('response.QuotaLimitReachedCloud')}
      action={
        <Button
          icon={<Icon icon={RotateCw} />}
          loading={loading}
          size={'small'}
          type={'primary'}
          onClick={handleRetry}
        >
          {t('unknownError.retry')}
        </Button>
      }
    />
  );
});

export default QuotaLimitError;
