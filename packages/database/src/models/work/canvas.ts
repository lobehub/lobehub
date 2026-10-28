import type {
  CanvasWorkPublishMetadata,
  RegisterCanvasWorkParams,
  WorkItem,
  WorkMetadata,
  WorkVersionItem,
} from '@lobechat/types';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { agents } from '../../schemas/agent';
import { works, workVersions } from '../../schemas/work';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { type WorkContext, workOwnership } from './context';
import { createDisplayWorkAdapter } from './displayWork';
import { registerWorkVersion } from './writes';

export const canvasWorkAdapter = createDisplayWorkAdapter({ type: 'canvas' });

export class CanvasVersionConflictError extends Error {
  constructor() {
    super('Canvas version conflict; read the latest version before saving again');
  }
}

const canvasResource = (ctx: WorkContext, canvasId: string) =>
  and(workOwnership(ctx), eq(works.resourceType, 'canvas'), eq(works.resourceId, canvasId));

export const registerCanvasWork = async (
  ctx: WorkContext,
  params: RegisterCanvasWorkParams,
): Promise<WorkItem> => {
  const [existing] = await ctx.db
    .select({ id: works.id, visibility: works.visibility })
    .from(works)
    .where(canvasResource(ctx, params.canvasId))
    .limit(1);

  // Inherit only at creation; later edits keep the canvas's own permissions.
  let visibility = existing?.visibility ?? params.visibility;
  if (!visibility && ctx.workspaceId && params.agentId) {
    const [agent] = await ctx.db
      .select({ visibility: agents.visibility })
      .from(agents)
      .where(and(eq(agents.id, params.agentId), buildWorkspaceWhere(ctx, agents)))
      .limit(1);
    visibility = agent?.visibility;
  }

  return registerWorkVersion(
    ctx,
    {
      resourceId: params.canvasId,
      resourceType: 'canvas',
      type: 'canvas',
      userId: ctx.userId,
      visibility: visibility ?? 'private',
    },
    {
      agentId: params.agentId,
      changeType: existing ? 'updated' : 'created',
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
      // The public link written by `recordCanvasPublish` lives on the Work, and
      // each registration replaces every display column, so carry it over.
      const [published] = await txCtx.db
        .select({ url: works.url, version: workVersions.version })
        .from(works)
        .leftJoin(workVersions, eq(workVersions.id, works.currentVersionId))
        .where(canvasResource(txCtx, params.canvasId))
        .limit(1);

      if (
        params.expectedVersion !== undefined &&
        (published?.version ?? 0) !== params.expectedVersion
      ) {
        throw new CanvasVersionConflictError();
      }

      return {
        display: {
          description: params.description ?? null,
          identifier: params.canvasId,
          title: params.title,
          url: published?.url ?? null,
        },
        metadata: { canvas: params.metadata },
      };
    },
  );
};

export interface CanvasWorkWithVersion {
  version: WorkVersionItem;
  work: WorkItem & { metadata: WorkMetadata | null };
}

export const findCanvasWork = async (
  ctx: WorkContext,
  canvasId: string,
): Promise<CanvasWorkWithVersion | null> => {
  const [row] = await ctx.db
    .select({ version: workVersions, work: works })
    .from(works)
    .innerJoin(workVersions, eq(workVersions.id, works.currentVersionId))
    .where(canvasResource(ctx, canvasId))
    .limit(1);

  return row ? { version: row.version, work: row.work as CanvasWorkWithVersion['work'] } : null;
};

export const findCanvasWorkVersion = async (
  ctx: WorkContext,
  workId: string,
  version: number,
): Promise<WorkVersionItem | null> => {
  const [row] = await ctx.db
    .select({ version: workVersions })
    .from(workVersions)
    .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
    .where(and(eq(works.id, workId), eq(works.type, 'canvas'), eq(workVersions.version, version)))
    .limit(1);

  return row?.version ?? null;
};

export const findCanvasWorkVersionByToolCall = async (
  ctx: WorkContext,
  canvasId: string,
  toolCallId: string,
): Promise<WorkVersionItem | null> => {
  const [row] = await ctx.db
    .select({ version: workVersions })
    .from(workVersions)
    .innerJoin(works, eq(works.id, workVersions.workId))
    .where(and(canvasResource(ctx, canvasId), eq(workVersions.toolCallId, toolCallId)))
    .limit(1);
  return row?.version ?? null;
};

export const findReferencedCanvasManifestKeys = async (ctx: WorkContext, keys: string[]) => {
  if (keys.length === 0) return [];
  const manifestKey = sql<string>`${workVersions.metadata} -> 'canvas' ->> 'manifestKey'`;
  const rows = await ctx.db
    .selectDistinct({ manifestKey })
    .from(workVersions)
    .innerJoin(works, eq(workVersions.workId, works.id))
    .where(
      and(
        // Object keys are shared by the user's canvases across all workspaces.
        eq(works.userId, ctx.userId),
        eq(works.resourceType, 'canvas'),
        inArray(manifestKey, keys),
      ),
    );
  return rows.map((row) => row.manifestKey);
};

export const listCanvasWorks = async (
  ctx: WorkContext,
  params: { agentId?: string | null; limit?: number },
): Promise<WorkItem[]> => {
  const rows = await ctx.db
    .select()
    .from(works)
    .where(
      and(
        workOwnership(ctx),
        eq(works.type, 'canvas'),
        params.agentId ? eq(works.originAgentId, params.agentId) : undefined,
      ),
    )
    .orderBy(desc(works.updatedAt), desc(works.id))
    .limit(params.limit ?? 20);

  return rows as WorkItem[];
};

export const recordCanvasPublish = async (
  ctx: WorkContext,
  canvasId: string,
  params: CanvasWorkPublishMetadata & { url: string },
): Promise<WorkItem | null> => {
  const publish: CanvasWorkPublishMetadata = {
    deploymentId: params.deploymentId,
    publishedVersion: params.publishedVersion,
  };
  const [row] = await ctx.db
    .update(works)
    .set({
      metadata: sql`coalesce(${works.metadata}, '{}'::jsonb) || jsonb_build_object('canvasPublish', ${JSON.stringify(publish)}::jsonb)`,
      url: params.url,
    })
    .where(and(canvasResource(ctx, canvasId), eq(works.userId, ctx.userId)))
    .returning();

  return (row as WorkItem | undefined) ?? null;
};
