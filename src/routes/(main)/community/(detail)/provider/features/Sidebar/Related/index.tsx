import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import Title from '../../../../../features/Title';
import { useDetailContext } from '../../DetailProvider';
import Item from './Item';

const Related = memo(() => {
  const { t } = useTranslation('discover');
  const { related } = useDetailContext();

  return (
    <Flexbox gap={16}>
      <Title more={t('providers.details.related.more')} moreLink={'/community/provider'}>
        {t('providers.details.related.listTitle')}
      </Title>
      <Flexbox gap={8}>
        {related?.map((item, index) => {
          const link = urlJoin('/community/provider', item.identifier);
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
