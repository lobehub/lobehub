import type { QuickNoteResourceReference, QuickNoteResourceRole } from '@lobechat/types';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import isEqual from 'fast-deep-equal';

import {
  documentHistories,
  documents,
  quickNoteResources,
  quickNoteRuns,
  quickNotes,
  tasks,
  topics,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  type QuickNoteContext,
  quickNoteOwnershipWhere,
  quickNoteTopicAccessWhere,
} from './context';
import type { LinkQuickNoteResourceParams } from './types';

/** Resource-side Document alias used beside the Quick Note source Document. */
const quickNoteResourceDocuments = alias(documents, 'quick_note_resource_documents');

export const queryResources = async (ctx: QuickNoteContext, quickNoteId: string) => {
  const rows = await ctx.db
    .select({
      agentId: topics.agentId,
      createdAt: quickNoteResources.createdAt,
      documentContent: quickNoteResourceDocuments.content,
      documentFilename: quickNoteResourceDocuments.filename,
      documentTitle: quickNoteResourceDocuments.title,
      id: quickNoteResources.id,
      noteEditorData: documents.editorData,
      resourceId: quickNoteResources.resourceId,
      resourceType: quickNoteResources.resourceType,
      role: quickNoteResources.role,
      runId: quickNoteResources.runId,
      selector: quickNoteResources.selector,
      sourceEditorData: documentHistories.editorData,
      taskIdentifier: tasks.identifier,
      taskName: tasks.name,
      taskStatus: tasks.status,
      topicContent: topics.content,
      topicTitle: topics.title,
    })
    .from(quickNoteResources)
    .innerJoin(quickNotes, eq(quickNotes.id, quickNoteResources.quickNoteId))
    .innerJoin(documents, eq(documents.id, quickNotes.documentId))
    .innerJoin(documentHistories, eq(documentHistories.id, quickNoteResources.sourceHistoryId))
    .leftJoin(
      quickNoteResourceDocuments,
      eq(quickNoteResourceDocuments.id, quickNoteResources.resourceId),
    )
    .leftJoin(topics, eq(topics.id, quickNoteResources.resourceId))
    .leftJoin(tasks, eq(tasks.id, quickNoteResources.resourceId))
    .where(
      and(
        eq(quickNoteResources.quickNoteId, quickNoteId),
        eq(quickNoteResources.role, 'context'),
        quickNoteOwnershipWhere(ctx),
      ),
    )
    .orderBy(desc(quickNoteResources.createdAt), desc(quickNoteResources.id));

  const seen = new Set<string>();
  return rows.flatMap(
    ({
      documentContent,
      documentFilename,
      documentTitle,
      noteEditorData,
      sourceEditorData,
      taskIdentifier,
      taskName,
      topicContent,
      topicTitle,
      ...resource
    }) => {
      // Run-linked context describes one source revision; user-supplied links (no Run) stay.
      if (resource.runId && !isEqual(noteEditorData, sourceEditorData)) return [];
      const identity = `${resource.resourceType}:${resource.resourceId}:${JSON.stringify(resource.selector)}`;
      if (seen.has(identity)) return [];
      seen.add(identity);

      return [
        {
          ...resource,
          label:
            taskName ??
            taskIdentifier ??
            topicTitle ??
            documentTitle ??
            documentFilename ??
            topicContent ??
            documentContent ??
            null,
          taskIdentifier,
        },
      ];
    },
  );
};

/**
 * Checks that the caller may reference one typed product resource.
 *
 * Returns:
 * - `{ documentId }` (set for Document/Page resources) when accessible, otherwise `undefined`.
 */
const authorizeResource = async (
  ctx: QuickNoteContext,
  db: LobeChatDatabase,
  reference: QuickNoteResourceReference,
): Promise<{ documentId?: string } | undefined> => {
  if (reference.type === 'document' || reference.type === 'page') {
    const documentOwnership = ctx.workspaceId
      ? and(
          eq(documents.workspaceId, ctx.workspaceId),
          sql`(${documents.visibility} = 'public' OR ${documents.userId} = ${ctx.userId})`,
        )
      : and(eq(documents.userId, ctx.userId), isNull(documents.workspaceId));
    const [document] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, reference.id), documentOwnership));

    return document ? { documentId: document.id } : undefined;
  }

  if (reference.type === 'topic' || reference.type === 'conversation') {
    const [topic] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(and(eq(topics.id, reference.id), quickNoteTopicAccessWhere(ctx)));

    return topic ? {} : undefined;
  }

  // TODO: Add native authorization providers for Message, Thread, Task, Turn, and generic Resource.
  return undefined;
};

/**
 * Inserts one authorized resource link, or returns the identical existing link.
 *
 * Expects:
 * - The caller already verified that `quickNoteId` is owned and `reference` is accessible.
 */
const insertResource = async (
  ctx: QuickNoteContext,
  db: LobeChatDatabase,
  params: {
    documentId?: string;
    quickNoteId: string;
    reference: QuickNoteResourceReference;
    role: QuickNoteResourceRole;
    runId?: string;
    sourceHistoryId: string;
  },
) => {
  const [created] = await db
    .insert(quickNoteResources)
    .values({
      documentId: params.documentId,
      quickNoteId: params.quickNoteId,
      resourceId: params.reference.id,
      resourceType: params.reference.type,
      role: params.role,
      runId: params.runId,
      selector: params.reference.selector,
      sourceHistoryId: params.sourceHistoryId,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [existing] = await db
    .select()
    .from(quickNoteResources)
    .where(
      and(
        eq(quickNoteResources.quickNoteId, params.quickNoteId),
        eq(quickNoteResources.sourceHistoryId, params.sourceHistoryId),
        eq(quickNoteResources.resourceId, params.reference.id),
        eq(quickNoteResources.resourceType, params.reference.type),
        eq(quickNoteResources.role, params.role),
      ),
    );

  return existing;
};

/**
 * Links one accessible resource as context found by a Run, against the Run's source revision.
 *
 * Returns:
 * - The resource link carrying `run_id`, or `undefined` when the Run or resource is inaccessible.
 */
export const linkResource = async (
  ctx: QuickNoteContext,
  runId: string,
  params: LinkQuickNoteResourceParams,
) =>
  ctx.db.transaction(async (trx) => {
    const tx = trx as LobeChatDatabase;
    const [run] = await tx
      .select({
        quickNoteId: quickNoteRuns.quickNoteId,
        sourceHistoryId: quickNoteRuns.sourceHistoryId,
      })
      .from(quickNoteRuns)
      .innerJoin(quickNotes, eq(quickNotes.id, quickNoteRuns.quickNoteId))
      .where(and(eq(quickNoteRuns.id, runId), quickNoteOwnershipWhere(ctx)));
    if (!run) return undefined;

    const access = await authorizeResource(ctx, tx, params);
    if (!access) return undefined;

    return insertResource(ctx, tx, {
      documentId: access.documentId,
      quickNoteId: run.quickNoteId,
      reference: params,
      role: params.role ?? 'context',
      runId,
      sourceHistoryId: run.sourceHistoryId,
    });
  });

/**
 * Links user-supplied resources, such as the objects a capture was sent from, without a Run.
 *
 * Expects:
 * - `sourceHistoryId` is a revision of the owned Quick Note's Document.
 * - Inaccessible references are skipped rather than failing the whole batch.
 *
 * Returns:
 * - The links that were created or already existed.
 */
export const linkUserResources = async (
  ctx: QuickNoteContext,
  quickNoteId: string,
  sourceHistoryId: string,
  references: QuickNoteResourceReference[],
) => {
  const [owned] = await ctx.db
    .select({ id: quickNotes.id })
    .from(quickNotes)
    .where(and(eq(quickNotes.id, quickNoteId), quickNoteOwnershipWhere(ctx)));
  if (!owned) return [];

  const linked = [];
  for (const reference of references) {
    const access = await authorizeResource(ctx, ctx.db, reference);
    if (!access) continue;

    const resource = await insertResource(ctx, ctx.db, {
      documentId: access.documentId,
      quickNoteId,
      reference,
      role: 'context',
      sourceHistoryId,
    });
    if (resource) linked.push(resource);
  }

  return linked;
};

export const linkDocumentResource = async (
  ctx: QuickNoteContext,
  runId: string,
  documentId: string,
  role: QuickNoteResourceRole = 'context',
) => linkResource(ctx, runId, { id: documentId, role, type: 'document' });
