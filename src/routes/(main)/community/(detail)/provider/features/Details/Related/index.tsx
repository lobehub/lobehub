import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import List from '../../../../../(list)/provider/features/List';
import Title from '../../../../../features/Title';
import { useDetailContext } from '../../DetailProvider';

const Related = memo(() => {
  const { t } = useTranslation('discover');
  const { related } = useDetailContext();
  return (
    <Flexbox gap={16}>
      <Title more={t('assistants.details.related.more')} moreLink={'/community/provider'}>
        {t('assistants.details.related.listTitle')}
      </Title>
      <List data={related} rows={2} />
    </Flexbox>
  );
});

export default Related;
