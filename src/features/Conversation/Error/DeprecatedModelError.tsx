import { Icon } from '@lobehub/ui';
import { AlertTriangle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import BaseErrorForm from '@/features/Conversation/Error/BaseErrorForm';

interface DeprecatedModelErrorProps {
  requestedModel?: string;
}

const DeprecatedModelError = memo<DeprecatedModelErrorProps>(({ requestedModel }) => {
  const { t } = useTranslation('error');

  return (
    <BaseErrorForm
      avatar={<Icon icon={AlertTriangle} size={24} />}
      title={t('fetchError.title')}
      desc={t('response.LobeHubModelDeprecated', {
        model: requestedModel ?? '-',
      })}
    />
  );
});

export default DeprecatedModelError;
