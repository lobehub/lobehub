import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import type { LegacyArrayListQuery } from '../helpers/legacy-array-list';
import { pageLoadedList } from '../helpers/legacy-array-list';
import { McpServerService } from '../services/mcp-server.service';
import { ToolCallRestService } from '../services/tool-call.service';
import type { CreateMcpServerRequest, UpdateMcpServerRequest } from '../types/mcp-server.type';
import type { McpServerToolCallRequest } from '../types/tool-call.type';

export class McpServerController extends BaseController {
  private async getService(c: Context) {
    const db = await this.getDatabase();
    return new McpServerService(db, this.getUserId(c)!, this.getWorkspaceId(c));
  }

  async listServers(c: Context) {
    try {
      return this.success(
        c,
        pageLoadedList(
          await (await this.getService(c)).listServers(),
          this.getQuery<LegacyArrayListQuery>(c),
        ),
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

  async listLiveTools(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      return this.success(
        c,
        await (await this.getService(c)).listLiveTools(id),
        'MCP tools listed',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async listResources(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      return this.success(
        c,
        await (await this.getService(c)).listResources(id),
        'MCP resources listed',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async listPrompts(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      return this.success(
        c,
        await (await this.getService(c)).listPrompts(id),
        'MCP prompts listed',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** `POST /tools/call` addressed by server id: the same permission and approval rules. */
  async callTool(c: Context) {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<McpServerToolCallRequest>(c);
      const server = await (await this.getService(c)).getServer(id);
      const db = await this.getDatabase();
      const service = new ToolCallRestService(
        db,
        this.getUserId(c),
        this.getWorkspaceId(c),
        c.get('workspaceRole') || undefined,
      );
      return this.success(
        c,
        await service.callTool({
          ...body,
          // Stay on the server this route addressed: a base connector sharing
          // its identifier would otherwise be resolved in its place.
          connectorId: server.id,
          identifier: server.identifier,
        }),
        'Tool called',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
