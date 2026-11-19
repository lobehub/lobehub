import { ConnectorModel, type PublicConnectorRecord } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import {
  ConnectorMcpConnectionType,
  ConnectorSourceType,
  ConnectorStatus,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { buildConnectorMcpParams, syncConnectorToolsById } from '@/server/services/connector/sync';
import { ensureFreshConnectorToken } from '@/server/services/connector/tokens';
import { mcpService } from '@/server/services/mcp';

import { BaseService } from '../common/base.service';
import { ApiException } from '../common/errors';
import type { DeletedResource } from '../types/common.type';
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

/**
 * A failed request to an MCP server, as the REST error catalogue reads it. The
 * server's own message is kept: it describes the remote failure, not ours.
 */
export const toMcpUpstreamError = (error: unknown) => {
  const { code, message } = error as { code?: string; message?: string };
  const reason = message || 'unknown error';
  if (code === 'SERVICE_UNAVAILABLE' || code === 'TIMEOUT') {
    return new ApiException(503, 'service_unavailable', `MCP server unavailable: ${reason}`);
  }
  if ((error as Error)?.name === 'TRPCError' && code !== 'INTERNAL_SERVER_ERROR') return error;
  return new ApiException(502, 'upstream_error', `MCP server request failed: ${reason}`);
};

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
    // The lookup and the insert are one claim under the identifier lock every
    // base-row writer takes (an Agent Builder install among them): a lookup
    // before an unlocked insert would let a concurrent writer add the same
    // identifier in between, leaving two rows for runtime resolution to choose from.
    const claim = await model.createUnlessIdentifierHeld({
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
    if ('holder' in claim) throw this.createConflictError('MCP server identifier already exists');

    const publicRecord = await this.connectorModel.findPublicById(claim.created.id);
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

  async deleteServer(id: string): Promise<DeletedResource> {
    await this.requireManageableServer(id);
    await this.connectorModel.delete(id);
    return { deleted: true, id };
  }

  async syncServer(id: string): Promise<{ id: string; status: string; toolCount: number }> {
    await this.requireManageableServer(id);
    const model = await this.getCredentialConnectorModel();
    const { toolCount } = await syncConnectorToolsById(id, {
      connectorModel: model,
      connectorToolModel: this.connectorToolModel,
      // A connector set to connect through the device lists on the user's device
      serverDB: this.db,
      userId: this.userId,
    });
    return { id, status: ConnectorStatus.connected, toolCount };
  }

  /**
   * Ask the server itself, with the connector's (refreshed) credentials.
   * `mcpService` reports failures as tRPC errors: an unreachable server is
   * `SERVICE_UNAVAILABLE`/`TIMEOUT` (503), refused upstream auth `FORBIDDEN`
   * (kept), anything the server got wrong `INTERNAL_SERVER_ERROR` (502).
   */
  private async withLiveServer<T>(
    id: string,
    run: (params: ReturnType<typeof buildConnectorMcpParams>) => Promise<T>,
  ): Promise<T> {
    await this.requireServer(id);
    const model = await this.getCredentialConnectorModel();
    const connector = await model.findById(id);
    if (!connector) throw this.createNotFoundError('MCP server not found');
    const fresh = await ensureFreshConnectorToken(connector, model);

    try {
      return await run(buildConnectorMcpParams(fresh));
    } catch (error) {
      throw toMcpUpstreamError(error);
    }
  }

  async listLiveTools(id: string) {
    const tools = await this.withLiveServer(id, (params) => mcpService.listRawTools(params));
    return {
      items: tools.map((tool) => ({
        description: tool.description ?? null,
        inputSchema: (tool.inputSchema ?? null) as null | Record<string, unknown>,
        name: tool.name,
      })),
    };
  }

  async listResources(id: string) {
    const resources = await this.withLiveServer(id, (params) => mcpService.listResources(params));
    return {
      items: resources.map((resource) => ({
        description: resource.description ?? null,
        mimeType: resource.mimeType ?? null,
        name: resource.name,
        uri: resource.uri,
      })),
    };
  }

  async listPrompts(id: string) {
    const prompts = await this.withLiveServer(id, (params) => mcpService.listPrompts(params));
    return {
      items: prompts.map((prompt) => ({
        arguments: (prompt.arguments ?? []).map((argument) => ({
          description: argument.description ?? null,
          name: argument.name,
          required: !!argument.required,
        })),
        description: prompt.description ?? null,
        name: prompt.name,
      })),
    };
  }
}
