import { ArtboardIdentifier } from '@lobechat/builtin-tool-artboard';
import { ArtboardExecutionRuntime } from '@lobechat/builtin-tool-artboard/executionRuntime';

import { createArtboardToolService } from '@/server/services/artboard/toolService';

import { resolveContentWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

export const artboardRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Artboard tool execution');
    }

    return new ArtboardExecutionRuntime(
      createArtboardToolService(context.serverDB, {
        agentId: context.agentId,
        taskId: context.taskId,
        threadId: context.threadId,
        topicId: context.topicId,
        userId: context.userId,
        workspaceId: await resolveContentWorkspaceId(context),
      }),
    );
  },
  identifier: ArtboardIdentifier,
};
