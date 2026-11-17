import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import type { PaginationRequest } from '../helpers/pagination';
import { AgentLabelRestService } from '../services/agent-label.service';
import type { CreateAgentLabelRequest, UpdateAgentLabelRequest } from '../types/agent-label.type';

/**
 * Agent label registry controller.
 * HTTP concerns only — the rules live in the shared `agentLabel` procedures.
 */
export class AgentLabelController extends BaseController {
  private async service(c: Context) {
    return new AgentLabelRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** GET /api/v1/agent-labels */
  async listLabels(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<PaginationRequest>(c);
      const service = await this.service(c);
      return this.list(c, 'items', await service.listLabels(query), {
        message: 'Agent labels retrieved',
        pagination: query,
      });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/agent-labels/:id */
  async getLabel(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = await this.service(c);
      return this.success(c, await service.getLabel(id), 'Agent label retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/agent-labels */
  async createLabel(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateAgentLabelRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.createLabel(body), 'Agent label created', 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** PATCH /api/v1/agent-labels/:id */
  async updateLabel(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<UpdateAgentLabelRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.updateLabel(id, body), 'Agent label updated');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** DELETE /api/v1/agent-labels/:id */
  async deleteLabel(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = await this.service(c);
      return this.success(c, await service.deleteLabel(id), 'Agent label deleted');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
