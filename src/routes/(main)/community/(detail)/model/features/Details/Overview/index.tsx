import { Flexbox, Tag } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Title from '../../../../../features/Title';
import { useDetailContext } from '../../DetailProvider';
import ProviderList from './ProviderList';

const Overview = memo(() => {
  const { t } = useTranslation('discover');
  const { providers = [] } = useDetailContext();

  return (
    <Flexbox gap={16}>
      <Title tag={<Tag>{providers.length}</Tag>}>{t('models.supportedProviders')}</Title>
      <ProviderList />
    </Flexbox>
  );
});

export default Overview;
