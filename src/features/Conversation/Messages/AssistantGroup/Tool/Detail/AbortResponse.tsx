import { Alert } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const AbortResponse = memo<{ sessionEnded?: boolean }>(({ sessionEnded }) => {
  const { t } = useTranslation('chat');

  return (
    <Alert
      title={t(sessionEnded ? 'tool.intervention.toolEnded' : 'tool.intervention.toolAbort')}
      type={'secondary'}
    />
  );
});

export default AbortResponse;
