import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { TrashRestService } from '../services/trash.service';
import type {
  EmptyTrashRequest,
  TrashCountsQuery,
  TrashIdsRequest,
  TrashListQuery,
} from '../types/trash.type';

/** Recycle bin: HTTP concerns only — the rules live in the shared `trash` procedures. */
export class TrashController extends BaseController {
  private async service(c: Context) {
    return new TrashRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
      c.get('workspaceRole') as string | undefined,
    );
  }

  private async respond(
    c: Context,
    fn: (service: TrashRestService) => Promise<unknown>,
    message: string,
  ): Promise<Response> {
    try {
      return this.success(c, await fn(await this.service(c)), message);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/trash */
  async listItems(c: Context) {
    const query = this.getQuery<TrashListQuery>(c);
    return this.respond(c, (s) => s.list(query), 'Trash retrieved successfully');
  }

  /** GET /api/v1/trash/counts */
  async counts(c: Context) {
    const query = this.getQuery<TrashCountsQuery>(c);
    return this.respond(c, (s) => s.counts(query), 'Trash counts retrieved successfully');
  }

  /** POST /api/v1/trash/restore */
  async restore(c: Context) {
    const { ids } = await this.getBody<TrashIdsRequest>(c);
    return this.respond(c, (s) => s.restore(ids), 'Trash items restored');
  }

  /** POST /api/v1/trash/purge */
  async purge(c: Context) {
    const { ids } = await this.getBody<TrashIdsRequest>(c);
    return this.respond(c, (s) => s.purge(ids), 'Trash items permanently deleted');
  }

  /** POST /api/v1/trash/empty */
  async empty(c: Context) {
    const body = await this.getBody<EmptyTrashRequest>(c);
    return this.respond(c, (s) => s.empty(body), 'Trash emptied');
  }
}
