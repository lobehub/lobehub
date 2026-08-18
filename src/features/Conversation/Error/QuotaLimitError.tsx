import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import BaseErrorForm from '@/features/Conversation/Error/BaseErrorForm';

import { useRetryParentMessage } from './useRetryParentMessage';

interface QuotaLimitErrorProps {
  id: string;
  /**
   * Retry resolved by the render surface. Preferred over the parent-message
   * fallback because on the group surface `id` is a nested content block, whose
   * parent is another block rather than the user message.
   */
  onRetry?: () => void;
}

const QuotaLimitError = memo<QuotaLimitErrorProps>(({ id, onRetry }) => {
  const { t } = useTranslation('error');
  const { disabled, loading, retryParentMessage } = useRetryParentMessage(id);

  return (
    <BaseErrorForm
      avatar={<Icon icon={AlertTriangle} size={24} />}
      title={t('response.QuotaLimitReachedCloud')}
      action={
        <Button
          disabled={onRetry ? false : disabled}
          icon={<Icon icon={RotateCw} />}
          loading={loading}
          size={'small'}
          type={'primary'}
          onClick={() => (onRetry ? onRetry() : retryParentMessage())}
        >
          {t('unknownError.retry')}
        </Button>
      }
    />
  );
});

export default QuotaLimitError;
