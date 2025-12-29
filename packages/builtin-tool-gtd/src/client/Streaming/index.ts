import type { BuiltinStreaming } from '@lobechat/types';

import { GTDApiName } from '../../types';
import { ExecTaskStreaming } from './ExecTask';
import { ExecTasksStreaming } from './ExecTasks';

/**
 * GTD Streaming Components Registry
 *
 * Streaming components render tool calls while they are
 * still executing, allowing real-time feedback to users.
 */
export const GTDStreamings: Record<string, BuiltinStreaming> = {
  [GTDApiName.execTask]: ExecTaskStreaming as BuiltinStreaming,
  [GTDApiName.execTasks]: ExecTasksStreaming as BuiltinStreaming,
};

export { ExecTaskStreaming, ExecTasksStreaming };
