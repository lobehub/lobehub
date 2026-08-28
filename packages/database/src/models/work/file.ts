import type { RegisterFileWorkParams, WorkItem } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { works, workVersions } from '../../schemas/work';
import { type WorkContext, workOwnership } from './context';
import { createDisplayWorkAdapter } from './displayWork';
import { registerWorkVersion } from './writes';

/**
 * File Works are fully display-backed (like document / external): their list
 * and summary rows come straight from the `works` display columns, with the
 * per-version file identity carried in the version `metadata`. No live table
 * join, so the shared display adapter covers every query path.
 *
 * Registration (turning an operation's edited entity files into file Works) is
 * wired by the server-side consumer; this adapter only serves the read side.
 */
export const fileWorkAdapter = createDisplayWorkAdapter({ type: 'file' });

/**
 * Resource identity of a `file` Work: `${userId}:${topicId}:${filePath}`.
 *
 * The sandbox a file is edited in is derived per (userId, topicId), so a file's
 * identity intrinsically includes its owning user. `userId` is part of the key
 * (not just the ownership predicate) because the workspace unique index is
 * `(workspaceId, resourceType, resourceId)` — it does NOT include userId. In a
 * shared topic, two members editing a same-named path would otherwise collide on
 * one private Work that only the first registrant can resolve.
 */
export const fileWorkResourceId = (userId: string, topicId: string, filePath: string): string =>
  `${userId}:${topicId}:${filePath}`;

/**
 * Last path segment of a file path, tolerating either separator (`/` or `\`) and
 * a trailing slash; '' when the path has no usable segment. Mirrors the
 * builtin-tools `getBasename` without pulling that package into the DB layer —
 * used to denormalize the `identifier` display column (see {@link registerFileWork}).
 */
const fileBasename = (filePath: string): string =>
  filePath.replaceAll('\\', '/').split('/').findLast(Boolean)?.trim() ?? '';

/**
 * Existence probe for the one-version-per-operation dedup key (`op:${operationId}`).
 * Resolves the file Work by its resource identity and checks for a version with
 * the given `toolCallId` in a SINGLE joined query, so the server-side consumer
 * can short-circuit BEFORE re-exporting/uploading the file on a retry (the
 * export overwrites the object and the register would otherwise leave an orphan
 * file record). Returns the matching version id, or null when none exists.
 */
export const findFileWorkVersionByToolCall = async (
  ctx: WorkContext,
  params: { filePath: string; toolCallId: string; topicId: string; userId: string },
): Promise<{ id: string } | null> => {
  const resourceId = fileWorkResourceId(params.userId, params.topicId, params.filePath);

  const [version] = await ctx.db
    .select({ id: workVersions.id })
    .from(workVersions)
    .innerJoin(works, eq(works.id, workVersions.workId))
    .where(
      and(
        workOwnership(ctx),
        eq(works.resourceType, 'file'),
        eq(works.resourceId, resourceId),
        eq(workVersions.toolCallId, params.toolCallId),
      ),
    )
    .limit(1);

  return version ?? null;
};

/**
 * Register an entity file edited during an operation as a `file` Work.
 *
 * Identity: `resourceId = ${userId}:${topicId}:${filePath}` (see
 * {@link fileWorkResourceId}), so re-editing the same file in a later operation
 * adds a new version to the same Work. `changeType` is derived here from whether
 * that Work already exists — a first registration is `created`, any later one
 * `updated`.
 *
 * The existence probe is a best-effort read OUTSIDE the version transaction, so
 * a rare concurrent first-registration race could mislabel one row's
 * `changeType`; the version write itself stays correct regardless (the
 * `(workId, toolCallId)` unique guard inside {@link registerWorkVersion} makes a
 * same-operation retry idempotent).
 *
 * The denormalized `description` (file path) and `url` (uploaded file URL)
 * display columns are written alongside the basename `title` so list consumers
 * (Working Sidebar / Gallery) can render the path and open the file without
 * expanding the version metadata.
 */
export const registerFileWork = async (
  ctx: WorkContext,
  params: RegisterFileWorkParams,
): Promise<WorkItem> => {
  const resourceId = fileWorkResourceId(params.userId, params.topicId, params.filePath);

  const [existing] = await ctx.db
    .select({ id: works.id })
    .from(works)
    .where(
      and(workOwnership(ctx), eq(works.resourceType, 'file'), eq(works.resourceId, resourceId)),
    )
    .limit(1);

  const changeType = existing ? 'updated' : 'created';

  return registerWorkVersion(
    ctx,
    {
      resourceId,
      resourceType: 'file',
      type: 'file',
      userId: params.userId,
      visibility: params.visibility ?? 'private',
    },
    {
      agentId: params.agentId,
      changeType,
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
      // Layer-3 `content` stays null — the file itself is the deliverable,
      // opened via the metadata fileUrl; the card only needs its basename.
      // `description`/`url` are denormalized so list rows (which don't carry
      // version metadata) can still show the path and an open target.
      // `identifier` is denormalized to the file's basename (its "human
      // reference", written to both the works row and the version row) so the
      // sidebar's fallback label renders the filename instead of leaking the
      // internal `resourceId` (`userId:topicId:filePath`).
      display: {
        description: params.filePath,
        identifier: fileBasename(params.filePath) || null,
        title: params.title,
        url: params.metadata.fileUrl ?? null,
      },
      metadata: params.metadata,
    }),
  );
};
