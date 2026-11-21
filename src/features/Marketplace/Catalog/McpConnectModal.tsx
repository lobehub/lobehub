'use client';

import { createModal, Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { MarketMcpInstallActions } from '@/features/MCPPluginDetail/MarketMcpInstallActions';
import type { DiscoverMcpItem } from '@/types/discover';

type ConnectableMcp = Pick<DiscoverMcpItem, 'description' | 'haveCloudEndpoint' | 'identifier'>;

const McpConnectContent = ({ description, haveCloudEndpoint, identifier }: ConnectableMcp) => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox gap={16}>
      {description && <Text type={'secondary'}>{description}</Text>}
      <MarketMcpInstallActions
        actionLabel={t('connectorMarket.action.connect')}
        haveCloudEndpoint={haveCloudEndpoint}
        identifier={identifier}
      />
    </Flexbox>
  );
};

export const openMcpConnectModal = (
  { description, haveCloudEndpoint, identifier }: ConnectableMcp,
  title: string,
) =>
  createModal({
    content: (
      <McpConnectContent
        description={description}
        haveCloudEndpoint={haveCloudEndpoint}
        identifier={identifier}
      />
    ),
    footer: null,
    title,
    width: 520,
  });
