'use client';

import { Avatar, Markdown, Skeleton } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { lazy, memo, Suspense, useEffect, useState } from 'react';

import { ConnectorDetail } from '@/features/Connectors';
import { useToolStore } from '@/store/tool';
import { lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector';

const AgentSkillDetail = lazy(() => import('@/features/AgentSkillDetail'));

export type ToolDetailType =
  | 'agent-skill'
  | 'builtin'
  | 'builtin-skill'
  | 'lobehub-connector'
  | 'mcp-connector'
  | 'plugin';

const styles = createStaticStyles(({ css, cssVar }) => ({
  description: css`
    margin-block-start: 8px;
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  header: css`
    display: flex;
    gap: 12px;
    align-items: flex-start;

    padding-block: 20px 16px;
    padding-inline: 24px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  name: css`
    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  noPermissions: css`
    padding: 24px;
    font-size: 14px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface SkillDetailProps {
  identifier: string;
  type: ToolDetailType;
}

/**
 * Right panel for the Settings > Skill master-detail layout.
 *
 * - 'agent-skill': renders AgentSkillDetail inline (user/market agent skills with UUID id)
 * - 'builtin-skill': renders BuiltinSkill description panel (Artifacts, Task, etc.)
 * - 'builtin'/'plugin'/'mcp-connector': syncs connector entry, renders permission editor
 */
const SkillDetail = memo<SkillDetailProps>(({ identifier, type }) => {
  const [syncing, setSyncing] = useState(false);
  const [noManifest, setNoManifest] = useState(false);

  const syncBuiltinTool = useToolStore((s) => s.syncBuiltinTool);
  const syncPluginTools = useToolStore((s) => s.syncPluginTools);
  const syncToolsFromClient = useToolStore((s) => s.syncToolsFromClient);
  const fetchConnectors = useToolStore((s) => s.fetchConnectors);
  const connector = useToolStore(connectorSelectors.connectorByIdentifier(identifier));

  // For lobehub-connector: get the server's tool list from the store
  const lobehubServer = useToolStore(lobehubSkillStoreSelectors.getServerByIdentifier(identifier));

  // For builtin-skill: look up from store
  const builtinSkill = useToolStore(
    (s) => s.builtinSkills?.find((sk) => sk.identifier === identifier),
    isEqual,
  );

  const isConnectorType =
    type === 'builtin' ||
    type === 'plugin' ||
    type === 'mcp-connector' ||
    type === 'lobehub-connector';

  useEffect(() => {
    if (!isConnectorType) return;

    setNoManifest(false);
    const ensureConnector = async () => {
      setSyncing(true);
      try {
        if (type === 'builtin') {
          await syncBuiltinTool(identifier);
        } else if (type === 'lobehub-connector') {
          // Use tools from the lobehub skill server (already fetched via OAuth flow)
          const tools = (lobehubServer?.tools ?? []).map((t) => ({
            description: t.description,
            inputSchema: t.inputSchema as Record<string, unknown>,
            toolName: t.name,
          }));
          if (tools.length === 0) {
            setNoManifest(true);
          } else {
            await syncToolsFromClient({
              identifier,
              name: lobehubServer?.name || identifier,
              sourceType: 'marketplace',
              tools,
            });
          }
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
  }, [identifier, type, isConnectorType]);

  // ── Render by type ──────────────────────────────────────────────────────────

  if (type === 'agent-skill') {
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

  if (type === 'builtin-skill') {
    return (
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div className={styles.header}>
          {builtinSkill?.avatar && <Avatar avatar={builtinSkill.avatar} size={40} />}
          <div>
            <div className={styles.name}>{builtinSkill?.name || identifier}</div>
            {builtinSkill?.description && (
              <div className={styles.description}>{builtinSkill.description}</div>
            )}
          </div>
        </div>
        {builtinSkill?.content && (
          <div style={{ padding: '16px 24px' }}>
            <Markdown variant="chat">{builtinSkill.content}</Markdown>
          </div>
        )}
      </div>
    );
  }

  // Connector types: builtin tool / plugin / mcp-connector
  if (syncing) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 6 }} title={false} />
      </div>
    );
  }

  if (noManifest || !connector) {
    return (
      <div className={styles.noPermissions}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{identifier}</div>
        This skill does not expose configurable tool permissions.
      </div>
    );
  }

  return <ConnectorDetail connectorId={connector.id} />;
});

SkillDetail.displayName = 'SkillDetail';

export default SkillDetail;
