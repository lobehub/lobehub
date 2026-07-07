'use client';

import { Button } from '@lobehub/ui/base-ui';
import { NewAPIProviderCard } from 'model-bank/modelProviders';
import { useTranslation } from 'react-i18next';

import ProviderDetail from '../default';

const Page = () => {
  const { t } = useTranslation('modelProvider');

  return (
    <ProviderDetail
      {...NewAPIProviderCard}
      extra={
        <Button href={'/webapi/newapi/sso'} size={'small'} target={'_blank'}>
          {t('newapi.account.open')}
        </Button>
      }
      settings={{
        ...NewAPIProviderCard.settings,
        proxyUrl: false,
        showApiKey: false,
      }}
    />
  );
};

export default Page;
