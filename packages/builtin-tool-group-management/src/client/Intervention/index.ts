import { BuiltinIntervention } from '@lobechat/types';

import { GroupManagementApiName } from '../../types';
import ExecuteTaskIntervention from './ExecuteTask';

/**
 * Group Management Tool Intervention Components Registry
 *
 * Intervention components allow users to review and modify tool parameters
 * before the tool is executed.
 */
export const GroupManagementInterventions: Record<string, BuiltinIntervention> = {
  [GroupManagementApiName.executeTask]: ExecuteTaskIntervention as BuiltinIntervention,
};

export { default as ExecuteTaskIntervention } from './ExecuteTask';
