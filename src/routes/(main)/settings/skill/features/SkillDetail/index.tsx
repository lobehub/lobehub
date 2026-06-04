'use client';

import { Skeleton } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';

import { ConnectorDetail } from '@/features/Connectors';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

export type ToolDetailType = 'builtin' | 'mcp-connector' | 'plugin';

interface SkillDetailProps {
  identifier: string;
  type: ToolDetailType;
}

/**
 * Right panel for the Settings > Skill master-detail layout.
 *
 * On mount, ensures a user_connectors entry exists for the selected tool
 * (auto-syncing from the manifest for builtins and plugins), then renders
 * the shared ConnectorDetail permission editor.
 */
const SkillDetail = memo<SkillDetailProps>(({ identifier, type }) => {
  const [syncing, setSyncing] = useState(false);

  const syncBuiltinTool = useToolStore((s) => s.syncBuiltinTool);
  const syncPluginTools = useToolStore((s) => s.syncPluginTools);
  const fetchConnectors = useToolStore((s) => s.fetchConnectors);
  const connector = useToolStore(connectorSelectors.connectorByIdentifier(identifier));

  useEffect(() => {
    const ensureConnector = async () => {
      setSyncing(true);
      try {
        if (type === 'builtin') {
          await syncBuiltinTool(identifier);
        } else if (type === 'plugin') {
          await syncPluginTools(identifier);
        } else {
          // mcp-connector already has an entry — just refresh
          await fetchConnectors();
        }
      } finally {
        setSyncing(false);
      }
    };

    ensureConnector();
    // Re-run when identifier or type changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifier, type]);

  if (syncing || !connector) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 6 }} title={false} />
      </div>
    );
  }

  return <ConnectorDetail connectorId={connector.id} />;
});

SkillDetail.displayName = 'SkillDetail';

export default SkillDetail;
