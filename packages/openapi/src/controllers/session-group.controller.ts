import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import type { PaginationRequest } from '../helpers/pagination';
import { SessionGroupRestService } from '../services/session-group.service';
import type {
  CreateSessionGroupRequest,
  MoveAgentsToSessionGroupRequest,
  ReorderSessionGroupsRequest,
  UpdateSessionGroupRequest,
} from '../types/session-group.type';

/**
 * Session group (sidebar folder) controller.
 * HTTP concerns only — the rules live in the shared `sessionGroup` procedures.
 */
export class SessionGroupController extends BaseController {
  private async service(c: Context) {
    return new SessionGroupRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** GET /api/v1/session-groups */
  async listGroups(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<PaginationRequest>(c);
      const service = await this.service(c);
      return this.list(c, 'items', await service.listGroups(query), {
        message: 'Session groups retrieved',
        pagination: query,
      });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/session-groups/:id */
  async getGroup(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = await this.service(c);
      return this.success(c, await service.getGroup(id), 'Session group retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/session-groups */
  async createGroup(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateSessionGroupRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.createGroup(body), 'Session group created', 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** PATCH /api/v1/session-groups/:id */
  async updateGroup(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<UpdateSessionGroupRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.updateGroup(id, body), 'Session group updated');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** DELETE /api/v1/session-groups/:id */
  async deleteGroup(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = await this.service(c);
      return this.success(c, await service.deleteGroup(id), 'Session group deleted');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/session-groups/reorder */
  async reorderGroups(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<ReorderSessionGroupsRequest>(c);
      const service = await this.service(c);
      return this.success(
        c,
        { items: await service.reorderGroups(body) },
        'Session groups reordered',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/session-groups/move-agents */
  async moveAgents(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<MoveAgentsToSessionGroupRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.moveAgents(body), 'Agents moved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
