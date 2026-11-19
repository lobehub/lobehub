import { Button, Tooltip } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { openConnectorEditDrawer } from '@/features/Connectors/CustomConnectorModal/imperative';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

import { useConnectorConfigureGate } from './useConnectorConfigureGate';

/**
 * Configure for a marketplace MCP installed as a connector, gated by
 * {@link useConnectorConfigureGate}. Mounted only for such rows, so the manage
 * policy is not read for every plugin row.
 */
const ConnectorConfigureButton = memo<{ canEdit: boolean; connector: ConnectorWithTools }>(
  ({ canEdit, connector }) => {
    const { t } = useTranslation('plugin');
    const { allowed, deniedTitle } = useConnectorConfigureGate(connector, canEdit);

    const button = (
      <Button
        disabled={!allowed}
        onClick={() => {
          if (allowed) openConnectorEditDrawer(connector.id);
        }}
      >
        {t('store.actions.configure')}
      </Button>
    );

    // A disabled button fires no pointer events: the tooltip needs a wrapper.
    return deniedTitle ? (
      <Tooltip title={deniedTitle}>
        <span style={{ display: 'inline-flex' }}>{button}</span>
      </Tooltip>
    ) : (
      button
    );
  },
);

ConnectorConfigureButton.displayName = 'ConnectorConfigureButton';

export default ConnectorConfigureButton;
