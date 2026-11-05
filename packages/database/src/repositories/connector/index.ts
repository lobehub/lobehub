import type { UserConnectorItem } from '@lobechat/types';

import { AgentModel } from '../../models/agent';
import { ConnectorModel } from '../../models/connector';
import { ConnectorToolModel } from '../../models/connectorTool';
import type { LobeChatDatabase } from '../../type';
import { withNativeConnectorLock } from '../../utils/nativeConnectorLock';

/** Connector lifecycle units of work that also update tools or agent grants. */
export class ConnectorRepository {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
  ) {}

  copyToAgent = async (sourceId: string, agentId: string): Promise<UserConnectorItem | null> => {
    const source = await new ConnectorModel(this.db, this.userId, this.workspaceId).findById(
      sourceId,
    );
    if (!source) return null;

    return withNativeConnectorLock(
      this.db,
      source.metadata?.composio?.linkedByUserId ?? source.userId,
      source.identifier,
      async (tx) => {
        const connectors = new ConnectorModel(
          tx as LobeChatDatabase,
          this.userId,
          this.workspaceId,
        );
        const current = await connectors.lockById(sourceId);
        if (!current) return null;
        if (
          current.identifier !== source.identifier ||
          current.metadata?.composio?.connectedAccountId !==
            source.metadata?.composio?.connectedAccountId ||
          current.metadata?.composio?.linkedByUserId !== source.metadata?.composio?.linkedByUserId
        )
          throw new Error('The account changed before copying');
        const created = await connectors.cloneRowToAgent(current, agentId);
        await new ConnectorToolModel(
          tx as LobeChatDatabase,
          this.userId,
          this.workspaceId,
        ).cloneForConnector(sourceId, created.id);
        return created;
      },
    );
  };

  delete = async (id: string): Promise<void> => {
    const connectors = new ConnectorModel(this.db, this.userId, this.workspaceId);
    const candidate = await connectors.findById(id);
    if (!candidate) return;
    if (candidate.workspaceId) return connectors.delete(id);

    await withNativeConnectorLock(this.db, this.userId, candidate.identifier, async (tx) => {
      const scopedConnectors = new ConnectorModel(
        tx as LobeChatDatabase,
        this.userId,
        this.workspaceId,
      );
      const current = await scopedConnectors.lockById(id);
      if (!current) return;
      if (current.identifier !== candidate.identifier)
        throw new Error('The connection changed before deleting');
      const ids = current.metadata?.nativeAccess?.agentIds;
      if (Array.isArray(ids) && ids.length)
        await new AgentModel(tx as LobeChatDatabase, this.userId).disablePersonalPluginForAgents(
          ids,
          current.identifier,
        );
      await scopedConnectors.delete(id);
    });
  };
}
