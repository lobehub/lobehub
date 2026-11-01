import { ConnectorModel, type PublicConnectorRecord } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import {
  ConnectorMcpConnectionType,
  ConnectorSourceType,
  ConnectorStatus,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { syncConnectorToolsById } from '@/server/services/connector/sync';

import { BaseService } from '../common/base.service';
import type {
  CreateMcpServerRequest,
  McpServerResponse,
  McpServerToolResponse,
  UpdateMcpServerRequest,
} from '../types/mcp-server.type';

/**
 * Base-scope only (`agent_id IS NULL`), matching `queryPublic()`. Without the
 * `agentId` check the id routes could reach agent-scoped connectors that the
 * list route cannot even surface, and deleting one here would skip the
 * connector router's agent-plugin unpin, leaving the agent with a dangling
 * pinned tool. Agent-scoped connectors are managed through the agent profile.
 */
const isPublicMcpServer = (value: PublicConnectorRecord) =>
  value.agentId === null &&
  value.sourceType === ConnectorSourceType.custom &&
  value.mcpConnectionType === ConnectorMcpConnectionType.http &&
  !!value.mcpServerUrl;

export class McpServerService extends BaseService {
  private connectorModel: ConnectorModel;
  private connectorToolModel: ConnectorToolModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.connectorModel = new ConnectorModel(db, userId, workspaceId);
    this.connectorToolModel = new ConnectorToolModel(db, userId, workspaceId);
  }

  private async getCredentialConnectorModel() {
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    return new ConnectorModel(this.db, this.userId, this.workspaceId, gateKeeper);
  }

  private async projectServer(value: PublicConnectorRecord): Promise<McpServerResponse> {
    const tools = await this.connectorToolModel.queryByConnector(value.id);
    return {
      createdAt: value.createdAt,
      description: value.description,
      hasCredentials: value.hasCredentials,
      id: value.id,
      identifier: value.identifier,
      isEnabled: value.isEnabled,
      name: value.name,
      serverUrl: value.mcpServerUrl!,
      status: value.status,
      tools: tools.map((tool): McpServerToolResponse => ({
        description: tool.description,
        id: tool.id,
        inputSchema: tool.inputSchema as null | Record<string, unknown>,
        name: tool.toolName,
        permission: tool.permission,
      })),
      updatedAt: value.updatedAt,
    };
  }

  private async requireServer(id: string) {
    const server = await this.connectorModel.findPublicById(id);
    if (!server || !isPublicMcpServer(server)) {
      throw this.createNotFoundError('MCP server not found');
    }
    return server;
  }

  /**
   * `ConnectorModel`'s ownership predicate is workspace-wide, so a member holding
   * only `agent:update:owner` could otherwise mutate a shared MCP server created
   * by someone else. Mirrors the connector tRPC mutations.
   */
  private async requireManageableServer(id: string) {
    const server = await this.requireServer(id);
    await this.assertRowManageable(server.userId, 'AGENT_UPDATE', 'MCP server');
    return server;
  }

  async listServers(): Promise<McpServerResponse[]> {
    const servers = (await this.connectorModel.queryPublic()).filter(isPublicMcpServer);
    return Promise.all(servers.map((server) => this.projectServer(server)));
  }

  async getServer(id: string): Promise<McpServerResponse> {
    const server = await this.requireServer(id);
    return this.projectServer(server);
  }

  async createServer(request: CreateMcpServerRequest): Promise<McpServerResponse> {
    const model = await this.getCredentialConnectorModel();
    const existing = (await this.connectorModel.queryPublic()).find(
      (connector) => connector.identifier === request.identifier,
    );
    if (existing) throw this.createConflictError('MCP server identifier already exists');

    const created = await model.create({
      agentId: null,
      credentials: request.credentials ? JSON.stringify(request.credentials) : null,
      identifier: request.identifier,
      isEnabled: request.isEnabled ?? true,
      mcpConnectionType: ConnectorMcpConnectionType.http,
      mcpServerUrl: request.serverUrl,
      metadata: request.description ? { description: request.description } : null,
      name: request.name,
      oidcConfig: null,
      sourceType: ConnectorSourceType.custom,
      status: ConnectorStatus.disconnected,
      tokenExpiresAt: null,
    });

    const publicRecord = await this.connectorModel.findPublicById(created.id);
    if (!publicRecord) throw this.createCommonError('Failed to read the created MCP server');
    return this.projectServer(publicRecord);
  }

  async updateServer(id: string, request: UpdateMcpServerRequest): Promise<McpServerResponse> {
    await this.requireManageableServer(id);
    const model = await this.getCredentialConnectorModel();
    // The decrypted row is needed only to preserve non-public metadata during a
    // patch. It is never logged or returned; GET paths use findPublicById and
    // therefore do not even select the credentials column.
    const current = await model.findById(id);
    if (!current) throw this.createNotFoundError('MCP server not found');

    const connectionChanged = request.serverUrl !== undefined || request.credentials !== undefined;
    await model.update(id, {
      ...(request.credentials === undefined
        ? {}
        : { credentials: request.credentials ? JSON.stringify(request.credentials) : null }),
      ...(request.description === undefined
        ? {}
        : {
            metadata: {
              ...current.metadata,
              description: request.description ?? undefined,
            },
          }),
      ...(request.isEnabled === undefined ? {} : { isEnabled: request.isEnabled }),
      ...(request.name === undefined ? {} : { name: request.name }),
      ...(request.serverUrl === undefined ? {} : { mcpServerUrl: request.serverUrl }),
      ...(connectionChanged ? { status: ConnectorStatus.disconnected } : {}),
    });

    return this.getServer(id);
  }

  async deleteServer(id: string): Promise<{ id: string }> {
    await this.requireManageableServer(id);
    await this.connectorModel.delete(id);
    return { id };
  }

  async syncServer(id: string): Promise<{ id: string; status: string; toolCount: number }> {
    await this.requireManageableServer(id);
    const model = await this.getCredentialConnectorModel();
    const { toolCount } = await syncConnectorToolsById(id, {
      connectorModel: model,
      connectorToolModel: this.connectorToolModel,
    });
    return { id, status: ConnectorStatus.connected, toolCount };
  }
}
