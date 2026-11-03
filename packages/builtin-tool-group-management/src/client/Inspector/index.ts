import type { BuiltinInspector } from '@lobechat/types';

import { GroupManagementApiName } from '../../types';
import { BroadcastInspector } from './Broadcast';
import { ExecuteAgentTaskInspector } from './ExecuteAgentTask';
import { ExecuteAgentTasksInspector } from './ExecuteAgentTasks';
import { SpeakInspector } from './Speak';

/**
 * Group Management Inspector Components Registry
 *
 * Inspector components customize the title/header area
 * of tool calls in the conversation UI.
 */
export const GroupManagementInspectors: Record<string, BuiltinInspector> = {
  [GroupManagementApiName.broadcast]: BroadcastInspector as BuiltinInspector,
  [GroupManagementApiName.executeAgentTask]: ExecuteAgentTaskInspector as BuiltinInspector,
  [GroupManagementApiName.executeAgentTasks]: ExecuteAgentTasksInspector as BuiltinInspector,
  [GroupManagementApiName.speak]: SpeakInspector as BuiltinInspector,
};
