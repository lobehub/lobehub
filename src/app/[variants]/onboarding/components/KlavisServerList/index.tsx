'use client';

import { Grid, ScrollShadow } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { KLAVIS_SERVER_TYPES } from '@/const/index';
import { useToolStore } from '@/store/tool';
import { klavisStoreSelectors } from '@/store/tool/slices/klavisStore';

import KlavisServerItem from './components/KlavisServerItem';

const KlavisServerList = memo(() => {
  const allKlavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);
  const useFetchUserKlavisServers = useToolStore((s) => s.useFetchUserKlavisServers);

  useFetchUserKlavisServers(true);

  const getServerByIdentifier = (identifier: string) => {
    return allKlavisServers.find((server) => server.identifier === identifier);
  };

  return (
    <ScrollShadow height={'33vh'} offset={8} size={12}>
      <Grid gap={8} maxItemWidth={120} rows={2}>
        {KLAVIS_SERVER_TYPES.map((type) => (
          <KlavisServerItem
            icon={type.icon}
            identifier={type.identifier}
            key={type.identifier}
            label={type.label}
            server={getServerByIdentifier(type.identifier)}
            serverName={type.serverName}
          />
        ))}
      </Grid>
    </ScrollShadow>
  );
});

KlavisServerList.displayName = 'KlavisServerList';

export default KlavisServerList;
