import type { BuiltinIntervention } from '@lobechat/types';

import { GroupManagementApiName } from '../../types';
import ExecuteTaskIntervention from './ExecuteTask';
import ExecuteTasksIntervention from './ExecuteTasks';

/**
 * Group Management Tool Intervention Components Registry
 *
 * Intervention components allow users to review and modify tool parameters
 * before the tool is executed.
 */
export const GroupManagementInterventions: Record<string, BuiltinIntervention> = {
  [GroupManagementApiName.executeAgentTask]: ExecuteTaskIntervention as BuiltinIntervention,
  [GroupManagementApiName.executeAgentTasks]: ExecuteTasksIntervention as BuiltinIntervention,
};

export { default as ExecuteTaskIntervention } from './ExecuteTask';
export { default as ExecuteTasksIntervention } from './ExecuteTasks';
