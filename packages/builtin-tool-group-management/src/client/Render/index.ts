import { GroupManagementApiName } from '../../types';
import BroadcastRender from './Broadcast';
import ExecuteTaskRender from './ExecuteTask';
import ExecuteTasksRender from './ExecuteTasks';
import SpeakRender from './Speak';

/**
 * Group Management Tool Render Components Registry
 */
export const GroupManagementRenders = {
  [GroupManagementApiName.broadcast]: BroadcastRender,
  [GroupManagementApiName.executeAgentTask]: ExecuteTaskRender,
  [GroupManagementApiName.executeAgentTasks]: ExecuteTasksRender,
  [GroupManagementApiName.speak]: SpeakRender,
};

export { default as BroadcastRender } from './Broadcast';
export { default as ExecuteTaskRender } from './ExecuteTask';
export { default as ExecuteTasksRender } from './ExecuteTasks';
export { default as SpeakRender } from './Speak';
