import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { OAuthAppRestService } from '../services/oauth-app.service';
import type {
  CreateOAuthAppRequest,
  OAuthAppListQuery,
  UpdateOAuthAppRequest,
} from '../types/oauth-app.type';

/** OAuth applications: HTTP concerns only — the rules live in the shared `oauthApp` procedures. */
export class OAuthAppController extends BaseController {
  private async service(c: Context) {
    return new OAuthAppRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  private async respond(
    c: Context,
    fn: (service: OAuthAppRestService) => Promise<unknown>,
    message: string,
    status: 200 | 201 = 200,
  ): Promise<Response> {
    try {
      return this.success(c, await fn(await this.service(c)), message, status);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  private id(c: Context) {
    return this.getParams<{ id: string }>(c).id;
  }

  /** GET /api/v1/oauth-apps */
  async listApps(c: Context) {
    const query = this.getQuery<OAuthAppListQuery>(c);
    return this.respond(c, (s) => s.list(query), 'OAuth apps retrieved successfully');
  }

  /** POST /api/v1/oauth-apps */
  async create(c: Context) {
    const body = await this.getBody<CreateOAuthAppRequest>(c);
    return this.respond(c, (s) => s.create(body), 'OAuth app created successfully', 201);
  }

  /** GET /api/v1/oauth-apps/:id */
  async get(c: Context) {
    return this.respond(c, (s) => s.get(this.id(c)), 'OAuth app retrieved successfully');
  }

  /** PATCH /api/v1/oauth-apps/:id */
  async update(c: Context) {
    const body = await this.getBody<UpdateOAuthAppRequest>(c);
    return this.respond(c, (s) => s.update(this.id(c), body), 'OAuth app updated successfully');
  }

  /** DELETE /api/v1/oauth-apps/:id */
  async delete(c: Context) {
    return this.respond(c, (s) => s.delete(this.id(c)), 'OAuth app deleted successfully');
  }

  /** POST /api/v1/oauth-apps/:id/rotate-secret */
  async rotateSecret(c: Context) {
    return this.respond(c, (s) => s.rotateSecret(this.id(c)), 'Client secret issued successfully');
  }
}
