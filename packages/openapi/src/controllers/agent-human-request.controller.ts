import type { Context } from 'hono';

import { createAgentHumanRequestService } from '@/server/services/agentHumanRequest/factory';

import { BaseController } from '../common/base.controller';
import type {
  AgentHumanRequestDecideRequest,
  AgentHumanRequestIdParam,
  AgentHumanRequestListQuery,
} from '../types/agent-human-request.type';

/**
 * Agent human requests — the approval and secure-input cards an agent parked
 * for its owner. HTTP concerns only: the lifecycle (who may answer, running
 * the action once, opening the secret envelope) lives in
 * `AgentHumanRequestService`, the same one the tRPC router drives.
 *
 * A fulfil body carries only an ASC/1 HPKE envelope — never the secret — so
 * the request log and any proxy in between see ciphertext only.
 */
export class AgentHumanRequestController extends BaseController {
  private async service(c: Context) {
    return createAgentHumanRequestService(await this.getDatabase(), this.getUserId(c)!, {
      workspaceId: this.getWorkspaceId(c),
    });
  }

  /** GET /api/v1/human-requests */
  async list(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<AgentHumanRequestListQuery>(c);
      const service = await this.service(c);
      return this.success(c, { requests: await service.list(query) }, 'Requests retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/human-requests/identity */
  async identity(c: Context): Promise<Response> {
    try {
      const service = await this.service(c);
      return this.success(c, service.identity(), 'Secret channel identity retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/human-requests/:id */
  async get(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<AgentHumanRequestIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.get(id), 'Request retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/human-requests/:id/decision */
  async decide(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<AgentHumanRequestIdParam>(c);
      const { decision, via } = await this.getBody<AgentHumanRequestDecideRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.decide(id, decision, via ?? 'api'), 'Request answered');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
