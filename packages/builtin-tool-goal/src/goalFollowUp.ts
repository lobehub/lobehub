import { isGoalIdentifier } from './manifest';
import { GoalApiName } from './types';

interface GoalHistoryMessage {
  plugin?: { apiName?: string; identifier?: string } | null;
  pluginState?: { goalId?: unknown } | null;
  role?: string;
}

/**
 * Whether a conversation still has a goal proposal to finish: its latest
 * `createGoal` call did not create a goal — the user rejected the plan, it is
 * still awaiting approval, or it failed.
 *
 * The goal tool is otherwise only on a turn whose prompt starts with `/goal`,
 * so without this the turn resumed after "reject with feedback", or a plain
 * "try again", loses the tool and the model's retry is refused as an unknown
 * tool name. Once a goal is created the follow-up ends; starting another goal
 * goes back through `/goal` or the activator.
 */
export const hasUnfinishedGoalProposal = (messages: readonly GoalHistoryMessage[]): boolean => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const { plugin, pluginState, role } = messages[i];
    if (role !== 'tool' || plugin?.apiName !== GoalApiName.createGoal) continue;
    if (!isGoalIdentifier(plugin.identifier)) continue;

    return !pluginState?.goalId;
  }

  return false;
};
