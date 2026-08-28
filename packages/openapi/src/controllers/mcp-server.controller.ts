import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { McpServerService } from '../services/mcp-server.service';
import type { CreateMcpServerRequest, UpdateMcpServerRequest } from '../types/mcp-server.type';

export class McpServerController extends BaseController {
  private async getService(c: Context) {
    const db = await this.getDatabase();
    return new McpServerService(db, this.getUserId(c)!, this.getWorkspaceId(c));
  }

  async listServers(c: Context) {
    try {
      return this.success(
        c,
        await (await this.getService(c)).listServers(),
        'MCP servers retrieved',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async getServer(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      return this.success(
        c,
        await (await this.getService(c)).getServer(id),
        'MCP server retrieved',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async createServer(c: Context) {
    try {
      const request = (await this.getBody<CreateMcpServerRequest>(c))!;
      const data = await (await this.getService(c)).createServer(request);
      return this.success(c, data, 'MCP server created', 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async updateServer(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const request = (await this.getBody<UpdateMcpServerRequest>(c))!;
      return this.success(
        c,
        await (await this.getService(c)).updateServer(id, request),
        'MCP server updated',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async deleteServer(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      return this.success(
        c,
        await (await this.getService(c)).deleteServer(id),
        'MCP server deleted',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async syncServer(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      return this.success(c, await (await this.getService(c)).syncServer(id), 'MCP server synced');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
