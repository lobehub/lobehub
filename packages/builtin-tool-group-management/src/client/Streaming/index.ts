import type { BuiltinStreaming } from '@lobechat/types';

import { GroupManagementApiName } from '../../types';
import { BroadcastStreaming } from './Broadcast';
import { SpeakStreaming } from './Speak';

/**
 * Group Management Streaming Components Registry
 *
 * Streaming components render tool calls while they are
 * still executing, allowing real-time feedback to users.
 */
export const GroupManagementStreamings: Record<string, BuiltinStreaming> = {
  [GroupManagementApiName.broadcast]: BroadcastStreaming as BuiltinStreaming,
  [GroupManagementApiName.speak]: SpeakStreaming as BuiltinStreaming,
};
