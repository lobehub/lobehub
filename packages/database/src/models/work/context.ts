import { agentDocuments } from '../../schemas/agentDocuments';
import { documents } from '../../schemas/file';
import { tasks } from '../../schemas/task';
import { works, workVersions } from '../../schemas/work';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

/**
 * Ambient dependencies every Work query/mutation needs. Passed as the first
 * argument to the per-type free functions instead of `this`, so the per-type
 * modules never import the `WorkModel` facade (keeping the dependency graph
 * acyclic).
 */
export interface WorkContext {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

export const workOwnership = (ctx: WorkContext) =>
  buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, works);

export const versionOwnership = (ctx: WorkContext) =>
  buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, workVersions);

export const taskOwnership = (ctx: WorkContext) =>
  buildWorkspaceWhere(
    { userId: ctx.userId, workspaceId: ctx.workspaceId },
    { userId: tasks.createdByUserId, workspaceId: tasks.workspaceId },
  );

export const documentOwnership = (ctx: WorkContext) =>
  buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, documents);

export const agentDocumentOwnership = (ctx: WorkContext) =>
  buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, agentDocuments);
