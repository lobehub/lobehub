// Fixture: a store action that reads from the server on every mount.
import { memo, useEffect } from 'react';

import { useToolStore } from '@/store/tool';

const ConnectorList = memo(() => {
  const connectors = useToolStore((s) => s.connectors);
  const fetchConnectors = useToolStore((s) => s.fetchConnectors);

  // alint-expect
  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  return (
    <ul>
      {connectors.map((connector) => (
        <li key={connector.id}>{connector.name}</li>
      ))}
    </ul>
  );
});

export default ConnectorList;
