import { GoalSupervisorIdentifier } from '@lobechat/builtin-tool-goal';

import { GoalSupervisorTools } from '@/server/services/goal/supervisor/tools';

import type { ServerRuntimeRegistration } from './types';

export const goalSupervisorRuntime: ServerRuntimeRegistration = {
  identifier: GoalSupervisorIdentifier,
  factory: (context) => {
    if (!context.serverDB || !context.userId)
      throw new Error('Supervisor database context required');
    return new GoalSupervisorTools(context);
  },
};
