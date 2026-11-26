import { isWithholdableContextSource, memoryPersonaRevision } from '@lobechat/context-engine';
import type { AgentShareVisitorContext, ContextReplaySnapshot } from '@lobechat/types';
import {
  agentShareDocumentAccessScope,
  agentShareFileAccessScope,
  ordinaryDocumentAccessScope,
  ordinaryFileAccessScope,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';

import { AgentDocumentModel, canReadDocument } from '@/database/models/agentDocuments';
import { FileModel } from '@/database/models/file';
import { GoalModel } from '@/database/models/goal';
import type { MessageModel } from '@/database/models/message';
import { ProjectModel } from '@/database/models/project';
import { TaskModel } from '@/database/models/task';
import { TopicModel } from '@/database/models/topic';
import { UserMemoryActivityModel } from '@/database/models/userMemory/activity';
import { UserMemoryContextModel } from '@/database/models/userMemory/context';
import { UserMemoryExperienceModel } from '@/database/models/userMemory/experience';
import { UserMemoryIdentityModel } from '@/database/models/userMemory/identity';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { UserMemoryPreferenceModel } from '@/database/models/userMemory/preference';
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
  shareVisitor?: AgentShareVisitorContext;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

/** Re-check old dependencies, not merely the resources selected for this turn. */
export const revokedContextSources = async (ctx: ReplayAccessContext, sourceIds: string[]) => {
  const documentScope = ctx.shareVisitor
    ? agentShareDocumentAccessScope({ ...ctx.shareVisitor, topicId: ctx.topicId ?? '' })
    : ordinaryDocumentAccessScope;
  const documents = new AgentDocumentsService(
    ctx.db,
    ctx.userId,
    ctx.workspaceId,
    undefined,
    documentScope,
  );
  const fileScope = ctx.shareVisitor
    ? agentShareFileAccessScope(ctx.shareVisitor)
    : ordinaryFileAccessScope;
  const files = new FileModel(ctx.db, ctx.userId, ctx.workspaceId);
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
            const doc = ctx.agentId && (await documents.getDocumentById(id, ctx.agentId));
            return !!doc && canReadDocument(doc);
          }
          case 'document-read': {
            if (!ctx.agentId) return false;
            const revoked = await findRevokedDocumentReads(
              new AgentDocumentModel(ctx.db, ctx.userId, ctx.workspaceId, documentScope),
              ctx.agentId,
              [id],
            );
            if (revoked.documentIds.includes(id) || revoked.agentDocumentReadIds?.includes(id))
              return false;
            const doc = await documents.getDocumentById(id, ctx.agentId);
            if (doc) return canReadDocument(doc);
            if (ctx.shareVisitor) return !!(await files.findById(id, { accessScope: fileScope }));
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
            return !!(await files.findById(id, { accessScope: fileScope }));
          }
          case 'file': {
            return !!(await files.findById(id, { accessScope: fileScope }));
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
            const topic = await new TopicModel(ctx.db, ctx.userId, ctx.workspaceId, undefined, {
              includeShareVisitor: !!ctx.shareVisitor,
            }).findById(id);
            if (!topic) return false;
            if (ctx.shareVisitor)
              return (
                topic.senderId === ctx.shareVisitor.visitorUserId &&
                topic.agentId === ctx.shareVisitor.agentId
              );
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
          case 'memory': {
            if (ctx.shareVisitor && !ctx.shareVisitor.allowReadMemory) return false;
            const colon = id.indexOf(':');
            const type = id.slice(0, colon);
            const memoryId = id.slice(colon + 1);
            const models = {
              activities: UserMemoryActivityModel,
              contexts: UserMemoryContextModel,
              experiences: UserMemoryExperienceModel,
              identities: UserMemoryIdentityModel,
              preferences: UserMemoryPreferenceModel,
            };
            const Model = models[type as keyof typeof models];
            return (
              colon > 0 && !!Model && !!(await new Model(ctx.db, ctx.userId).findById(memoryId))
            );
          }
          case 'memory-persona': {
            if (ctx.shareVisitor && !ctx.shareVisitor.allowReadMemory) return false;
            const persona = await new UserPersonaModel(
              ctx.db,
              ctx.userId,
            ).getLatestPersonaDocument();
            return (
              !!persona &&
              id ===
                (await memoryPersonaRevision({
                  narrative: persona.persona,
                  tagline: persona.tagline,
                }))
            );
          }
          // The engine checks these against this invocation's current eligible set.
          case 'skill':
          case 'tool': {
            return true;
          }
          default: {
            return false;
          }
        }
      } catch (error) {
        if (error instanceof TRPCError) return false;
        throw error;
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
    Object.entries(snapshots).map(([id, snapshot]) => {
      const blocking = snapshot.sourceIds.filter((source) => denied.has(source));
      if (blocking.some((source) => !isWithholdableContextSource(source)))
        return [
          id,
          { ...snapshot, changes: [], system: undefined, sourceIds: [], invalidated: true },
        ];
      if (!blocking.length) return [id, snapshot];
      return [
        id,
        {
          ...snapshot,
          changes: snapshot.changes.filter(
            (change) => !change.sourceIds.some((source) => denied.has(source)),
          ),
        },
      ];
    }),
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
      snapshot.sourceIds.some(
        (source) => source.startsWith('memory:') || source.startsWith('memory-persona:'),
      )
    )
      snapshot.invalidated = true;
  }
  const revoked = await revokedContextSources(
    ctx,
    Object.values(snapshots).flatMap((snapshot) => snapshot.sourceIds),
  );
  return redactRevokedSnapshots(snapshots, revoked);
};
