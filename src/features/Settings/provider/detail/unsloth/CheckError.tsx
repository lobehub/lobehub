import { BASE_PROVIDER_DOC_URL } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import type { CheckErrorRender } from '../../features/ProviderConfig/Checker';

export const CheckError: CheckErrorRender = ({ defaultError, error }) => {
  const { t } = useTranslation('modelProvider');

  if (!error) return defaultError;

  return (
    <Flexbox gap={8}>
      {defaultError}
      <Text type={'secondary'}>{t('unsloth.checker.guidance')}</Text>
      <a href={`${BASE_PROVIDER_DOC_URL}/unsloth`} rel={'noreferrer'} target={'_blank'}>
        {t('unsloth.checker.setupGuide')}
      </a>
    </Flexbox>
  );
};
