import type { ContextReplaySnapshot } from '@lobechat/types';
import pMap from 'p-map';

import { AgentDocumentModel } from '@/database/models/agentDocuments';
import { FileModel } from '@/database/models/file';
import { GoalModel } from '@/database/models/goal';
import type { MessageModel } from '@/database/models/message';
import { ProjectModel } from '@/database/models/project';
import { TaskModel } from '@/database/models/task';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import {
  assertCanViewMessageTargets,
  assertCanViewTopicTargets,
} from '@/server/routers/lambda/_helpers/conversationResourceGuard';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { findRevokedDocumentReads } from '@/server/services/agentDocuments/revokedReads';
import { canPerformResourceAction, getResourceMeta } from '@/server/services/resourcePermission';

interface ReplayAccessContext {
  agentId?: string;
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/** Re-check old dependencies, not merely the resources selected for this turn. */
export const revokedContextSources = async (ctx: ReplayAccessContext, sourceIds: string[]) => {
  const documents = new AgentDocumentsService(ctx.db, ctx.userId, ctx.workspaceId);
  const projects = new ProjectModel(ctx.db, ctx.userId, ctx.workspaceId);
  const checked = await pMap(
    [...new Set(sourceIds)],
    async (source) => {
      const separator = source.indexOf(':');
      const kind = source.slice(0, separator);
      const id = source.slice(separator + 1);
      try {
        switch (kind) {
          case 'document': {
            return !!ctx.agentId && !!(await documents.getDocumentById(id, ctx.agentId));
          }
          case 'document-read': {
            if (!ctx.agentId) return false;
            const revoked = await findRevokedDocumentReads(
              new AgentDocumentModel(ctx.db, ctx.userId, ctx.workspaceId),
              ctx.agentId,
              [id],
            );
            if (revoked.documentIds.includes(id) || revoked.agentDocumentReadIds?.includes(id))
              return false;
            if (await documents.getDocumentById(id, ctx.agentId)) return true;
            const meta = await getResourceMeta(ctx.db, 'document', id);
            if (meta)
              return ctx.workspaceId
                ? await canPerformResourceAction({
                    ...ctx,
                    workspaceId: ctx.workspaceId,
                    meta,
                    action: 'view',
                    resourceType: 'document',
                    resourceId: id,
                  })
                : !meta.workspaceId && meta.userId === ctx.userId;
            return !!(await new FileModel(ctx.db, ctx.userId, ctx.workspaceId).findById(id));
          }
          case 'file': {
            return !!(await new FileModel(ctx.db, ctx.userId, ctx.workspaceId).findById(id));
          }
          case 'project': {
            return !!(await projects.findById(id));
          }
          case 'task': {
            return !!(await new TaskModel(ctx.db, ctx.userId, ctx.workspaceId).findById(id));
          }
          case 'goal': {
            const goal = await new GoalModel(ctx.db, ctx.userId, ctx.workspaceId).findById(id);
            return !!goal && (!goal.projectId || !!(await projects.findById(goal.projectId)));
          }
          case 'topic': {
            const topic = await new TopicModel(ctx.db, ctx.userId, ctx.workspaceId).findById(id);
            if (!topic) return false;
            await assertCanViewTopicTargets(ctx, [id]);
            return true;
          }
          case 'knowledgeBase': {
            const meta = await getResourceMeta(ctx.db, 'knowledgeBase', id);
            return (
              !!meta &&
              (ctx.workspaceId
                ? await canPerformResourceAction({
                    ...ctx,
                    workspaceId: ctx.workspaceId,
                    meta,
                    action: 'view',
                    resourceType: 'knowledgeBase',
                    resourceId: id,
                  })
                : !meta.workspaceId && meta.userId === ctx.userId)
            );
          }
          // The engine checks these against this invocation's current eligible set.
          case 'memory':
          case 'skill':
          case 'tool': {
            return true;
          }
          default: {
            return false;
          }
        }
      } catch {
        return false;
      }
    },
    { concurrency: 8 },
  );
  return sourceIds.filter((source) => !checked[[...new Set(sourceIds)].indexOf(source)]);
};

export const redactRevokedSnapshots = (
  snapshots: Record<string, ContextReplaySnapshot>,
  revoked: string[],
) => {
  const denied = new Set(revoked);
  return Object.fromEntries(
    Object.entries(snapshots).map(([id, snapshot]) => [
      id,
      snapshot.sourceIds.some((source) => denied.has(source))
        ? { ...snapshot, changes: [], system: undefined, sourceIds: [], invalidated: true }
        : snapshot,
    ]),
  );
};

export const loadContextReplays = async (
  ctx: ReplayAccessContext,
  model: Pick<MessageModel, 'getContextReplays' | 'getContextReplayDependencies'>,
  ids: string[],
) => {
  const [dependencies, own] = await Promise.all([
    model.getContextReplayDependencies(ids),
    model.getContextReplays(ids),
  ]);
  const snapshots = { ...dependencies, ...own };
  await assertCanViewMessageTargets(ctx, Object.keys(snapshots));
  for (const snapshot of Object.values(snapshots)) {
    if (
      snapshot.createdBy !== ctx.userId &&
      snapshot.sourceIds.some((source) => source.startsWith('memory:'))
    )
      snapshot.invalidated = true;
  }
  const revoked = await revokedContextSources(
    ctx,
    Object.values(snapshots).flatMap((snapshot) => snapshot.sourceIds),
  );
  return redactRevokedSnapshots(snapshots, revoked);
};
