import { ActionIcon } from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

import AddConnectorModal from '../AddConnectorModal';
import ConnectorItem from './ConnectorItem';

interface ConnectorListProps {
  onSelect: (id: string) => void;
  selectedId?: string;
}

const ConnectorList = memo<ConnectorListProps>(({ onSelect, selectedId }) => {
  const { t } = useTranslation('tool');
  const [showAdd, setShowAdd] = useState(false);
  // The tenant's connector policy can turn custom connectors off (the server rejects them too).
  const customConnectorsDisabled = useServerConfigStore(
    serverConfigSelectors.disableCustomConnectors,
  );

  const connected = useToolStore(connectorSelectors.connectedConnectors);
  const notConnected = useToolStore(connectorSelectors.notConnectedConnectors);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0' }}>
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          padding: '0 12px 4px',
        }}
      >
        <span style={{ fontWeight: 600 }}>{t('connector.title', 'Connectors')}</span>
        {!customConnectorsDisabled && (
          <ActionIcon icon={PlusIcon} size="small" onClick={() => setShowAdd(true)} />
        )}
      </div>

      {connected.length > 0 && (
        <div>
          <div
            style={{ color: 'var(--lobe-colors-neutral-500)', fontSize: 12, padding: '4px 12px' }}
          >
            {t('connector.connected', 'Connected')}
          </div>
          {connected.map((c) => (
            <ConnectorItem
              active={c.id === selectedId}
              connector={c}
              key={c.id}
              onClick={() => onSelect(c.id)}
            />
          ))}
        </div>
      )}

      {notConnected.length > 0 && (
        <div>
          <div
            style={{ color: 'var(--lobe-colors-neutral-500)', fontSize: 12, padding: '4px 12px' }}
          >
            {t('connector.notConnected', 'Not connected')}
          </div>
          {notConnected.map((c) => (
            <ConnectorItem
              active={c.id === selectedId}
              connector={c}
              key={c.id}
              onClick={() => onSelect(c.id)}
            />
          ))}
        </div>
      )}

      {!customConnectorsDisabled && (
        <AddConnectorModal open={showAdd} onClose={() => setShowAdd(false)} />
      )}
    </div>
  );
});

ConnectorList.displayName = 'ConnectorList';

export default ConnectorList;
