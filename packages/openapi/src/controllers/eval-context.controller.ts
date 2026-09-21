import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { EvalContextService } from '../services/eval-context.service';
import type { EvalPagination } from '../types/eval-resource.type';

export class EvalContextController extends BaseController {
  async listThreads(c: Context) {
    try {
      const { topicId } = this.getParams<{ topicId: string }>(c);
      const service = new EvalContextService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(c, await service.listThreads(topicId, this.getQuery<EvalPagination>(c)));
    } catch (error) {
      return this.handleError(c, error);
    }
  }
  async listPlugins(c: Context) {
    try {
      const service = new EvalContextService(
        await this.getDatabase(),
        this.getUserId(c)!,
        this.getWorkspaceId(c),
      );
      return this.success(c, await service.listPlugins(this.getQuery<EvalPagination>(c)));
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
