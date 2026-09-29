import { DashboardIdentifier } from '@lobechat/builtin-tool-dashboard';
import { DashboardExecutionRuntime } from '@lobechat/builtin-tool-dashboard/executionRuntime';

import {
  createDashboardToolService,
  resolveTopicProjectId,
} from '@/server/services/dashboard/agentTool';

import { resolveContentWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

export const dashboardRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Dashboard tool execution');
    }
    const db = context.serverDB;
    const [workspaceId, projectId] = await Promise.all([
      resolveContentWorkspaceId(context),
      resolveTopicProjectId(db, context.topicId),
    ]);

    return new DashboardExecutionRuntime(
      createDashboardToolService(db, {
        agentId: context.agentId,
        messageId: context.assistantMessageId,
        operationId: context.operationId,
        projectId,
        topicId: context.topicId,
        userId: context.userId,
        workspaceId,
      }),
    );
  },
  identifier: DashboardIdentifier,
};
