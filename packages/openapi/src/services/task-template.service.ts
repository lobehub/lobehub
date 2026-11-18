import type { TaskTemplate } from '@lobechat/const';

import type { LobeChatDatabase } from '@/database/type';
import { taskTemplateRouter } from '@/server/routers/lambda/taskTemplate';

import { BaseService } from '../common/base.service';
import type { ServiceResult } from '../types';
import type { TaskTemplateListQuery } from '../types/task-template.type';

/**
 * Task templates REST service: the daily recommendations the "new task" page
 * shows, read through the same `taskTemplate` procedure so the interest
 * matching, daily rotation and connector requirements stay identical.
 */
export class TaskTemplateRestService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
  }

  async listTemplates(query: TaskTemplateListQuery): ServiceResult<TaskTemplate[]> {
    const { data } = await taskTemplateRouter
      .createCaller({ userId: this.userId, workspaceId: this.workspaceId })
      .listDailyRecommend({
        count: query.count,
        interestKeys: query.interestKeys,
        locale: query.locale,
        refreshSeed: query.refreshSeed,
      });
    return data;
  }
}
