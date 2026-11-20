import { GoalReportIdentifier } from '@lobechat/builtin-tool-goal/report';

import { GoalReportTools } from '@/server/services/goal/reportTools';

import type { ServerRuntimeRegistration } from './types';

export const goalReportRuntime: ServerRuntimeRegistration = {
  identifier: GoalReportIdentifier,
  factory: (context) => {
    if (!context.serverDB || !context.userId)
      throw new Error('Goal report database context required');
    return new GoalReportTools(context);
  },
};
