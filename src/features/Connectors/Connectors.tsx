import { useEffect, useState } from 'react';

import { useToolStore } from '@/store/tool';

import ConnectorDetail from './ConnectorDetail';
import ConnectorList from './ConnectorList';

const Connectors = () => {
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const fetchConnectors = useToolStore((s) => s.fetchConnectors);
  const isInit = useToolStore((s) => s.isConnectorsInit);
  const connectors = useToolStore((s) => s.connectors);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  // Auto-select first connector
  useEffect(() => {
    if (!selectedId && connectors.length > 0) {
      setSelectedId(connectors[0].id);
    }
  }, [connectors, selectedId]);

  if (!isInit) return null;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div
        style={{
          borderRight: '1px solid var(--lobe-colors-border)',
          minWidth: 220,
          overflowY: 'auto',
          width: 220,
        }}
      >
        <ConnectorList selectedId={selectedId} onSelect={setSelectedId} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {selectedId && <ConnectorDetail connectorId={selectedId} />}
      </div>
    </div>
  );
};

export default Connectors;
