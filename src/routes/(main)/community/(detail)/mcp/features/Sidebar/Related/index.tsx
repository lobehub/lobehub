import { Flexbox } from '@lobehub/ui';
import qs from 'query-string';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useDetailContext } from '@/features/MCPPluginDetail/DetailProvider';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import Title from '../../../../../features/Title';
import Item from './Item';

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
      <Flexbox gap={8}>
        {related?.map((item, index) => {
          const link = urlJoin('/community/mcp', item.identifier);
          return (
            <WorkspaceLink key={index} style={{ color: 'inherit', overflow: 'hidden' }} to={link}>
              <Item {...item} />
            </WorkspaceLink>
          );
        })}
      </Flexbox>
    </Flexbox>
  );
});

export default Related;
