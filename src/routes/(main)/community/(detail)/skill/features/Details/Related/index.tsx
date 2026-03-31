'use client';

import { Flexbox } from '@lobehub/ui';
import qs from 'query-string';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import List from '../../../../../(list)/skill/features/List';
import Title from '../../../../../components/Title';
import { useDetailContext } from '../../DetailProvider';

const Related = memo(() => {
  const { t } = useTranslation('discover');
  const { related, category } = useDetailContext();

  return (
    <Flexbox gap={16}>
      <Title
        more={t('skills.details.related.more')}
        moreLink={qs.stringifyUrl({
          query: { category },
          url: '/community/skill',
        })}
      >
        {t('skills.details.related.listTitle')}
      </Title>
      <List data={related} />
    </Flexbox>
  );
});

export default Related;
