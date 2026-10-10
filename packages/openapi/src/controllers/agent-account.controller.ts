import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { AgentAccountRestService } from '../services/agent-account.service';
import type {
  AgentAccountAgentParam,
  AgentAccountIdParam,
  AgentAccountListQuery,
  CreateAgentAccountRequest,
  RevokeAgentAccountQuery,
  SetAgentAccountCredentialRequest,
  UpdateAgentAccountRequest,
} from '../types/agent-account.type';

/**
 * Agent accounts controller.
 *
 * HTTP concerns only — provider orchestration lives in `AgentAccountService`
 * and the storage rules in `AgentAccountModel`. Every read here returns the
 * credential-safe view: the ciphertext never leaves the database, and the
 * write-only credential sub-resource answers with the hint, not the secret.
 */
export class AgentAccountController extends BaseController {
  private async service(c: Context): Promise<AgentAccountRestService> {
    return new AgentAccountRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** GET /api/v1/agents/:id/accounts */
  async listAccounts(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<AgentAccountAgentParam>(c);
      const query = this.getQuery<AgentAccountListQuery>(c);
      const service = await this.service(c);
      return this.success(c, await service.listAccounts(id, query), 'Agent accounts retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/agents/:id/accounts */
  async createAccount(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<AgentAccountAgentParam>(c);
      const body = await this.getBody<CreateAgentAccountRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.createAccount(id, body), 'Agent account created', 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/agents/:id/accounts/:accountId */
  async getAccount(c: Context): Promise<Response> {
    try {
      const { accountId, id } = this.getParams<AgentAccountIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.getAccount(id, accountId), 'Agent account retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** PATCH /api/v1/agents/:id/accounts/:accountId */
  async updateAccount(c: Context): Promise<Response> {
    try {
      const { accountId, id } = this.getParams<AgentAccountIdParam>(c);
      const body = await this.getBody<UpdateAgentAccountRequest>(c);
      const service = await this.service(c);
      return this.success(
        c,
        await service.updateAccount(id, accountId, body),
        'Agent account updated',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** PUT /api/v1/agents/:id/accounts/:accountId/credential — write-only. */
  async setCredential(c: Context): Promise<Response> {
    try {
      const { accountId, id } = this.getParams<AgentAccountIdParam>(c);
      const body = await this.getBody<SetAgentAccountCredentialRequest>(c);
      const service = await this.service(c);
      return this.success(
        c,
        await service.setCredential(id, accountId, body),
        'Agent account credential written',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** DELETE /api/v1/agents/:id/accounts/:accountId */
  async revokeAccount(c: Context): Promise<Response> {
    try {
      const { accountId, id } = this.getParams<AgentAccountIdParam>(c);
      const query = this.getQuery<RevokeAgentAccountQuery>(c);
      const service = await this.service(c);
      return this.success(
        c,
        await service.revokeAccount(id, accountId, query),
        'Agent account revoked',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
