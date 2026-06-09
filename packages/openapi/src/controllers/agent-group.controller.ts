import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { AgentGroupService } from '../services/agent-group.service';
import type {
  CreateAgentGroupRequest,
  DeleteAgentGroupRequest,
  UpdateAgentGroupRequest,
} from '../types/agent-group.type';

/**
 * AgentGroup controller class
 * Handles agent category-related HTTP requests and responses
 */
export class AgentGroupController extends BaseController {
  /**
   * Retrieves the list of agent categories
   * GET /api/v1/agent-groups
   * @param c Hono Context
   * @returns Agent category list response
   */
  async getAgentGroups(c: Context): Promise<Response> {
    try {
      const db = await this.getDatabase();
      const agentGroupService = new AgentGroupService(
        db,
        this.getUserId(c),
        this.getWorkspaceId(c),
      );
      const agentGroups = await agentGroupService.getAgentGroups();

      return this.success(c, agentGroups, 'Agent category list retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Retrieves agent category details by ID
   * GET /api/v1/agent-groups/:id
   * @param c Hono Context
   * @returns Agent category detail response
   */
  async getAgentGroupById(c: Context): Promise<Response> {
    try {
      const { id: groupId } = this.getParams<{ id: string }>(c);

      if (!groupId) {
        return this.error(c, 'Agent category ID is required', 400);
      }

      const db = await this.getDatabase();
      const agentGroupService = new AgentGroupService(
        db,
        this.getUserId(c),
        this.getWorkspaceId(c),
      );
      const agentGroup = await agentGroupService.getAgentGroupById(groupId);

      if (!agentGroup) {
        return this.error(c, 'Agent category not found', 404);
      }

      return this.success(c, agentGroup, 'Agent category details retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Creates an agent category
   * POST /api/v1/agent-groups
   * @param c Hono Context
   * @returns Created agent category ID response
   */
  async createAgentGroup(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateAgentGroupRequest>(c);

      const db = await this.getDatabase();
      const agentGroupService = new AgentGroupService(
        db,
        this.getUserId(c),
        this.getWorkspaceId(c),
      );
      const groupId = await agentGroupService.createAgentGroup(body);

      return c.json(
        {
          data: { id: groupId },
          message: 'Agent category created successfully',
          success: true,
          timestamp: new Date().toISOString(),
        },
        201,
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Updates an agent category
   * PATCH /api/v1/agent-groups/:id
   * @param c Hono Context
   * @returns Update result response
   */
  async updateAgentGroup(c: Context): Promise<Response> {
    try {
      const { id: groupId } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<Omit<UpdateAgentGroupRequest, 'id'>>(c);

      if (!groupId) {
        return this.error(c, 'Agent category ID is required', 400);
      }

      const request: UpdateAgentGroupRequest = {
        id: groupId,
        ...body,
      };

      const db = await this.getDatabase();
      const agentGroupService = new AgentGroupService(
        db,
        this.getUserId(c),
        this.getWorkspaceId(c),
      );
      await agentGroupService.updateAgentGroup(request);

      return this.success(c, null, 'Agent category updated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Deletes an agent category
   * DELETE /api/v1/agent-groups/:id
   * @param c Hono Context
   * @returns Deletion result response
   */
  async deleteAgentGroup(c: Context): Promise<Response> {
    try {
      const { id: groupId } = this.getParams<{ id: string }>(c);

      if (!groupId) {
        return this.error(c, 'Agent category ID is required', 400);
      }

      const request: DeleteAgentGroupRequest = {
        id: groupId,
      };

      const db = await this.getDatabase();
      const agentGroupService = new AgentGroupService(
        db,
        this.getUserId(c),
        this.getWorkspaceId(c),
      );
      await agentGroupService.deleteAgentGroup(request);

      return this.success(c, null, 'Agent category deleted successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
