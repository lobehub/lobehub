import { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { AgentService } from '../services/agent.service';
import {
  AgentDeleteRequest,
  CreateAgentRequest,
  GetAgentsRequest,
  UpdateAgentRequest,
} from '../types/agent.type';

/**
 * Agent 控制器类
 * 处理 Agent 相关的 HTTP 请求和响应
 */
export class AgentController extends BaseController {
  /**
   * 获取系统中所有的 Agent 列表
   * GET /api/v1/agents/list
   * @param c Hono Context
   * @returns Agent 列表响应
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
   * 创建智能体
   * POST /api/v1/agents/create
   * @param c Hono Context
   * @returns 创建完成的 Agent 信息响应
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
   * 更新智能体
   * PUT /api/v1/agents/:id
   * @param c Hono Context
   * @returns 更新后的 Agent 信息响应
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
   * 删除智能体
   * DELETE /api/v1/agents/delete
   * @param c Hono Context
   * @returns 删除结果响应
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
   * 根据 ID 获取 Agent 详情
   * GET /api/v1/agents/:id
   * @param c Hono Context
   * @returns Agent 详情响应
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
