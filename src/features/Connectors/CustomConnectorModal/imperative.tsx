'use client';

import { mountImperative } from '@/components/ImperativeMount';

import CustomConnectorModal from '.';

export const openConnectorEditDrawer = (connectorId: string) =>
  mountImperative(({ close, open }) => (
    <CustomConnectorModal
      connectorId={connectorId}
      open={open}
      onClose={close}
      onEditSuccess={close}
    />
  ));

/**
 * The picker's "Configure" action for a connector row. A market-hosted (cloud)
 * marketplace connector has no connection settings, so it gets none.
 */
export const getConnectorConfigureConfig = (connector: {
  id: string;
  mcpConnectionType: string | null;
}) =>
  connector.mcpConnectionType === 'cloud'
    ? undefined
    : { onConfigure: () => openConnectorEditDrawer(connector.id) };
