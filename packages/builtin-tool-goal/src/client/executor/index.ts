import { taskExecutor } from '@lobechat/builtin-tool-task/client/executor';
import type { BuiltinToolContext, BuiltinToolResult, ToolAfterCallContext } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { GoalIdentifier } from '../../manifest';
import type { CreateGoalParams } from '../../types';
import { GoalApiName } from '../../types';

class GoalExecutor extends BaseExecutor<typeof GoalApiName> {
  readonly identifier = GoalIdentifier;
  protected readonly apiEnum = GoalApiName;

  onAfterCall = async (context: ToolAfterCallContext): Promise<void> => {
    await taskExecutor.onAfterCall(context);
  };

  createGoal = async (
    params: CreateGoalParams,
    context?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => taskExecutor.createGoal(params, context);
}

export const goalExecutor = new GoalExecutor();
