import type {
  ArtboardWorkPublishMetadata,
  RegisterArtboardWorkParams,
  WorkItem,
  WorkMetadata,
} from '@lobechat/types';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { projectWorks } from '../../schemas/projectWork';
import { works } from '../../schemas/work';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { type WorkContext, workOwnership } from './context';
import { createDisplayWorkAdapter } from './displayWork';
import { registerWorkVersion } from './writes';

export const artboardWorkAdapter = createDisplayWorkAdapter({ type: 'artboard' });

const artboardResource = (ctx: WorkContext, artboardId: string) =>
  and(workOwnership(ctx), eq(works.resourceType, 'artboard'), eq(works.resourceId, artboardId));

export type ArtboardWork = WorkItem & { metadata: WorkMetadata | null };

// Recycle-bin cleanup only: a teammate's private Work still has to come down with the task.
const artboardWorksInScope = (ctx: WorkContext, artboardIds: string[]) =>
  and(
    buildWorkspaceWhere(
      { userId: ctx.userId, workspaceId: ctx.workspaceId },
      { userId: works.userId, workspaceId: works.workspaceId },
    ),
    eq(works.resourceType, 'artboard'),
    inArray(works.resourceId, artboardIds),
  );

export const findArtboardWorksForTrash = async (
  ctx: WorkContext,
  artboardIds: string[],
): Promise<ArtboardWork[]> => {
  if (artboardIds.length === 0) return [];
  const rows = await ctx.db.select().from(works).where(artboardWorksInScope(ctx, artboardIds));
  return rows as ArtboardWork[];
};

export const clearArtboardPublishForTrash = async (
  ctx: WorkContext,
  artboardIds: string[],
): Promise<void> => {
  if (artboardIds.length === 0) return;
  await ctx.db
    .update(works)
    .set({
      metadata: sql`coalesce(${works.metadata}, '{}'::jsonb) - 'artboardPublish'`,
      url: null,
    })
    .where(artboardWorksInScope(ctx, artboardIds));
};

export const deleteArtboardWorksForTrash = async (
  ctx: WorkContext,
  artboardIds: string[],
): Promise<void> => {
  if (artboardIds.length === 0) return;
  await ctx.db.delete(works).where(artboardWorksInScope(ctx, artboardIds));
};

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
    async (txCtx) => {
      // The share link written by `recordArtboardPublish` lives on the Work, and
      // each registration replaces every display column, so carry it over.
      const [published] = await txCtx.db
        .select({ url: works.url })
        .from(works)
        .where(artboardResource(txCtx, params.artboardId))
        .limit(1);
      return {
        display: {
          description: params.description ?? null,
          identifier: params.artboardId,
          title: params.title,
          url: published?.url ?? null,
        },
      };
    },
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

export const findArtboardWork = async (
  ctx: WorkContext,
  artboardId: string,
): Promise<ArtboardWork | null> => {
  const [row] = await ctx.db.select().from(works).where(artboardResource(ctx, artboardId)).limit(1);
  return (row as ArtboardWork | undefined) ?? null;
};

export const findArtboardWorkByWorkId = async (
  ctx: WorkContext,
  workId: string,
): Promise<ArtboardWork | null> => {
  const [row] = await ctx.db
    .select()
    .from(works)
    .where(and(workOwnership(ctx), eq(works.id, workId), eq(works.resourceType, 'artboard')))
    .limit(1);
  return (row as ArtboardWork | undefined) ?? null;
};

export const recordArtboardPublish = async (
  ctx: WorkContext,
  artboardId: string,
  params: ArtboardWorkPublishMetadata & { url: string },
): Promise<WorkItem | null> => {
  const publish: ArtboardWorkPublishMetadata = {
    deploymentId: params.deploymentId,
    publishedRevision: params.publishedRevision,
    publisherUserId: params.publisherUserId,
    snapshotHash: params.snapshotHash,
  };
  const [row] = await ctx.db
    .update(works)
    .set({
      metadata: sql`coalesce(${works.metadata}, '{}'::jsonb) || jsonb_build_object('artboardPublish', ${JSON.stringify(publish)}::jsonb)`,
      url: params.url,
    })
    .where(artboardResource(ctx, artboardId))
    .returning();
  return (row as WorkItem | undefined) ?? null;
};

export const clearArtboardPublish = async (
  ctx: WorkContext,
  artboardId: string,
): Promise<WorkItem | null> => {
  const [row] = await ctx.db
    .update(works)
    .set({
      metadata: sql`coalesce(${works.metadata}, '{}'::jsonb) - 'artboardPublish'`,
      url: null,
    })
    .where(artboardResource(ctx, artboardId))
    .returning();
  return (row as WorkItem | undefined) ?? null;
};

export const findArtboardIdsByDeploymentIds = async (
  ctx: WorkContext,
  deploymentIds: string[],
): Promise<Record<string, string>> => {
  if (deploymentIds.length === 0) return {};

  const deploymentId = sql<string>`${works.metadata}->'artboardPublish'->>'deploymentId'`;
  const rows = await ctx.db
    .select({ artboardId: works.resourceId, deploymentId })
    .from(works)
    .where(
      and(
        workOwnership(ctx),
        eq(works.resourceType, 'artboard'),
        inArray(deploymentId, deploymentIds),
      ),
    );

  return Object.fromEntries(
    rows.flatMap((row) => (row.artboardId ? [[row.deploymentId, row.artboardId] as const] : [])),
  );
};
