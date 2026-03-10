import { Flexbox } from '@lobehub/ui';
import qs from 'query-string';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import urlJoin from 'url-join';

import { useQuery } from '@/hooks/useQuery';
import { type AssistantMarketSource } from '@/types/discover';

import Title from '../../../../../features/Title';
import { useDetailContext } from '../../DetailProvider';
import Item from './Item';

const Related = memo(() => {
  const { t } = useTranslation('discover');
  const { related, category } = useDetailContext();
  const { source } = useQuery() as { source?: AssistantMarketSource };
  const marketSource = source === 'legacy' ? 'legacy' : undefined;

  return (
    <Flexbox gap={16}>
      <Title
        more={t('assistants.details.related.more')}
        moreLink={qs.stringifyUrl(
          {
            query: {
              category,
              source: marketSource,
            },
            url: '/community/agent',
          },
          { skipNull: true },
        )}
      >
        {t('assistants.details.related.listTitle')}
      </Title>
      <Flexbox gap={8}>
        {related?.map((item, index) => {
          const link = qs.stringifyUrl(
            {
              query: marketSource ? { source: marketSource } : undefined,
              url: urlJoin('/community/agent', item.identifier),
            },
            { skipNull: true },
          );
          return (
            <Link key={index} style={{ color: 'inherit', overflow: 'hidden' }} to={link}>
              <Item {...item} />
            </Link>
          );
        })}
      </Flexbox>
    </Flexbox>
  );
});

export default Related;
