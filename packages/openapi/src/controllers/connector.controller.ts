import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { ConnectorRestService } from '../services/connector.service';
import type {
  AttachConnectorAgentRequest,
  AuthorizeConnectorRequest,
  ConnectorListQuery,
  UpdateConnectorToolRequest,
} from '../types/connector.type';

export class ConnectorController extends BaseController {
  private async getService(c: Context) {
    const db = await this.getDatabase();
    return new ConnectorRestService(
      db,
      this.getUserId(c),
      this.getWorkspaceId(c),
      c.get('workspaceRole') || undefined,
    );
  }

  private async run(c: Context, message: string, action: (s: ConnectorRestService) => unknown) {
    try {
      return this.success(c, await action(await this.getService(c)), message);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  listConnectors(c: Context) {
    const query = this.getQuery<ConnectorListQuery>(c);
    return this.run(c, 'Connectors retrieved', (s) => s.listConnectors(query));
  }

  getConnector(c: Context) {
    const { id } = this.getParams<{ id: string }>(c);
    return this.run(c, 'Connector retrieved', (s) => s.getConnector(id));
  }

  listTools(c: Context) {
    const { id } = this.getParams<{ id: string }>(c);
    return this.run(c, 'Connector tools retrieved', (s) => s.listTools(id));
  }

  deleteConnector(c: Context) {
    const { id } = this.getParams<{ id: string }>(c);
    return this.run(c, 'Connector removed', (s) => s.deleteConnector(id));
  }

  async authorize(c: Context) {
    const { id } = this.getParams<{ id: string }>(c);
    const body = (await this.getBody<AuthorizeConnectorRequest>(c)) ?? {};
    return this.run(c, 'Authorization started', (s) => s.authorize(id, body.returnTo));
  }

  syncTools(c: Context) {
    const { id } = this.getParams<{ id: string }>(c);
    return this.run(c, 'Connector tools synced', (s) => s.syncTools(id));
  }

  async attachAgent(c: Context) {
    const { id } = this.getParams<{ id: string }>(c);
    const body = await this.getBody<AttachConnectorAgentRequest>(c);
    return this.run(c, 'Connector attached to agent', (s) => s.attachAgent(id, body));
  }

  detachAgent(c: Context) {
    const { id } = this.getParams<{ id: string }>(c);
    return this.run(c, 'Connector detached from agent', (s) => s.detachAgent(id));
  }

  async updateTool(c: Context) {
    const { id, toolId } = this.getParams<{ id: string; toolId: string }>(c);
    const body = await this.getBody<UpdateConnectorToolRequest>(c);
    return this.run(c, 'Tool permission updated', (s) => s.updateToolPermission(id, toolId, body));
  }
}
