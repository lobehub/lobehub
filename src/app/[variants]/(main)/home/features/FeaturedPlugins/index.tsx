'use client';

import { MCP } from '@lobehub/icons';
import { ActionIcon, DropdownMenu, Grid } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { MoreHorizontal } from 'lucide-react';
import { memo,Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import GroupBlock from '../components/GroupBlock';
import GroupSkeleton from '../components/GroupSkeleton';
import { RECENT_BLOCK_SIZE } from '../const';
import FeaturedPluginsList from './List';

const FeaturedPlugins = memo(() => {
  const { t } = useTranslation('discover');
  const navigate = useNavigate();

  return (
    <GroupBlock
      icon={<MCP color={cssVar.colorTextDescription} size={18} />}
      title={t('home.featuredPlugins')}
      action={
        <DropdownMenu
          items={[
            {
              key: 'all-plugins',
              label: t('home.more'),
              onClick: () => {
                navigate('/community/mcp');
              },
            },
          ]}
        >
          <ActionIcon icon={MoreHorizontal} size="small" />
        </DropdownMenu>
      }
    >
      <Grid gap={12} maxItemWidth={320} rows={4} width={'100%'}>
        <Suspense
          fallback={
            <GroupSkeleton
              height={RECENT_BLOCK_SIZE.PLUGIN.HEIGHT}
              rows={6}
              width={RECENT_BLOCK_SIZE.PLUGIN.WIDTH}
            />
          }
        >
          <FeaturedPluginsList />
        </Suspense>
      </Grid>
    </GroupBlock>
  );
});

export default FeaturedPlugins;
