import { ProjectIdentifier } from '@lobechat/builtin-tool-project';
import { ProjectExecutionRuntime } from '@lobechat/builtin-tool-project/executionRuntime';

import { createProjectToolService } from '@/server/services/project/toolService';

import { resolveContentWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

export const projectRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.userId || !context.serverDB)
      throw new Error('userId and serverDB are required for Project tool execution');
    // Offered only inside a project conversation; a run without one has nothing to act on.
    if (!context.projectId)
      throw new Error('The Project tool works only in a project conversation');

    return new ProjectExecutionRuntime(
      createProjectToolService(context.serverDB, {
        projectId: context.projectId,
        topicId: context.topicId,
        userId: context.userId,
        workspaceId: await resolveContentWorkspaceId(context),
      }),
    );
  },
  identifier: ProjectIdentifier,
};
