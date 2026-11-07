import type { RegisterArtboardWorkParams, WorkItem } from '@lobechat/types';

import { projectWorks } from '../../schemas/projectWork';
import type { WorkContext } from './context';
import { createDisplayWorkAdapter } from './displayWork';
import { registerWorkVersion } from './writes';

export const artboardWorkAdapter = createDisplayWorkAdapter({ type: 'artboard' });

export const registerArtboardWork = async (
  ctx: WorkContext,
  params: RegisterArtboardWorkParams,
): Promise<WorkItem> => {
  const work = await registerWorkVersion(
    ctx,
    {
      resourceId: params.artboardId,
      resourceType: 'artboard',
      type: 'artboard',
      userId: ctx.userId,
      visibility: 'private',
    },
    {
      agentId: params.agentId,
      changeType: params.changeType,
      cumulativeCost: params.cumulativeCost,
      cumulativeUsage: params.cumulativeUsage,
      messageId: params.messageId,
      rootOperationId: params.rootOperationId,
      threadId: params.threadId,
      toolCallId: params.toolCallId,
      toolIdentifier: params.toolIdentifier,
      toolName: params.toolName,
      topicId: params.topicId,
    },
    () => ({
      display: {
        description: params.description ?? null,
        identifier: params.artboardId,
        title: params.title,
        url: null,
      },
    }),
  );

  if (params.projectId)
    await ctx.db
      .insert(projectWorks)
      .values({
        addedByUserId: ctx.userId,
        projectId: params.projectId,
        workId: work.id,
        workspaceId: ctx.workspaceId ?? null,
      })
      .onConflictDoNothing({ target: [projectWorks.projectId, projectWorks.workId] });

  return work;
};
