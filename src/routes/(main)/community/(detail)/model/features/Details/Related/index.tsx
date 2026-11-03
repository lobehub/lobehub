import { Flexbox } from '@lobehub/ui';
import qs from 'query-string';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import List from '../../../../../(list)/model/features/List';
import Title from '../../../../../features/Title';
import { useDetailContext } from '../../DetailProvider';

const Related = memo(() => {
  const { t } = useTranslation('discover');
  const { related, category } = useDetailContext();
  return (
    <Flexbox gap={16}>
      <Title
        more={t('assistants.details.related.more')}
        moreLink={qs.stringifyUrl({
          query: {
            category,
          },
          url: '/community/plugin',
        })}
      >
        {t('assistants.details.related.listTitle')}
      </Title>
      <List data={related} />
    </Flexbox>
  );
});

export default Related;
