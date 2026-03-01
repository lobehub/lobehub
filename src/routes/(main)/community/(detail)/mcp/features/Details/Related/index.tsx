import { Flexbox } from '@lobehub/ui';
import qs from 'query-string';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailContext } from '@/features/MCPPluginDetail/DetailProvider';

import McpList from '../../../../../(list)/mcp/features/List';
import Title from '../../../../../features/Title';

const Related = memo(() => {
  const { t } = useTranslation('discover');
  const { related, category } = useDetailContext();
  return (
    <Flexbox gap={16}>
      <Title
        more={t('mcp.details.related.more')}
        moreLink={qs.stringifyUrl({
          query: {
            category,
          },
          url: '/community/mcp',
        })}
      >
        {t('mcp.details.related.listTitle')}
      </Title>
      <McpList data={related} />
    </Flexbox>
  );
});

export default Related;
