import { Avatar, Flexbox, Grid, Text } from '@lobehub/ui';
import qs from 'query-string';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { type DiscoverGroupAgentItem } from '@/types/discover';

import Title from '../../../../../features/Title';
import { useDetailContext } from '../../DetailProvider';

const GroupAgentCard = memo<DiscoverGroupAgentItem>((item) => {
  const navigate = useNavigate();

  const handleClick = () => {
    if (!item.identifier) return;
    navigate(
      qs.stringifyUrl({
        url: urlJoin('/community/group_agent', item.identifier),
      }),
    );
  };

  return (
    <Flexbox
      gap={12}
      padding={16}
      style={{
        border: '1px solid var(--lobe-border-color)',
        borderRadius: 8,
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
      onClick={handleClick}
    >
      <Flexbox horizontal align="center" gap={12}>
        <Avatar avatar={item.avatar || item.title[0]} shape="square" size={48} />
        <Flexbox flex={1} gap={4}>
          <Text ellipsis style={{ fontWeight: 500 }}>
            {item.title}
          </Text>
          <Text ellipsis style={{ fontSize: 12, opacity: 0.65 }} type="secondary">
            {item.description}
          </Text>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

const Related = memo(() => {
  const { t } = useTranslation('discover');
  const { related = [], category } = useDetailContext();

  return (
    <Flexbox gap={16}>
      <Title
        more={t('groupAgents.details.related.more', { defaultValue: 'View More' })}
        moreLink={qs.stringifyUrl(
          {
            query: {
              category,
            },
            url: '/community/group_agent',
          },
          { skipNull: true },
        )}
      >
        {t('groupAgents.details.related.listTitle', { defaultValue: 'Related Group Agents' })}
      </Title>
      {related.length > 0 ? (
        <Grid rows={4}>
          {related.map((item) => (
            <GroupAgentCard key={item.identifier} {...item} />
          ))}
        </Grid>
      ) : (
        <Flexbox align="center" padding={32} style={{ color: '#999' }}>
          {t('groupAgents.details.related.empty', {
            defaultValue: 'No related group agents found',
          })}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default Related;
