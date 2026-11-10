import { CanvasIdentifier } from '@lobechat/builtin-tool-canvas';

import { createCanvasAgentRuntime } from '@/server/services/canvas/agentRuntime';

import { resolveContentWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

export const canvasRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Canvas tool execution');
    }

    return createCanvasAgentRuntime(context.serverDB, {
      agentId: context.agentId,
      threadId: context.threadId,
      topicId: context.topicId,
      userId: context.userId,
      workspaceId: await resolveContentWorkspaceId(context),
    });
  },
  identifier: CanvasIdentifier,
};
