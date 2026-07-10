import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import BaseErrorForm from '@/features/Conversation/Error/BaseErrorForm';

import { useRetryParentMessage } from './useRetryParentMessage';

interface QuotaLimitErrorProps {
  id: string;
}

const QuotaLimitError = memo<QuotaLimitErrorProps>(({ id }) => {
  const { t } = useTranslation('error');
  const { disabled, loading, retryParentMessage } = useRetryParentMessage(id);

  return (
    <BaseErrorForm
      avatar={<Icon icon={AlertTriangle} size={24} />}
      title={t('response.QuotaLimitReachedCloud')}
      action={
        <Button
          disabled={disabled}
          icon={<Icon icon={RotateCw} />}
          loading={loading}
          size={'small'}
          type={'primary'}
          onClick={() => retryParentMessage()}
        >
          {t('unknownError.retry')}
        </Button>
      }
    />
  );
});

export default QuotaLimitError;
