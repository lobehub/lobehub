import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { AgentUsageRestService } from '../services/agent-usage.service';
import type { AgentUsageParam, AgentUsageQuery } from '../types/usage.type';

export class AgentUsageController extends BaseController {
  /** GET /api/v1/usage/agents/:agentId */
  async getAgentUsage(c: Context): Promise<Response> {
    try {
      const { agentId } = this.getParams<AgentUsageParam>(c);
      const query = this.getQuery<AgentUsageQuery>(c);
      const service = new AgentUsageRestService(
        await this.getDatabase(),
        this.getUserId(c),
        this.getWorkspaceId(c),
      );
      return this.success(c, await service.getAgentUsage(agentId, query), 'Agent usage retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
