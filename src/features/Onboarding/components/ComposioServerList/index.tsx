'use client';

import { Grid, ScrollShadow } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { COMPOSIO_APP_TYPES } from '@/const/index';
import { useToolStore } from '@/store/tool';
import { composioStoreSelectors } from '@/store/tool/slices/composioStore';

import ComposioServerItem from './components/ComposioServerItem';

const ComposioServerList = memo(() => {
  const allComposioServers = useToolStore(composioStoreSelectors.getServers, isEqual);
  const useFetchUserComposioConnections = useToolStore((s) => s.useFetchUserComposioConnections);

  useFetchUserComposioConnections(true);

  const getServerByIdentifier = (identifier: string) => {
    return allComposioServers.find((server) => server.identifier === identifier);
  };

  return (
    <ScrollShadow height={'33vh'} offset={8} size={12}>
      <Grid gap={8} maxItemWidth={120} rows={2}>
        {COMPOSIO_APP_TYPES.map((type) => (
          <ComposioServerItem
            appSlug={type.appSlug}
            icon={type.icon}
            identifier={type.identifier}
            key={type.identifier}
            label={type.label}
            server={getServerByIdentifier(type.identifier)}
          />
        ))}
      </Grid>
    </ScrollShadow>
  );
});

ComposioServerList.displayName = 'ComposioServerList';

export default ComposioServerList;
