import type {
  DeleteDocumentWorkParams,
  DeleteTaskWorkParams,
  WorkDisplayField,
  WorkItem,
  WorkResourceType,
  WorkType,
  WorkVisibility,
} from '@lobechat/types';
import { and, eq, sql } from 'drizzle-orm';

import { documents } from '../../schemas/file';
import { works, workVersions } from '../../schemas/work';
import type { LobeChatDatabase } from '../../type';
import { documentOwnership, type WorkContext, workOwnership } from './context';
import {
  type CreateVersionInput,
  truncateContentText,
  type WorkDisplayColumns,
  type WorkVersionEventParams,
} from './internal';

const MAX_VERSION_CREATE_RETRIES = 5;

/** Every display column, written when a registration carries complete data. */
const ALL_DISPLAY_FIELDS: WorkDisplayField[] = [
  'content',
  'description',
  'identifier',
  'status',
  'title',
  'url',
];

type WorkVersionSnapshot = Record<WorkDisplayField, string | null>;

const EMPTY_VERSION_SNAPSHOT: WorkVersionSnapshot = {
  content: null,
  description: null,
  identifier: null,
  status: null,
  title: null,
  url: null,
};

const versionSnapshotSelection = {
  content: workVersions.content,
  description: workVersions.description,
  identifier: workVersions.identifier,
  status: workVersions.status,
  title: workVersions.title,
  url: workVersions.url,
};

const isUniqueViolation = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  const cause = error instanceof Error ? error.cause : undefined;
  const causeCode =
    typeof cause === 'object' && cause && 'code' in cause
      ? String((cause as { code?: unknown }).code)
      : '';

  return (
    code === '23505' ||
    causeCode === '23505' ||
    message.includes('23505') ||
    message.includes('duplicate') ||
    message.includes('unique')
  );
};

const findVersionByToolCall = async (
  ctx: WorkContext,
  workId: string,
  toolCallId?: string | null,
) => {
  if (!toolCallId) return null;

  const [version] = await ctx.db
    .select()
    .from(workVersions)
    .where(and(eq(workVersions.workId, workId), eq(workVersions.toolCallId, toolCallId)))
    .limit(1);

  return version ?? null;
};

interface RegisterWorkIdentity {
  resourceId: string;
  resourceType: WorkResourceType;
  type: WorkType;
  userId: string;
  visibility: WorkVisibility;
}

/**
 * Build the next complete immutable display snapshot. A partial registration
 * starts from the locked Work's current version and replaces only named fields;
 * a complete registration starts empty, so omitted fields become null.
 */
const buildVersionSnapshot = (
  input: CreateVersionInput,
  currentSnapshot?: WorkDisplayColumns,
): WorkVersionSnapshot => {
  const snapshot: WorkVersionSnapshot = input.patchFields
    ? { ...EMPTY_VERSION_SNAPSHOT, ...currentSnapshot }
    : { ...EMPTY_VERSION_SNAPSHOT };

  const fields = input.patchFields ?? ALL_DISPLAY_FIELDS;
  for (const field of fields) {
    const value = input.display[field] ?? null;
    // `content` is the only unbounded free-text field; cap it at the single
    // choke point shared by every version-registration path.
    snapshot[field] = field === 'content' ? truncateContentText(value) : value;
  }

  return snapshot;
};

/**
 * Shared registration pipeline: find-or-create the Work identity, dedupe by
 * toolCallId, allocate the next version number, insert the complete immutable
 * snapshot, and update the Work's current projection in ONE transaction. Retry
 * on unique-violation races (either the `(workId, version)` or the
 * `(workId, toolCallId)` unique index).
 *
 * `buildInput` runs inside the transaction, after a `FOR UPDATE` lock on the
 * works row (same pattern as `TopicModel.updateMetadata`): a concurrent
 * registration holds that lock until its commit, so a partial update always
 * merges against the actual latest snapshot. Without the lock, it could copy a
 * stale snapshot into a cleanly allocated next version without triggering a
 * uniqueness retry. Callers must do their reads through the tx-scoped context
 * `buildInput` receives.
 */
export const registerWorkVersion = async (
  ctx: WorkContext,
  identity: RegisterWorkIdentity,
  params: WorkVersionEventParams,
  buildInput: (txCtx: WorkContext) => CreateVersionInput | Promise<CreateVersionInput>,
): Promise<WorkItem> => {
  for (let attempt = 0; attempt < MAX_VERSION_CREATE_RETRIES; attempt += 1) {
    try {
      return await ctx.db.transaction(async (tx) => {
        const txCtx: WorkContext = { ...ctx, db: tx as LobeChatDatabase };

        // Bare ON CONFLICT handles either owner-scope partial unique index. A
        // conflict performs no UPDATE, so an idempotent replay cannot bump
        // updatedAt before its toolCallId is checked under the Work row lock.
        const [inserted] = await tx
          .insert(works)
          .values({
            ...identity,
            // Origin provenance is stamped ONLY here: it records where the Work
            // identity was first registered and stays immutable through every
            // later version (the current-projection UPDATE below never touches it).
            originAgentId: params.agentId ?? null,
            originThreadId: params.threadId ?? null,
            originTopicId: params.topicId ?? null,
            toolIdentifier: params.toolIdentifier,
            toolName: params.toolName,
            workspaceId: ctx.workspaceId ?? null,
          })
          .onConflictDoNothing()
          .returning();

        const [resolved] = inserted
          ? [inserted]
          : await tx
              .select()
              .from(works)
              .where(
                and(
                  workOwnership(txCtx),
                  eq(works.resourceType, identity.resourceType),
                  eq(works.resourceId, identity.resourceId),
                ),
              )
              .limit(1);
        if (!resolved) throw new Error(`Failed to resolve ${identity.type} Work identity`);

        const [locked] = await tx
          .select()
          .from(works)
          .where(and(eq(works.id, resolved.id), workOwnership(txCtx)))
          .for('update');
        if (!locked) throw new Error(`Work ${resolved.id} no longer exists`);

        const dedupedUnderLock = await findVersionByToolCall(txCtx, locked.id, params.toolCallId);
        if (dedupedUnderLock) return locked;

        const input = await buildInput(txCtx);
        const [currentSnapshot] = locked.currentVersionId
          ? await tx
              .select(versionSnapshotSelection)
              .from(workVersions)
              .where(
                and(
                  eq(workVersions.id, locked.currentVersionId),
                  eq(workVersions.workId, locked.id),
                ),
              )
              .limit(1)
          : [];
        const snapshot = buildVersionSnapshot(input, currentSnapshot);

        const now = new Date();
        const [next] = await tx
          .select({
            version: sql<number>`COALESCE(MAX(${workVersions.version}), 0) + 1`,
          })
          .from(workVersions)
          .where(eq(workVersions.workId, locked.id));

        const [version] = await tx
          .insert(workVersions)
          .values({
            agentId: params.agentId ?? null,
            content: snapshot.content,
            // Written once at insert time: the agent runtime resolves the tool
            // call's cumulative cost only AFTER execution (in `accumulateTool`),
            // then registers the Work — so cost lands with the row instead of a
            // follow-up UPDATE. Null for non-agent paths (e.g. manual document
            // edits) that carry no cost.
            cumulativeCost: params.cumulativeCost ?? null,
            cumulativeUsage: params.cumulativeUsage ?? null,
            description: snapshot.description,
            identifier: snapshot.identifier,
            messageId: params.messageId ?? null,
            metadata: input.metadata ?? null,
            changeType: params.changeType,
            rootOperationId: params.rootOperationId ?? null,
            status: snapshot.status,
            threadId: params.threadId ?? null,
            title: snapshot.title,
            topicId: params.topicId ?? null,
            toolCallId: params.toolCallId ?? null,
            toolIdentifier: params.toolIdentifier,
            toolName: params.toolName,
            url: snapshot.url,
            version: Number(next.version),
            workId: locked.id,
            createdAt: now,
          })
          .returning();

        const [updatedWork] = await tx
          .update(works)
          .set({
            currentVersionId: version.id,
            description: snapshot.description,
            identifier: snapshot.identifier,
            status: snapshot.status,
            title: snapshot.title,
            toolIdentifier: params.toolIdentifier,
            toolName: params.toolName,
            updatedAt: now,
            url: snapshot.url,
            userId: identity.userId,
            visibility: identity.visibility,
          })
          .where(and(eq(works.id, locked.id), workOwnership(txCtx)))
          .returning();
        if (!updatedWork) throw new Error(`Work ${locked.id} no longer exists`);

        return updatedWork;
      });
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === MAX_VERSION_CREATE_RETRIES - 1) throw error;
    }
  }

  throw new Error(`Failed to register ${identity.type} Work version after max retries`);
};

export const deleteDocumentWork = async (
  ctx: WorkContext,
  params: DeleteDocumentWorkParams,
): Promise<void> => {
  const [doc] = await ctx.db
    .select({ id: documents.id })
    .from(documents)
    .where(and(documentOwnership(ctx), eq(documents.id, params.documentId)))
    .limit(1);
  if (!doc) return;

  await ctx.db
    .delete(works)
    .where(
      and(workOwnership(ctx), eq(works.resourceType, 'document'), eq(works.resourceId, doc.id)),
    );
};

/**
 * Delete the task Work (and its versions via the `work_versions.workId`
 * cascade) for a task the agent removed through the deleteTask tool.
 *
 * Unlike {@link deleteDocumentWork} this does NOT re-resolve the resource
 * first: the task row is already gone by the time the tool-execution dispatch
 * layer calls this, so we can only locate the Work by its polymorphic
 * `resourceId` (= the task's internal id, captured into `result.state.taskId`
 * before deletion). Ownership still scopes the delete to the caller.
 */
export const deleteTaskWork = async (
  ctx: WorkContext,
  params: DeleteTaskWorkParams,
): Promise<void> => {
  await ctx.db
    .delete(works)
    .where(
      and(workOwnership(ctx), eq(works.resourceType, 'task'), eq(works.resourceId, params.taskId)),
    );
};
