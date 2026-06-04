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
 *
 * If the tool has no API manifest (e.g. agent skills), shows a graceful
 * "no tool permissions" message instead of an error.
 */
const SkillDetail = memo<SkillDetailProps>(({ identifier, type }) => {
  const [syncing, setSyncing] = useState(false);
  const [noManifest, setNoManifest] = useState(false);

  const syncBuiltinTool = useToolStore((s) => s.syncBuiltinTool);
  const syncPluginTools = useToolStore((s) => s.syncPluginTools);
  const fetchConnectors = useToolStore((s) => s.fetchConnectors);
  const connector = useToolStore(connectorSelectors.connectorByIdentifier(identifier));

  useEffect(() => {
    setNoManifest(false);
    const ensureConnector = async () => {
      setSyncing(true);
      try {
        if (type === 'builtin') {
          await syncBuiltinTool(identifier);
        } else if (type === 'plugin') {
          await syncPluginTools(identifier);
        } else {
          await fetchConnectors();
        }
      } catch {
        // Tool not found in any manifest — this is a skill without API tools
        setNoManifest(true);
      } finally {
        setSyncing(false);
      }
    };

    ensureConnector();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifier, type]);

  if (syncing) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 6 }} title={false} />
      </div>
    );
  }

  if (noManifest || !connector) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{identifier}</div>
        <div style={{ color: 'var(--lobe-colors-neutral-500)', fontSize: 14 }}>
          This skill does not expose configurable tool permissions.
        </div>
      </div>
    );
  }

  return <ConnectorDetail connectorId={connector.id} />;
});

SkillDetail.displayName = 'SkillDetail';

export default SkillDetail;
