'use client';

import { Skeleton } from '@lobehub/ui';
import { lazy, memo, Suspense, useEffect, useState } from 'react';

import { ConnectorDetail } from '@/features/Connectors';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

const AgentSkillDetail = lazy(() => import('@/features/AgentSkillDetail'));

export type ToolDetailType = 'agent-skill' | 'builtin' | 'mcp-connector' | 'plugin';

interface SkillDetailProps {
  identifier: string;
  type: ToolDetailType;
}

const SkillDetail = memo<SkillDetailProps>(({ identifier, type }) => {
  const [syncing, setSyncing] = useState(false);
  const [noManifest, setNoManifest] = useState(false);

  const syncBuiltinTool = useToolStore((s) => s.syncBuiltinTool);
  const syncPluginTools = useToolStore((s) => s.syncPluginTools);
  const fetchConnectors = useToolStore((s) => s.fetchConnectors);
  const connector = useToolStore(connectorSelectors.connectorByIdentifier(identifier));

  const isAgentSkill = type === 'agent-skill';

  useEffect(() => {
    if (isAgentSkill) return; // agent skills don't need connector sync

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
        setNoManifest(true);
      } finally {
        setSyncing(false);
      }
    };

    ensureConnector();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifier, type, isAgentSkill]);

  // Agent skill: render detail inline instead of connector permissions
  if (isAgentSkill) {
    return (
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Suspense
          fallback={
            <div style={{ padding: 24 }}>
              <Skeleton active paragraph={{ rows: 6 }} title={false} />
            </div>
          }
        >
          <AgentSkillDetail skillId={identifier} />
        </Suspense>
      </div>
    );
  }

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
