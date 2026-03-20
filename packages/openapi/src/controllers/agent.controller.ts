import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { AgentService } from '../services/agent.service';
import type {
  AgentDeleteRequest,
  CreateAgentRequest,
  GetAgentsRequest,
  UpdateAgentRequest,
} from '../types/agent.type';

/**
 * Agent controller class
 * Handles Agent-related HTTP requests and responses
 */
export class AgentController extends BaseController {
  /**
   * Retrieves a list of all Agents in the system
   * GET /api/v1/agents/list
   * @param c Hono Context
   * @returns Agent list response
   */
  async queryAgents(c: Context): Promise<Response> {
    try {
      const request = await this.getQuery<GetAgentsRequest>(c);

      const db = await this.getDatabase();
      const agentService = new AgentService(db, this.getUserId(c));
      const agentsList = await agentService.queryAgents(request);

      return this.success(c, agentsList, '获取 Agent 列表成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Creates an agent
   * POST /api/v1/agents/create
   * @param c Hono Context
   * @returns Created Agent information response
   */
  async createAgent(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateAgentRequest>(c);

      const db = await this.getDatabase();
      const agentService = new AgentService(db, this.getUserId(c));
      const createdAgent = await agentService.createAgent(body);

      return this.success(c, createdAgent, 'Agent 创建成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Updates an agent
   * PUT /api/v1/agents/:id
   * @param c Hono Context
   * @returns Updated Agent information response
   */
  async updateAgent(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<UpdateAgentRequest>(c);

      const updateRequest: UpdateAgentRequest = {
        ...body,
        id,
      };

      const db = await this.getDatabase();
      const agentService = new AgentService(db, this.getUserId(c));
      const updatedAgent = await agentService.updateAgent(updateRequest);

      return this.success(c, updatedAgent, 'Agent 更新成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Deletes an agent
   * DELETE /api/v1/agents/delete
   * @param c Hono Context
   * @returns Deletion result response
   */
  async deleteAgent(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const request: AgentDeleteRequest = { agentId: id };

      const db = await this.getDatabase();
      const agentService = new AgentService(db, this.getUserId(c));
      await agentService.deleteAgent(request);

      return this.success(c, null, 'Agent 删除成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Retrieves Agent details by ID
   * GET /api/v1/agents/:id
   * @param c Hono Context
   * @returns Agent detail response
   */
  async getAgentById(c: Context): Promise<Response> {
    try {
      const { id: agentId } = this.getParams<{ id: string }>(c);
      const db = await this.getDatabase();
      const agentService = new AgentService(db, this.getUserId(c));
      const agent = await agentService.getAgentById(agentId);

      if (!agent) {
        return this.error(c, 'Agent 不存在', 404);
      }

      return this.success(c, agent, '获取 Agent 详情成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
