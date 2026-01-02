import { GroupManagementApiName } from '../../types';
import BroadcastRender from './Broadcast';
import ExecuteTaskRender from './ExecuteTask';
import SpeakRender from './Speak';

/**
 * Group Management Tool Render Components Registry
 */
export const GroupManagementRenders = {
  [GroupManagementApiName.broadcast]: BroadcastRender,
  [GroupManagementApiName.executeTask]: ExecuteTaskRender,
  [GroupManagementApiName.speak]: SpeakRender,
};

export { default as BroadcastRender } from './Broadcast';
export { default as ExecuteTaskRender } from './ExecuteTask';
export { default as SpeakRender } from './Speak';
