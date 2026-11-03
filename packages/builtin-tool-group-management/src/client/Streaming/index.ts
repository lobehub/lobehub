import type { BuiltinStreaming } from '@lobechat/types';

import { GroupManagementApiName } from '../../types';
import { BroadcastStreaming } from './Broadcast';
import { ExecuteTaskStreaming } from './ExecuteTask';
import { ExecuteTasksStreaming } from './ExecuteTasks';
import { SpeakStreaming } from './Speak';

/**
 * Group Management Streaming Components Registry
 *
 * Streaming components render tool calls while they are
 * still executing, allowing real-time feedback to users.
 */
export const GroupManagementStreamings: Record<string, BuiltinStreaming> = {
  [GroupManagementApiName.broadcast]: BroadcastStreaming as BuiltinStreaming,
  [GroupManagementApiName.executeAgentTask]: ExecuteTaskStreaming as BuiltinStreaming,
  [GroupManagementApiName.executeAgentTasks]: ExecuteTasksStreaming as BuiltinStreaming,
  [GroupManagementApiName.speak]: SpeakStreaming as BuiltinStreaming,
};
