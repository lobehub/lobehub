import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { TaskTemplateRestService } from '../services/task-template.service';
import type { TaskTemplateListQuery } from '../types/task-template.type';

/** Task templates controller — the daily recommended recurring tasks. */
export class TaskTemplateController extends BaseController {
  /** GET /api/v1/task-templates */
  async listTemplates(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<TaskTemplateListQuery>(c);
      const service = new TaskTemplateRestService(
        await this.getDatabase(),
        this.getUserId(c),
        this.getWorkspaceId(c),
      );
      return this.success(
        c,
        await service.listTemplates(query),
        'Task templates retrieved successfully',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
