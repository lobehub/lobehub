import { DashboardIdentifier } from '@lobechat/builtin-tool-dashboard';
import { DashboardExecutionRuntime } from '@lobechat/builtin-tool-dashboard/executionRuntime';

import {
  createDashboardToolService,
  resolveTopicProjectId,
} from '@/server/services/widget/agentTool';
import { isDashboardEnabled } from '@/server/services/widget/featureGate';

import { resolveContentWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

export const dashboardRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Dashboard tool execution');
    }
    // The tool is never offered while the flag is off; refuse a stray call too.
    if (!(await isDashboardEnabled(context.userId))) {
      throw new Error('Dashboards are not enabled for this account');
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
