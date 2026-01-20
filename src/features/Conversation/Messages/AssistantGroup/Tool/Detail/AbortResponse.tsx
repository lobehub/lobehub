import { Alert } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const AbortResponse = memo(() => {
  const { t } = useTranslation('chat');

  return <Alert title={t('tool.intervention.toolAbort')} type={'secondary'} />;
});

export default AbortResponse;
