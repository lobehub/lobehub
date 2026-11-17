import { hasMandatoryApproval } from '@lobechat/const/plugin';

import { AgentModel } from '@/database/models/agent';
import { ConnectorModel, type PublicConnectorRecord } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { ConnectorToolPermission } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { connectorRouter } from '@/server/routers/lambda/connector';

import { BaseService } from '../common/base.service';
import { decodeOffsetCursor, DEFAULT_PAGE_LIMIT, encodeOffsetCursor } from '../helpers/pagination';
import type { DeletedResource } from '../types/common.type';
import type {
  AttachConnectorAgentRequest,
  ConnectorListQuery,
  ConnectorResponse,
  ConnectorToolResponse,
  UpdateConnectorToolRequest,
} from '../types/connector.type';

type ConnectorToolRow = Awaited<ReturnType<ConnectorToolModel['queryByConnector']>>[number];

export const toConnectorTool = (tool: ConnectorToolRow): ConnectorToolResponse => ({
  description: tool.description,
  id: tool.id,
  inputSchema: (tool.inputSchema ?? null) as Record<string, unknown> | null,
  name: tool.toolName,
  permission: tool.permission as ConnectorToolResponse['permission'],
  requiresApproval:
    tool.permission === ConnectorToolPermission.needs_approval ||
    hasMandatoryApproval(tool.metadata),
});

const CONNECTION_TYPES = new Set(['http', 'stdio']);

/**
 * Connectors REST service: the user's / workspace's connected services and
 * MCP servers, with their synced tools.
 *
 * Reads use the connector models directly and never select credentials. Every
 * write goes through the `connector` tRPC procedures (called server-side), so
 * it keeps the creator / owner manage policy, the OAuth discovery and client
 * registration, the agent-scope rules and the tool sync of the app.
 *
 * Connector rows are scoped by workspace only, so an agent-owned connector of
 * another member's private agent would be reachable by id; such a connector
 * (and an agent the caller cannot see) reads as not found.
 */
export class ConnectorRestService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string; workspaceRole?: string };
  private readonly agentModel: AgentModel;
  private readonly connectorModel: ConnectorModel;
  private readonly connectorToolModel: ConnectorToolModel;

  constructor(
    db: LobeChatDatabase,
    userId: string | null,
    workspaceId?: string,
    workspaceRole?: string,
  ) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId, workspaceRole };
    this.agentModel = new AgentModel(db, this.userId, workspaceId);
    this.connectorModel = new ConnectorModel(db, this.userId, workspaceId);
    this.connectorToolModel = new ConnectorToolModel(db, this.userId, workspaceId);
  }

  private get connectors() {
    return connectorRouter.createCaller(this.ctx);
  }

  private async project(record: PublicConnectorRecord): Promise<ConnectorResponse> {
    const tools = await this.connectorToolModel.queryByConnector(record.id);
    return {
      agentId: record.agentId,
      avatar: record.avatar,
      connectionType: CONNECTION_TYPES.has(record.mcpConnectionType ?? '')
        ? (record.mcpConnectionType as 'http' | 'stdio')
        : null,
      createdAt: new Date(record.createdAt).toISOString(),
      description: record.description,
      hasCredentials: !!record.hasCredentials,
      id: record.id,
      identifier: record.identifier,
      isEnabled: record.isEnabled,
      mountedByAgentId: record.mountedByAgentId,
      name: record.name,
      serverUrl: record.mcpServerUrl,
      sourceType: record.sourceType as ConnectorResponse['sourceType'],
      status: record.status as ConnectorResponse['status'],
      tools: tools.map(toConnectorTool),
      updatedAt: new Date(record.updatedAt).toISOString(),
    };
  }

  private async requireVisibleAgent(agentId: string) {
    if (!(await this.agentModel.existsById(agentId))) {
      throw this.createNotFoundError('Agent not found');
    }
  }

  async requireConnector(id: string): Promise<PublicConnectorRecord> {
    const record = await this.connectorModel.findPublicById(id);
    if (!record || (record.agentId && !(await this.agentModel.existsById(record.agentId)))) {
      throw this.createNotFoundError('Connector not found');
    }
    return record;
  }

  async listConnectors(query: ConnectorListQuery) {
    let records: PublicConnectorRecord[];
    if (query.agentId) {
      await this.requireVisibleAgent(query.agentId);
      const rows = await this.connectorModel.queryByAgent(query.agentId);
      records = (
        await Promise.all(rows.map((row) => this.connectorModel.findPublicById(row.id)))
      ).filter((record): record is PublicConnectorRecord => !!record);
    } else {
      records = await this.connectorModel.queryPublic();
    }
    records.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const offset = query.cursor ? decodeOffsetCursor(query.cursor) : 0;
    const page = records.slice(offset, offset + limit);
    const hasMore = offset + page.length < records.length;

    return {
      hasMore,
      items: await Promise.all(page.map((record) => this.project(record))),
      nextCursor: hasMore ? encodeOffsetCursor(offset + page.length) : null,
      total: records.length,
    };
  }

  async getConnector(id: string): Promise<ConnectorResponse> {
    return this.project(await this.requireConnector(id));
  }

  async listTools(id: string) {
    return { items: (await this.getConnector(id)).tools };
  }

  async deleteConnector(id: string): Promise<DeletedResource> {
    await this.requireConnector(id);
    await this.connectors.delete({ id });
    return { deleted: true, id };
  }

  async authorize(id: string, returnTo?: string) {
    await this.requireConnector(id);
    const { authorizationUrl, flowId } = await this.connectors.startOAuth({ id, returnTo });
    return { authorizationUrl: String(authorizationUrl), flowId };
  }

  async syncTools(id: string) {
    await this.requireConnector(id);
    const { toolCount } = await this.connectors.syncTools({ id });
    return { id, toolCount };
  }

  async attachAgent(id: string, request: AttachConnectorAgentRequest) {
    await this.requireConnector(id);
    await this.requireVisibleAgent(request.agentId);
    const input = { agentId: request.agentId, connectorId: id };
    await (request.mode === 'mount'
      ? this.connectors.mountToAgent(input)
      : this.connectors.bindAgent(input));
    return this.getConnector(id);
  }

  /** Undo whichever attachment the connector has: an agent binding or a mount. */
  async detachAgent(id: string) {
    const record = await this.requireConnector(id);
    if (record.agentId) await this.connectors.unbindAgent({ connectorId: id });
    else if (record.mountedByAgentId) await this.connectors.unmountFromAgent({ connectorId: id });
    return this.getConnector(id);
  }

  async updateToolPermission(
    id: string,
    toolId: string,
    request: UpdateConnectorToolRequest,
  ): Promise<ConnectorToolResponse> {
    await this.requireConnector(id);
    const tool = await this.connectorToolModel.findById(toolId);
    if (!tool || tool.userConnectorId !== id) throw this.createNotFoundError('Tool not found');

    await this.connectors.updateToolPermission({
      permission: request.permission as ConnectorToolPermission,
      toolId,
    });
    return toConnectorTool((await this.connectorToolModel.findById(toolId))!);
  }
}
