import {
  DEFAULT_QUICK_NOTE_SETTINGS,
  DOCUMENT_HISTORY_AUTOSAVE_SOURCE_LIMIT,
  DOCUMENT_HISTORY_AUTOSAVE_WINDOW_MS,
} from '@lobechat/const';
import type {
  QuickNoteAnalyzeTrigger,
  QuickNoteProposalDecisionStatus,
  QuickNoteProposalKind,
  QuickNoteResourceReference,
  QuickNoteResourceRole,
  QuickNoteRunExecutionConfig,
  QuickNoteRunKind,
  UserQuickNoteSettings,
} from '@lobechat/types';
import { and, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import isEqual from 'fast-deep-equal';

import type { QuickNoteProposalItem } from '../schemas';
import {
  documentHistories,
  documents,
  quickNoteCommentRevisions,
  quickNoteComments,
  quickNoteProposals,
  quickNoteResources,
  quickNoteRunInputs,
  quickNoteRunResources,
  quickNoteRuns,
  quickNotes,
  tasks,
  topics,
  userSettings,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { idGenerator } from '../utils/idGenerator';
import { TaskModel } from './task';

/** Resource-side Document alias used beside the Quick Note source Document. */
const quickNoteResourceDocuments = alias(documents, 'quick_note_resource_documents');

interface QuickNoteEditorData extends Record<string, unknown> {}

/** Input used to atomically create a Quick Note and its backing containers. */
export interface CreateQuickNoteParams {
  /** Optional collection label chosen by the user. */
  collection?: string | null;
  /** Plain-text projection of the rich-text editor content. */
  content?: string;
  /** Rich-text source stored in the backing Document. */
  editorData?: QuickNoteEditorData;
  /** Optional client-generated Quick Note identifier. */
  id?: string;
  /** Optional location hint attached directly to the capture. */
  location?: string | null;
  /** Lightweight labels attached directly to the capture. */
  tags?: string[];
}

/** Mutable source fields persisted by the editor autosave path. */
export interface UpdateQuickNoteContentParams {
  /** When Automatic Analyze becomes eligible for dispatch. */
  analyzeDueAt?: Date | null;
  /** Plain-text projection of the rich-text editor content. */
  content: string;
  /** Rich-text source stored in the backing Document. */
  editorData: QuickNoteEditorData;
}

/** Input used to claim an immutable processing Run. */
export interface ClaimQuickNoteRunParams {
  /** Processing mode to dispatch for the pinned source revision. */
  kind: QuickNoteRunKind;
  /** Provenance for Analyze; omitted for Dive and internal enrichment. */
  trigger?: QuickNoteAnalyzeTrigger;
}

/** Accepted lightweight interpretation produced by a Quick Note Run. */
export interface AcceptQuickNoteAnnotationParams {
  /** Concise Markdown projection shown by the existing Annotation panel. */
  content: string;
  /** Rich-text representation of the accepted Annotation revision. */
  editorData?: QuickNoteEditorData;
  /** Optional downstream suggestions persisted without executing them. */
  proposals?: QuickNoteProposalDraft[];
  /** Lightweight labels merged onto the Quick Note. */
  tags?: string[];
}

/** Editable downstream suggestion returned by Quick Note interpretation. */
export interface QuickNoteProposalDraft {
  /** Markdown projection stored in the Proposal's backing Document. */
  content: string;
  /** Rich-text representation of the Proposal body. */
  editorData?: QuickNoteEditorData;
  /** Product object the Proposal could create after explicit acceptance. */
  kind: QuickNoteProposalKind;
}

/** Input used to append user context to a Quick Note. */
export interface CreateQuickNoteCommentParams {
  /** Plain-text projection shown in the comment stream. */
  content: string;
  /** Optional rich-text source retained with each immutable revision. */
  editorData?: QuickNoteEditorData;
}

/** Input used to edit a Quick Note Comment without losing its earlier text. */
export interface UpdateQuickNoteCommentParams extends CreateQuickNoteCommentParams {}

/** Input used to edit a Proposal's Document-backed body. */
export interface UpdateQuickNoteProposalParams {
  /** Markdown projection stored in the backing Document. */
  content: string;
  /** Rich-text representation stored in the new Document History. */
  editorData: QuickNoteEditorData;
}

/** Input used to persist a typed resource judged relevant to a Quick Note Run. */
export interface LinkQuickNoteResourceParams extends QuickNoteResourceReference {
  /** Meaning of the resource for the Quick Note source revision. */
  role?: QuickNoteResourceRole;
}

/**
 * Persists private Quick Notes and claims immutable processing snapshots.
 *
 * Use when:
 * - Saving the existing Quick Note editor without changing its UI contract.
 * - Dispatching Analyze or Dive against a stable source revision.
 *
 * Expects:
 * - `userId` identifies the owner of every read and mutation.
 * - `workspaceId` is omitted in personal mode and fixed for the model lifetime.
 *
 * Returns:
 * - Owner-scoped Quick Note records and immutable Run identities.
 */
export class QuickNoteModel {
  private readonly userId: string;
  private readonly workspaceId?: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /**
   * Resolves the effective Quick Note Analyze configuration for one user.
   *
   * Use when:
   * - Claiming or dispatching background Quick Note work.
   * - Resolving the Agent binding and immutable execution limits for a new Run.
   *
   * Expects:
   * - Missing fields fall back independently to {@link DEFAULT_QUICK_NOTE_SETTINGS}.
   * - Earlier `general.enableQuickNoteAutomaticDiscovery` values remain readable during rollout.
   *
   * Returns:
   * - A complete, bounded configuration suitable for scheduling and execution.
   */
  static getAnalyzeSettings = async (
    db: LobeChatDatabase,
    userId: string,
  ): Promise<UserQuickNoteSettings> => {
    const [settings] = await db
      .select({ general: userSettings.general, quickNote: userSettings.quickNote })
      .from(userSettings)
      .where(eq(userSettings.id, userId));
    const general = settings?.general as Record<string, unknown> | null | undefined;
    const stored = settings?.quickNote;
    const legacyEnabled = general?.enableQuickNoteAutomaticDiscovery;

    return {
      analyzeAgentId: stored?.analyzeAgentId ?? DEFAULT_QUICK_NOTE_SETTINGS.analyzeAgentId,
      autoAnalyze: {
        enabled:
          stored?.autoAnalyze?.enabled ??
          (typeof legacyEnabled === 'boolean'
            ? legacyEnabled
            : DEFAULT_QUICK_NOTE_SETTINGS.autoAnalyze.enabled),
        idleDelayMs: Math.min(
          300_000,
          Math.max(
            1000,
            stored?.autoAnalyze?.idleDelayMs ?? DEFAULT_QUICK_NOTE_SETTINGS.autoAnalyze.idleDelayMs,
          ),
        ),
      },
      maxAnalyzeSteps: Math.min(
        20,
        Math.max(1, stored?.maxAnalyzeSteps ?? DEFAULT_QUICK_NOTE_SETTINGS.maxAnalyzeSteps),
      ),
    };
  };

  /**
   * Resolves whether automatic Analyze may be scheduled for one user.
   *
   * Use when:
   * - A client edit or server sweep is about to schedule Analyze.
   *
   * Expects:
   * - Missing settings resolve through {@link DEFAULT_QUICK_NOTE_SETTINGS}.
   *
   * Returns:
   * - The effective automatic Analyze toggle.
   */
  static isAutomaticAnalyzeEnabled = async (db: LobeChatDatabase, userId: string) => {
    const settings = await QuickNoteModel.getAnalyzeSettings(db, userId);

    return settings.autoAnalyze.enabled;
  };

  /**
   * Finds due captures whose owners did not explicitly disable Automatic Analyze.
   *
   * Use when:
   * - The one-minute server sweep compensates for closed or disconnected clients.
   *
   * Expects:
   * - `limit` bounds one cron invocation and defaults to 100.
   * - Missing user settings mean enabled.
   *
   * Returns:
   * - Owner/workspace routing identities ordered by oldest due time first.
   */
  static findDueAnalyzeCandidates = async (
    db: LobeChatDatabase,
    params: { limit?: number; now?: Date } = {},
  ) =>
    db
      .select({
        id: quickNotes.id,
        userId: quickNotes.userId,
        workspaceId: quickNotes.workspaceId,
      })
      .from(quickNotes)
      .leftJoin(userSettings, eq(userSettings.id, quickNotes.userId))
      .where(
        and(
          lte(quickNotes.analyzeDueAt, params.now ?? new Date()),
          sql`COALESCE((${userSettings.quickNote} -> 'autoAnalyze' ->> 'enabled')::boolean, (${userSettings.general} ->> 'enableQuickNoteAutomaticDiscovery')::boolean, true)`,
        ),
      )
      .orderBy(quickNotes.analyzeDueAt)
      .limit(params.limit ?? 100);

  /**
   * Atomically creates a Quick Note, private backing Document, and hidden Topic.
   *
   * Use when:
   * - The user starts a new capture.
   *
   * Expects:
   * - `content` is the searchable plain-text projection of `editorData`.
   *
   * Returns:
   * - The newly persisted Quick Note with stable Document and Topic IDs.
   */
  create = async (params: CreateQuickNoteParams) => {
    const quickNoteId = params.id ?? idGenerator('quickNotes');
    const documentId = idGenerator('documents', 16);
    const topicId = idGenerator('topics');
    const content = params.content ?? '';
    const editorData = params.editorData ?? { root: { children: [] } };

    return this.db.transaction(async (tx) => {
      await tx.insert(documents).values({
        content,
        editorData,
        fileType: 'text/markdown',
        source: `quick-note:${quickNoteId}`,
        sourceType: 'quick-note',
        totalCharCount: content.length,
        totalLineCount: content.length === 0 ? 0 : content.split('\n').length,
        userId: this.userId,
        visibility: 'private',
        workspaceId: this.workspaceId,
        id: documentId,
      });

      await tx.insert(topics).values({
        id: topicId,
        trigger: 'quick-note',
        userId: this.userId,
        workspaceId: this.workspaceId,
      });

      const [quickNote] = await tx
        .insert(quickNotes)
        .values({
          collection: params.collection,
          documentId,
          id: quickNoteId,
          location: params.location,
          tags: params.tags ?? [],
          topicId,
          userId: this.userId,
          workspaceId: this.workspaceId,
        })
        .returning();

      return quickNote;
    });
  };

  /**
   * Lists captures owned by the current user in the current workspace scope.
   *
   * Use when:
   * - Hydrating the Quick Note editor or capture selector.
   *
   * Expects:
   * - No caller-provided ownership filters; the model always applies them.
   *
   * Returns:
   * - Newest-updated Quick Notes first.
   */
  query = async () =>
    this.db
      .select()
      .from(quickNotes)
      .where(this.ownershipWhere())
      .orderBy(desc(quickNotes.updatedAt));

  /**
   * Appends user feedback and its first immutable revision to a Quick Note.
   *
   * Use when:
   * - A user adds context or correction for later Quick Note Runs.
   *
   * Expects:
   * - The parent Quick Note belongs to the model's owner/workspace scope.
   *
   * Returns:
   * - The current Comment and the exact revision future Runs can pin.
   */
  createComment = async (quickNoteId: string, params: CreateQuickNoteCommentParams) =>
    this.db.transaction(async (tx) => {
      const [quickNote] = await tx
        .select({ id: quickNotes.id })
        .from(quickNotes)
        .where(and(eq(quickNotes.id, quickNoteId), this.ownershipWhere()));
      if (!quickNote) return undefined;

      const [comment] = await tx
        .insert(quickNoteComments)
        .values({
          authorUserId: this.userId,
          content: params.content,
          editorData: params.editorData,
          quickNoteId,
          userId: this.userId,
          workspaceId: this.workspaceId,
        })
        .returning();
      const [revision] = await tx
        .insert(quickNoteCommentRevisions)
        .values({
          commentId: comment.id,
          content: params.content,
          editorData: params.editorData,
          editorUserId: this.userId,
        })
        .returning();

      return { comment, revision };
    });

  /**
   * Lists the current Comment projections for one owned Quick Note.
   *
   * Use when:
   * - Rendering or collecting the user-to-agent feedback stream.
   *
   * Expects:
   * - Historical text is read through revisions, not this current projection.
   *
   * Returns:
   * - Comments ordered by creation time.
   */
  queryComments = async (quickNoteId: string) =>
    this.db
      .select({
        authorUserId: quickNoteComments.authorUserId,
        content: quickNoteComments.content,
        createdAt: quickNoteComments.createdAt,
        editorData: quickNoteComments.editorData,
        id: quickNoteComments.id,
        updatedAt: quickNoteComments.updatedAt,
      })
      .from(quickNoteComments)
      .innerJoin(quickNotes, eq(quickNotes.id, quickNoteComments.quickNoteId))
      .where(and(eq(quickNoteComments.quickNoteId, quickNoteId), this.ownershipWhere()))
      .orderBy(quickNoteComments.createdAt, quickNoteComments.id);

  /**
   * Edits a Comment and appends the new immutable content revision.
   *
   * Use when:
   * - A user corrects context previously supplied to processing Agents.
   *
   * Expects:
   * - Existing Run inputs continue pointing at their earlier revision IDs.
   *
   * Returns:
   * - The updated Comment and new revision, or `undefined` when inaccessible.
   */
  updateComment = async (commentId: string, params: UpdateQuickNoteCommentParams) =>
    this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          content: quickNoteComments.content,
          editorData: quickNoteComments.editorData,
          id: quickNoteComments.id,
        })
        .from(quickNoteComments)
        .innerJoin(quickNotes, eq(quickNotes.id, quickNoteComments.quickNoteId))
        .where(and(eq(quickNoteComments.id, commentId), this.ownershipWhere()));
      if (!existing) return undefined;

      if (existing.content === params.content && isEqual(existing.editorData, params.editorData)) {
        const [revision] = await tx
          .select()
          .from(quickNoteCommentRevisions)
          .where(eq(quickNoteCommentRevisions.commentId, commentId))
          .orderBy(desc(quickNoteCommentRevisions.createdAt), desc(quickNoteCommentRevisions.id))
          .limit(1);
        return { comment: existing, revision };
      }

      const [comment] = await tx
        .update(quickNoteComments)
        .set({ content: params.content, editorData: params.editorData, updatedAt: new Date() })
        .where(eq(quickNoteComments.id, commentId))
        .returning();
      const [revision] = await tx
        .insert(quickNoteCommentRevisions)
        .values({
          commentId,
          content: params.content,
          editorData: params.editorData,
          editorUserId: this.userId,
        })
        .returning();

      return { comment, revision };
    });

  /**
   * Lists editable downstream suggestions with their current Document content.
   *
   * Use when:
   * - Presenting Agent-generated actions without executing them.
   *
   * Expects:
   * - Decision state and source validity remain separate dimensions.
   *
   * Returns:
   * - Newest Proposals first, including current rich-text content.
   */
  queryProposals = async (quickNoteId: string) =>
    this.db
      .select({
        acceptedHistoryId: quickNoteProposals.acceptedHistoryId,
        content: documents.content,
        createdAt: quickNoteProposals.createdAt,
        currentHistoryId: quickNoteProposals.currentHistoryId,
        decisionStatus: quickNoteProposals.decisionStatus,
        documentId: quickNoteProposals.documentId,
        editorData: documents.editorData,
        id: quickNoteProposals.id,
        kind: quickNoteProposals.kind,
        runId: quickNoteProposals.runId,
        sourceHistoryId: quickNoteProposals.sourceHistoryId,
        updatedAt: quickNoteProposals.updatedAt,
        validity: quickNoteProposals.validity,
      })
      .from(quickNoteProposals)
      .innerJoin(quickNotes, eq(quickNotes.id, quickNoteProposals.quickNoteId))
      .innerJoin(documents, eq(documents.id, quickNoteProposals.documentId))
      .where(and(eq(quickNoteProposals.quickNoteId, quickNoteId), this.ownershipWhere()))
      .orderBy(desc(quickNoteProposals.createdAt), desc(quickNoteProposals.id));

  /**
   * Lists current typed Context Resources for one owned Quick Note revision.
   *
   * Use when:
   * - Rendering resources selected by Analyze or Dive beside the source note.
   *
   * Expects:
   * - Stale links from earlier source revisions remain stored but are not returned.
   *
   * Returns:
   * - Current Context links with the best available product-native display label.
   */
  queryResources = async (quickNoteId: string) => {
    const rows = await this.db
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
          this.ownershipWhere(),
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
        if (!isEqual(noteEditorData, sourceEditorData)) return [];
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
   * Reads all Agent-owned sidecar data for one Quick Note detail surface.
   *
   * Use when:
   * - Hydrating Annotation-adjacent Resources, Proposals, and feedback together.
   *
   * Expects:
   * - Every child query applies the same owner/workspace boundary.
   *
   * Returns:
   * - Independent lists that can be refreshed with one client request.
   */
  queryAgenticDetails = async (quickNoteId: string) => {
    const [comments, proposals, resources] = await Promise.all([
      this.queryComments(quickNoteId),
      this.queryProposals(quickNoteId),
      this.queryResources(quickNoteId),
    ]);

    return { comments, proposals, resources };
  };

  /**
   * Reads one capture with its mutable backing Document projection.
   *
   * Use when:
   * - Hydrating the editor or preparing a Run prompt.
   *
   * Expects:
   * - `id` may refer only to the current owner's workspace scope.
   *
   * Returns:
   * - The capture plus Document content/editor data, or `undefined`.
   */
  findWithContent = async (id: string) => {
    const [result] = await this.db
      .select({
        collection: quickNotes.collection,
        content: documents.content,
        createdAt: quickNotes.createdAt,
        analyzeDueAt: quickNotes.analyzeDueAt,
        documentId: quickNotes.documentId,
        editorData: documents.editorData,
        id: quickNotes.id,
        location: quickNotes.location,
        tags: quickNotes.tags,
        topicId: quickNotes.topicId,
        updatedAt: quickNotes.updatedAt,
        userId: quickNotes.userId,
        workspaceId: quickNotes.workspaceId,
      })
      .from(quickNotes)
      .innerJoin(documents, eq(documents.id, quickNotes.documentId))
      .where(and(eq(quickNotes.id, id), this.ownershipWhere()));

    return result;
  };

  /**
   * Lists captures with editor projections and their latest accepted Annotation.
   *
   * Use when:
   * - Hydrating the unchanged Quick Note list and Annotation panel.
   *
   * Expects:
   * - Annotation selection is owner-scoped through the parent Quick Note.
   *
   * Returns:
   * - Newest captures first; Annotation is omitted until a Run accepts one.
   */
  queryDetails = async () => {
    const notes = await this.db
      .select({
        collection: quickNotes.collection,
        content: documents.content,
        createdAt: quickNotes.createdAt,
        analyzeDueAt: quickNotes.analyzeDueAt,
        documentId: quickNotes.documentId,
        editorData: documents.editorData,
        id: quickNotes.id,
        location: quickNotes.location,
        sourceEditorData: documents.editorData,
        tags: quickNotes.tags,
        topicId: quickNotes.topicId,
        updatedAt: quickNotes.updatedAt,
      })
      .from(quickNotes)
      .innerJoin(documents, eq(documents.id, quickNotes.documentId))
      .where(this.ownershipWhere())
      .orderBy(desc(quickNotes.updatedAt));

    if (notes.length === 0) return [];

    const annotations = await this.db
      .select({
        content: documents.content,
        createdAt: quickNoteRunResources.createdAt,
        quickNoteId: quickNoteResources.quickNoteId,
        sourceEditorData: documentHistories.editorData,
      })
      .from(quickNoteResources)
      .innerJoin(documents, eq(documents.id, quickNoteResources.documentId))
      .innerJoin(documentHistories, eq(documentHistories.id, quickNoteResources.sourceHistoryId))
      .innerJoin(quickNoteRunResources, eq(quickNoteRunResources.resourceId, quickNoteResources.id))
      .where(
        and(
          inArray(
            quickNoteResources.quickNoteId,
            notes.map(({ id }) => id),
          ),
          eq(quickNoteResources.role, 'annotation'),
        ),
      )
      .orderBy(desc(quickNoteRunResources.createdAt));

    const runs = await this.db
      .select({
        agentId: quickNoteRuns.agentId,
        executionConfig: quickNoteRuns.executionConfig,
        kind: quickNoteRuns.kind,
        operationId: quickNoteRuns.operationId,
        quickNoteId: quickNoteRuns.quickNoteId,
        status: quickNoteRuns.status,
        threadId: quickNoteRuns.threadId,
        trigger: quickNoteRuns.trigger,
        updatedAt: quickNoteRuns.updatedAt,
      })
      .from(quickNoteRuns)
      .where(
        inArray(
          quickNoteRuns.quickNoteId,
          notes.map(({ id }) => id),
        ),
      )
      .orderBy(desc(quickNoteRuns.updatedAt));

    const latestAnnotations = new Map<string, { content: string; divedAt: Date }>();
    const noteSourceEditorData = new Map(
      notes.map((note) => [note.id, note.sourceEditorData] as const),
    );
    for (const annotation of annotations) {
      if (latestAnnotations.has(annotation.quickNoteId)) continue;
      const sourceEditorData = noteSourceEditorData.get(annotation.quickNoteId);
      if (!isEqual(annotation.sourceEditorData, sourceEditorData)) continue;
      latestAnnotations.set(annotation.quickNoteId, {
        content: annotation.content ?? '',
        divedAt: annotation.createdAt,
      });
    }

    const latestRuns = new Map<string, (typeof runs)[number]>();
    for (const run of runs) {
      const selected = latestRuns.get(run.quickNoteId);
      const isActive = ['pending', 'running'].includes(run.status);
      const selectedIsActive = selected && ['pending', 'running'].includes(selected.status);
      if (!selected || (isActive && !selectedIsActive)) latestRuns.set(run.quickNoteId, run);
    }

    return notes.map(({ sourceEditorData: _, ...note }) => ({
      ...note,
      annotation: latestAnnotations.get(note.id),
      run: latestRuns.get(note.id),
    }));
  };

  /**
   * Saves the mutable source projection without creating a processing Run.
   *
   * Use when:
   * - Debounced editor persistence reaches the server.
   *
   * Expects:
   * - `editorData` and `content` describe the same editor state.
   *
   * Returns:
   * - The updated owner-scoped Quick Note, or `undefined` when inaccessible.
   */
  updateContent = async (id: string, params: UpdateQuickNoteContentParams) =>
    this.db.transaction(async (tx) => {
      const [quickNote] = await tx
        .select({
          content: documents.content,
          documentId: quickNotes.documentId,
          editorData: documents.editorData,
          id: quickNotes.id,
        })
        .from(quickNotes)
        .innerJoin(documents, eq(documents.id, quickNotes.documentId))
        .where(and(eq(quickNotes.id, id), this.ownershipWhere()));

      if (!quickNote) return undefined;

      const savedAt = new Date();
      const currentEditorData = quickNote.editorData ?? { root: { children: [] } };
      const sourceChanged =
        quickNote.content !== params.content || !isEqual(currentEditorData, params.editorData);
      if (!isEqual(currentEditorData, params.editorData)) {
        const [latestHistory] = await tx
          .select()
          .from(documentHistories)
          .where(eq(documentHistories.documentId, quickNote.documentId))
          .orderBy(desc(documentHistories.savedAt), desc(documentHistories.id))
          .limit(1);
        // Match the canonical Document history policy: fixed clock buckets keep
        // continuous typing bounded without turning the anchor into a sliding window.
        const withinAutosaveWindow =
          latestHistory?.saveSource === 'autosave' &&
          Math.floor(latestHistory.savedAt.getTime() / DOCUMENT_HISTORY_AUTOSAVE_WINDOW_MS) ===
            Math.floor(savedAt.getTime() / DOCUMENT_HISTORY_AUTOSAVE_WINDOW_MS);

        if (withinAutosaveWindow) {
          await tx
            .update(documentHistories)
            .set({ editorData: currentEditorData, savedAt })
            .where(eq(documentHistories.id, latestHistory.id));
        } else {
          await tx.insert(documentHistories).values({
            documentId: quickNote.documentId,
            editorData: currentEditorData,
            saveSource: 'autosave',
            savedAt,
            userId: this.userId,
            workspaceId: this.workspaceId,
          });

          // Retain the same bounded autosave lineage as the Document service.
          const expiredAutosaves = await tx
            .select({ id: documentHistories.id })
            .from(documentHistories)
            .where(
              and(
                eq(documentHistories.documentId, quickNote.documentId),
                eq(documentHistories.saveSource, 'autosave'),
              ),
            )
            .orderBy(desc(documentHistories.savedAt), desc(documentHistories.id))
            .offset(DOCUMENT_HISTORY_AUTOSAVE_SOURCE_LIMIT);
          if (expiredAutosaves.length > 0) {
            await tx.delete(documentHistories).where(
              inArray(
                documentHistories.id,
                expiredAutosaves.map(({ id: historyId }) => historyId),
              ),
            );
          }
        }
      }

      await tx
        .update(documents)
        .set({
          content: params.content,
          editorData: params.editorData,
          totalCharCount: params.content.length,
          totalLineCount: params.content.length === 0 ? 0 : params.content.split('\n').length,
          updatedAt: savedAt,
        })
        .where(eq(documents.id, quickNote.documentId));

      const [updated] = await tx
        .update(quickNotes)
        .set({
          ...(params.analyzeDueAt === undefined ? {} : { analyzeDueAt: params.analyzeDueAt }),
          updatedAt: savedAt,
        })
        .where(eq(quickNotes.id, quickNote.id))
        .returning();

      if (sourceChanged) {
        await tx
          .update(quickNoteProposals)
          .set({ updatedAt: savedAt, validity: 'stale' })
          .where(
            and(
              eq(quickNoteProposals.quickNoteId, quickNote.id),
              eq(quickNoteProposals.decisionStatus, 'pending'),
              eq(quickNoteProposals.validity, 'current'),
            ),
          );
      }

      return updated;
    });

  /**
   * Claims a Run and pins a non-coalescing system Document History snapshot.
   *
   * Use when:
   * - Dispatching Automatic Analyze, Signal enrichment, or an explicit Dive.
   *
   * Expects:
   * - Only one pending/running Run of the same kind is needed per capture.
   *
   * Returns:
   * - The existing active Run, a new pending Run, or `undefined` when inaccessible.
   */
  claimRun = async (id: string, params: ClaimQuickNoteRunParams) =>
    this.db.transaction(async (tx) => {
      const [quickNote] = await tx
        .select({
          documentId: quickNotes.documentId,
          editorData: documents.editorData,
          id: quickNotes.id,
        })
        .from(quickNotes)
        .innerJoin(documents, eq(documents.id, quickNotes.documentId))
        .where(and(eq(quickNotes.id, id), this.ownershipWhere()));

      if (!quickNote) return undefined;

      const [activeRun] = await tx
        .select()
        .from(quickNoteRuns)
        .where(
          and(
            eq(quickNoteRuns.quickNoteId, id),
            eq(quickNoteRuns.kind, params.kind),
            inArray(quickNoteRuns.status, ['pending', 'running']),
          ),
        )
        .limit(1);

      if (activeRun) return activeRun;

      const [history] = await tx
        .insert(documentHistories)
        .values({
          documentId: quickNote.documentId,
          editorData: quickNote.editorData ?? { root: { children: [] } },
          saveSource: 'system',
          savedAt: new Date(),
          userId: this.userId,
          workspaceId: this.workspaceId,
        })
        .returning();

      const [run] = await tx
        .insert(quickNoteRuns)
        .values({
          kind: params.kind,
          quickNoteId: quickNote.id,
          sourceHistoryId: history.id,
          trigger: params.trigger,
        })
        .onConflictDoNothing({
          target: [quickNoteRuns.quickNoteId, quickNoteRuns.kind],
          where: sql`${quickNoteRuns.status} IN ('pending', 'running')`,
        })
        .returning();

      if (run) {
        const commentRevisions = await tx
          .select({
            commentId: quickNoteComments.id,
            revisionId: quickNoteCommentRevisions.id,
          })
          .from(quickNoteComments)
          .innerJoin(
            quickNoteCommentRevisions,
            eq(quickNoteCommentRevisions.commentId, quickNoteComments.id),
          )
          .where(eq(quickNoteComments.quickNoteId, quickNote.id))
          .orderBy(desc(quickNoteCommentRevisions.createdAt), desc(quickNoteCommentRevisions.id));
        const latestCommentRevisionIds = new Map<string, string>();
        for (const revision of commentRevisions) {
          if (!latestCommentRevisionIds.has(revision.commentId)) {
            latestCommentRevisionIds.set(revision.commentId, revision.revisionId);
          }
        }

        const proposalHistories = await tx
          .select({ historyId: quickNoteProposals.currentHistoryId })
          .from(quickNoteProposals)
          .where(
            and(
              eq(quickNoteProposals.quickNoteId, quickNote.id),
              eq(quickNoteProposals.decisionStatus, 'pending'),
            ),
          );

        await tx.insert(quickNoteRunInputs).values([
          {
            documentHistoryId: history.id,
            role: 'source',
            runId: run.id,
            userId: this.userId,
            workspaceId: this.workspaceId,
          },
          ...[...latestCommentRevisionIds.values()].map((commentRevisionId) => ({
            commentRevisionId,
            role: 'comment' as const,
            runId: run.id,
            userId: this.userId,
            workspaceId: this.workspaceId,
          })),
          ...proposalHistories.map(({ historyId: documentHistoryId }) => ({
            documentHistoryId,
            role: 'proposal' as const,
            runId: run.id,
            userId: this.userId,
            workspaceId: this.workspaceId,
          })),
        ]);

        return run;
      }

      // A concurrent claimant won the partial unique index after this transaction
      // created its snapshot. Remove the unused snapshot, then return that winner.
      await tx.delete(documentHistories).where(eq(documentHistories.id, history.id));
      const [winner] = await tx
        .select()
        .from(quickNoteRuns)
        .where(
          and(
            eq(quickNoteRuns.quickNoteId, id),
            eq(quickNoteRuns.kind, params.kind),
            inArray(quickNoteRuns.status, ['pending', 'running']),
          ),
        )
        .limit(1);

      return winner;
    });

  /**
   * Accepts a concise Annotation revision and records its producing Run.
   *
   * Use when:
   * - Analyze, Signal enrichment, or Dive returns a user-visible projection.
   *
   * Expects:
   * - `runId` belongs to the current owner and is pending or running.
   * - The payload is a projection, not a copied Domain Agent transcript.
   *
   * Returns:
   * - The stable Resource binding and accepted Annotation Document History.
   */
  acceptAnnotation = async (runId: string, params: AcceptQuickNoteAnnotationParams) =>
    this.db.transaction(async (tx) => {
      const [run] = await tx
        .select({
          quickNoteId: quickNoteRuns.quickNoteId,
          sourceDocumentEditorData: documents.editorData,
          sourceHistoryId: quickNoteRuns.sourceHistoryId,
          sourceHistoryEditorData: documentHistories.editorData,
          status: quickNoteRuns.status,
          analyzeDueAt: quickNotes.analyzeDueAt,
          tags: quickNotes.tags,
        })
        .from(quickNoteRuns)
        .innerJoin(quickNotes, eq(quickNotes.id, quickNoteRuns.quickNoteId))
        .innerJoin(documents, eq(documents.id, quickNotes.documentId))
        .innerJoin(documentHistories, eq(documentHistories.id, quickNoteRuns.sourceHistoryId))
        .where(and(eq(quickNoteRuns.id, runId), this.ownershipWhere()));

      if (!run || !['pending', 'running'].includes(run.status)) return undefined;

      const [existingResource] = await tx
        .select()
        .from(quickNoteResources)
        .where(
          and(
            eq(quickNoteResources.quickNoteId, run.quickNoteId),
            eq(quickNoteResources.sourceHistoryId, run.sourceHistoryId),
            eq(quickNoteResources.role, 'annotation'),
          ),
        )
        .limit(1);

      const editorData = params.editorData ?? { root: { children: [] } };
      let resource = existingResource;

      if (resource) {
        const documentId = resource.documentId;
        if (!documentId) return undefined;

        await tx
          .update(documents)
          .set({
            content: params.content,
            editorData,
            totalCharCount: params.content.length,
            totalLineCount: params.content.length === 0 ? 0 : params.content.split('\n').length,
            updatedAt: new Date(),
          })
          .where(eq(documents.id, documentId));
      } else {
        const documentId = idGenerator('documents', 16);
        await tx.insert(documents).values({
          content: params.content,
          editorData,
          fileType: 'text/markdown',
          id: documentId,
          source: `quick-note:annotation:${run.quickNoteId}:${run.sourceHistoryId}`,
          sourceType: 'quick-note',
          totalCharCount: params.content.length,
          totalLineCount: params.content.length === 0 ? 0 : params.content.split('\n').length,
          userId: this.userId,
          visibility: 'private',
          workspaceId: this.workspaceId,
        });

        [resource] = await tx
          .insert(quickNoteResources)
          .values({
            documentId,
            quickNoteId: run.quickNoteId,
            resourceId: documentId,
            resourceType: 'document',
            role: 'annotation',
            sourceHistoryId: run.sourceHistoryId,
            userId: this.userId,
            workspaceId: this.workspaceId,
          })
          .returning();
      }

      const annotationDocumentId = resource.documentId;
      if (!annotationDocumentId) return undefined;

      const [documentHistory] = await tx
        .insert(documentHistories)
        .values({
          documentId: annotationDocumentId,
          editorData,
          saveSource: 'llm_call',
          savedAt: new Date(),
          userId: this.userId,
          workspaceId: this.workspaceId,
        })
        .returning();

      await tx.insert(quickNoteRunResources).values({
        documentHistoryId: documentHistory.id,
        resourceId: resource.id,
        runId,
        userId: this.userId,
        workspaceId: this.workspaceId,
      });

      const proposals: QuickNoteProposalItem[] = [];
      for (const proposalDraft of params.proposals ?? []) {
        const proposalDocumentId = idGenerator('documents', 16);
        const proposalEditorData = proposalDraft.editorData ?? { markdown: proposalDraft.content };
        await tx.insert(documents).values({
          content: proposalDraft.content,
          editorData: proposalEditorData,
          fileType: 'text/markdown',
          id: proposalDocumentId,
          source: `quick-note:proposal:${run.quickNoteId}:${runId}`,
          sourceType: 'quick-note',
          totalCharCount: proposalDraft.content.length,
          totalLineCount:
            proposalDraft.content.length === 0 ? 0 : proposalDraft.content.split('\n').length,
          userId: this.userId,
          visibility: 'private',
          workspaceId: this.workspaceId,
        });
        const [proposalHistory] = await tx
          .insert(documentHistories)
          .values({
            documentId: proposalDocumentId,
            editorData: proposalEditorData,
            saveSource: 'llm_call',
            savedAt: new Date(),
            userId: this.userId,
            workspaceId: this.workspaceId,
          })
          .returning();
        const [proposal] = await tx
          .insert(quickNoteProposals)
          .values({
            currentHistoryId: proposalHistory.id,
            documentId: proposalDocumentId,
            kind: proposalDraft.kind,
            quickNoteId: run.quickNoteId,
            runId,
            sourceHistoryId: run.sourceHistoryId,
            userId: this.userId,
            workspaceId: this.workspaceId,
          })
          .returning();
        proposals.push(proposal);
      }

      await tx
        .update(quickNoteRuns)
        .set({ completedAt: new Date(), status: 'completed', updatedAt: new Date() })
        .where(eq(quickNoteRuns.id, runId));

      const sourceIsCurrent = isEqual(run.sourceDocumentEditorData, run.sourceHistoryEditorData);
      await tx
        .update(quickNotes)
        .set({
          analyzeDueAt: sourceIsCurrent ? null : run.analyzeDueAt,
          // A stale Run remains auditable, but its interpretation must not mutate current metadata.
          tags:
            sourceIsCurrent && params.tags ? [...new Set([...run.tags, ...params.tags])] : run.tags,
          updatedAt: new Date(),
        })
        .where(eq(quickNotes.id, run.quickNoteId));

      return { documentHistory, proposals, resource };
    });

  /**
   * Edits a pending Proposal and advances its Document-backed current version.
   *
   * Use when:
   * - A user refines an Agent suggestion before deciding what to do with it.
   *
   * Expects:
   * - Accepted or dismissed Proposals are no longer editable through this path.
   *
   * Returns:
   * - The updated Proposal with its new current Document History.
   */
  updateProposal = async (proposalId: string, params: UpdateQuickNoteProposalParams) =>
    this.db.transaction(async (tx) => {
      const [proposal] = await tx
        .select({
          decisionStatus: quickNoteProposals.decisionStatus,
          documentId: quickNoteProposals.documentId,
          id: quickNoteProposals.id,
        })
        .from(quickNoteProposals)
        .innerJoin(quickNotes, eq(quickNotes.id, quickNoteProposals.quickNoteId))
        .where(and(eq(quickNoteProposals.id, proposalId), this.ownershipWhere()));
      if (!proposal || proposal.decisionStatus !== 'pending') return undefined;

      const savedAt = new Date();
      await tx
        .update(documents)
        .set({
          content: params.content,
          editorData: params.editorData,
          totalCharCount: params.content.length,
          totalLineCount: params.content.length === 0 ? 0 : params.content.split('\n').length,
          updatedAt: savedAt,
        })
        .where(eq(documents.id, proposal.documentId));
      const [history] = await tx
        .insert(documentHistories)
        .values({
          documentId: proposal.documentId,
          editorData: params.editorData,
          saveSource: 'manual',
          savedAt,
          userId: this.userId,
          workspaceId: this.workspaceId,
        })
        .returning();
      const [updated] = await tx
        .update(quickNoteProposals)
        .set({ currentHistoryId: history.id, updatedAt: savedAt })
        .where(eq(quickNoteProposals.id, proposal.id))
        .returning();

      return { history, proposal: updated };
    });

  /**
   * Converts one current Task Proposal into a private Task and records the accepted revision.
   *
   * Use when:
   * - The user explicitly chooses Create task on a Quick Note Proposal.
   *
   * Expects:
   * - The Proposal is still pending, current, and owned by the active workspace scope.
   *
   * Returns:
   * - The created Task and terminal Proposal, or `undefined` for an inaccessible/stale Proposal.
   */
  acceptTaskProposal = async (proposalId: string) =>
    this.db.transaction(async (tx) => {
      const [proposal] = await tx
        .select({
          content: documents.content,
          currentHistoryId: quickNoteProposals.currentHistoryId,
          id: quickNoteProposals.id,
          kind: quickNoteProposals.kind,
          quickNoteId: quickNoteProposals.quickNoteId,
          runId: quickNoteProposals.runId,
          sourceHistoryId: quickNoteProposals.sourceHistoryId,
        })
        .from(quickNoteProposals)
        .innerJoin(quickNotes, eq(quickNotes.id, quickNoteProposals.quickNoteId))
        .innerJoin(documents, eq(documents.id, quickNoteProposals.documentId))
        .where(
          and(
            eq(quickNoteProposals.id, proposalId),
            eq(quickNoteProposals.decisionStatus, 'pending'),
            eq(quickNoteProposals.validity, 'current'),
            this.ownershipWhere(),
          ),
        )
        .for('update');
      if (!proposal || proposal.kind !== 'task' || !proposal.content?.trim()) return undefined;

      // Quick Notes are private captures, so an explicitly converted Task starts private too.
      const task = await new TaskModel(tx, this.userId, this.workspaceId).create(
        { instruction: proposal.content, visibility: 'private' },
        { maxRetries: 1 },
      );
      const [acceptedProposal] = await tx
        .update(quickNoteProposals)
        .set({
          acceptedHistoryId: proposal.currentHistoryId,
          decisionStatus: 'accepted',
          updatedAt: new Date(),
        })
        .where(eq(quickNoteProposals.id, proposal.id))
        .returning();

      const [createdResource] = await tx
        .insert(quickNoteResources)
        .values({
          quickNoteId: proposal.quickNoteId,
          resourceId: task.id,
          resourceType: 'task',
          role: 'context',
          sourceHistoryId: proposal.sourceHistoryId,
          userId: this.userId,
          workspaceId: this.workspaceId,
        })
        .onConflictDoNothing()
        .returning();
      const resource =
        createdResource ??
        (
          await tx
            .select()
            .from(quickNoteResources)
            .where(
              and(
                eq(quickNoteResources.quickNoteId, proposal.quickNoteId),
                eq(quickNoteResources.sourceHistoryId, proposal.sourceHistoryId),
                eq(quickNoteResources.resourceId, task.id),
                eq(quickNoteResources.resourceType, 'task'),
                eq(quickNoteResources.role, 'context'),
              ),
            )
        )[0];
      if (resource) {
        await tx
          .insert(quickNoteRunResources)
          .values({
            resourceId: resource.id,
            runId: proposal.runId,
            userId: this.userId,
            workspaceId: this.workspaceId,
          })
          .onConflictDoNothing();
      }

      return { proposal: acceptedProposal, task };
    });

  /**
   * Records a user's Proposal decision without treating source validity as feedback.
   *
   * Use when:
   * - A user accepts the current revision or dismisses the suggestion.
   *
   * Expects:
   * - Only pending Proposals can receive their first terminal decision.
   *
   * Returns:
   * - The decided Proposal, with the accepted revision pinned when applicable.
   */
  decideProposal = async (
    proposalId: string,
    decisionStatus: Exclude<QuickNoteProposalDecisionStatus, 'pending'>,
  ) => {
    const [proposal] = await this.db
      .update(quickNoteProposals)
      .set({
        acceptedHistoryId:
          decisionStatus === 'accepted' ? sql`${quickNoteProposals.currentHistoryId}` : null,
        decisionStatus,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(quickNoteProposals.id, proposalId),
          eq(quickNoteProposals.decisionStatus, 'pending'),
          inArray(
            quickNoteProposals.quickNoteId,
            this.db.select({ id: quickNotes.id }).from(quickNotes).where(this.ownershipWhere()),
          ),
        ),
      )
      .returning();

    return proposal;
  };

  /**
   * Links an accessible typed product resource as accepted Run evidence.
   *
   * Use when:
   * - A Context Provider candidate is judged clearly relevant by Analyze or Dive.
   * - A Quick Note annotates a Topic or Document without converting either object.
   *
   * Expects:
   * - V1 runtime linking accepts scoped `document` and `topic` references.
   * - Other resource families remain representable in storage for later native providers.
   *
   * Returns:
   * - The stable resource binding, or `undefined` when either side is inaccessible.
   */
  linkResource = async (runId: string, params: LinkQuickNoteResourceParams) =>
    this.db.transaction(async (tx) => {
      const [run] = await tx
        .select({
          quickNoteId: quickNoteRuns.quickNoteId,
          sourceHistoryId: quickNoteRuns.sourceHistoryId,
        })
        .from(quickNoteRuns)
        .innerJoin(quickNotes, eq(quickNotes.id, quickNoteRuns.quickNoteId))
        .where(and(eq(quickNoteRuns.id, runId), this.ownershipWhere()));
      if (!run) return undefined;

      let documentId: string | undefined;
      if (params.type === 'document' || params.type === 'page') {
        const documentOwnership = this.workspaceId
          ? and(
              eq(documents.workspaceId, this.workspaceId),
              sql`(${documents.visibility} = 'public' OR ${documents.userId} = ${this.userId})`,
            )
          : and(eq(documents.userId, this.userId), isNull(documents.workspaceId));
        const [document] = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.id, params.id), documentOwnership));
        if (!document) return undefined;
        documentId = document.id;
      } else if (params.type === 'topic' || params.type === 'conversation') {
        const topicOwnership = this.workspaceId
          ? eq(topics.workspaceId, this.workspaceId)
          : and(eq(topics.userId, this.userId), isNull(topics.workspaceId));
        const [topic] = await tx
          .select({ id: topics.id })
          .from(topics)
          .where(and(eq(topics.id, params.id), topicOwnership));
        if (!topic) return undefined;
      } else {
        // TODO: Add native authorization providers for Message, Thread, Task, Turn, and generic Resource.
        return undefined;
      }

      const role = params.role ?? 'context';

      const [created] = await tx
        .insert(quickNoteResources)
        .values({
          documentId,
          quickNoteId: run.quickNoteId,
          resourceId: params.id,
          resourceType: params.type,
          role,
          selector: params.selector,
          sourceHistoryId: run.sourceHistoryId,
          userId: this.userId,
          workspaceId: this.workspaceId,
        })
        .onConflictDoNothing()
        .returning();
      const resource =
        created ??
        (
          await tx
            .select()
            .from(quickNoteResources)
            .where(
              and(
                eq(quickNoteResources.quickNoteId, run.quickNoteId),
                eq(quickNoteResources.sourceHistoryId, run.sourceHistoryId),
                eq(quickNoteResources.resourceId, params.id),
                eq(quickNoteResources.resourceType, params.type),
                eq(quickNoteResources.role, role),
              ),
            )
        )[0];
      if (!resource) return undefined;

      await tx
        .insert(quickNoteRunResources)
        .values({
          resourceId: resource.id,
          runId,
          userId: this.userId,
          workspaceId: this.workspaceId,
        })
        .onConflictDoNothing();

      return resource;
    });

  /**
   * Links an accessible existing Document through the typed Resource Link path.
   *
   * Use when:
   * - Existing callers still provide a Document identifier directly.
   *
   * Expects:
   * - The Document passes the same owner/workspace authorization as {@link linkResource}.
   *
   * Returns:
   * - The stable Document resource binding when accessible.
   */
  linkDocumentResource = async (
    runId: string,
    documentId: string,
    role: QuickNoteResourceRole = 'context',
  ) => this.linkResource(runId, { id: documentId, role, type: 'document' });

  /**
   * Attaches the isolated conversation Thread used by one pending Run.
   *
   * Use when:
   * - Analyze or Dive needs a fresh message boundary inside the stable Quick Note Topic.
   *
   * Expects:
   * - The Thread already belongs to the Quick Note Topic selected for this Run.
   *
   * Returns:
   * - The pending Run with its Thread, or `undefined` when inaccessible or already started.
   */
  attachThread = async (runId: string, threadId: string) => {
    const [run] = await this.db
      .update(quickNoteRuns)
      .set({ threadId, updatedAt: new Date() })
      .where(
        and(
          eq(quickNoteRuns.id, runId),
          eq(quickNoteRuns.status, 'pending'),
          inArray(
            quickNoteRuns.quickNoteId,
            this.db.select({ id: quickNotes.id }).from(quickNotes).where(this.ownershipWhere()),
          ),
        ),
      )
      .returning();

    return run;
  };

  /**
   * Connects an Agent Runtime operation and optional Dive Thread to a pending Run.
   *
   * Use when:
   * - Runtime startup succeeds after the domain Run has been claimed.
   *
   * Expects:
   * - `runId` belongs to the current owner and remains pending.
   *
   * Returns:
   * - The running Run, or `undefined` when inaccessible or no longer pending.
   */
  attachOperation = async (
    runId: string,
    params: {
      agentId: string;
      executionConfig: QuickNoteRunExecutionConfig;
      operationId: string;
      threadId?: string;
    },
  ) => {
    const [run] = await this.db
      .update(quickNoteRuns)
      .set({
        agentId: params.agentId,
        executionConfig: params.executionConfig,
        operationId: params.operationId,
        startedAt: new Date(),
        status: 'running',
        threadId: params.threadId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(quickNoteRuns.id, runId),
          eq(quickNoteRuns.status, 'pending'),
          inArray(
            quickNoteRuns.quickNoteId,
            this.db.select({ id: quickNotes.id }).from(quickNotes).where(this.ownershipWhere()),
          ),
        ),
      )
      .returning();

    return run;
  };

  /**
   * Marks an owned pending/running Run as failed with a diagnostic summary.
   *
   * Use when:
   * - Runtime startup or terminal execution fails before output is accepted.
   *
   * Expects:
   * - `error` contains no secrets or full trace payloads.
   *
   * Returns:
   * - The failed Run, or `undefined` when inaccessible or already terminal.
   */
  failRun = async (runId: string, error: string) => {
    const [run] = await this.db
      .update(quickNoteRuns)
      .set({ completedAt: new Date(), error, status: 'failed', updatedAt: new Date() })
      .where(
        and(
          eq(quickNoteRuns.id, runId),
          inArray(quickNoteRuns.status, ['pending', 'running']),
          inArray(
            quickNoteRuns.quickNoteId,
            this.db.select({ id: quickNotes.id }).from(quickNotes).where(this.ownershipWhere()),
          ),
        ),
      )
      .returning();

    return run;
  };

  /**
   * Reads the immutable source and container IDs for one owned Run.
   *
   * Use when:
   * - Building an Agent prompt or recovering Run status after refresh.
   *
   * Expects:
   * - Runtime consumers use `sourceEditorData`, never the mutable Document row.
   *
   * Returns:
   * - Run metadata with every pinned content revision, or `undefined`.
   */
  getRunContext = async (runId: string) => {
    const [result] = await this.db
      .select({
        kind: quickNoteRuns.kind,
        operationId: quickNoteRuns.operationId,
        quickNoteId: quickNoteRuns.quickNoteId,
        sourceDocumentId: quickNotes.documentId,
        sourceEditorData: documentHistories.editorData,
        sourceHistoryId: quickNoteRuns.sourceHistoryId,
        status: quickNoteRuns.status,
        threadId: quickNoteRuns.threadId,
        topicId: quickNotes.topicId,
        trigger: quickNoteRuns.trigger,
      })
      .from(quickNoteRuns)
      .innerJoin(quickNotes, eq(quickNotes.id, quickNoteRuns.quickNoteId))
      .innerJoin(documentHistories, eq(documentHistories.id, quickNoteRuns.sourceHistoryId))
      .where(and(eq(quickNoteRuns.id, runId), this.ownershipWhere()));

    if (!result) return undefined;

    const inputs = await this.db
      .select({
        commentContent: quickNoteCommentRevisions.content,
        commentEditorData: quickNoteCommentRevisions.editorData,
        commentRevisionId: quickNoteRunInputs.commentRevisionId,
        documentEditorData: documentHistories.editorData,
        documentHistoryId: quickNoteRunInputs.documentHistoryId,
        role: quickNoteRunInputs.role,
      })
      .from(quickNoteRunInputs)
      .leftJoin(documentHistories, eq(documentHistories.id, quickNoteRunInputs.documentHistoryId))
      .leftJoin(
        quickNoteCommentRevisions,
        eq(quickNoteCommentRevisions.id, quickNoteRunInputs.commentRevisionId),
      )
      .where(eq(quickNoteRunInputs.runId, runId))
      .orderBy(quickNoteRunInputs.createdAt, quickNoteRunInputs.id);

    return { ...result, inputs };
  };

  /**
   * Deletes a capture and only the private Documents generated for it.
   *
   * Use when:
   * - The owner removes a Quick Note from the existing list UI.
   *
   * Expects:
   * - Non-Annotation resources may point at user-owned Documents and must survive.
   *
   * Returns:
   * - `true` when an owned Quick Note was removed, otherwise `false`.
   */
  delete = async (id: string): Promise<boolean> =>
    this.db.transaction(async (tx) => {
      const [quickNote] = await tx
        .select()
        .from(quickNotes)
        .where(and(eq(quickNotes.id, id), this.ownershipWhere()));

      if (!quickNote) return false;

      const generatedResources = await tx
        .select({ documentId: quickNoteResources.documentId })
        .from(quickNoteResources)
        .where(
          and(
            eq(quickNoteResources.quickNoteId, quickNote.id),
            eq(quickNoteResources.role, 'annotation'),
          ),
        );
      const proposalDocuments = await tx
        .select({ documentId: quickNoteProposals.documentId })
        .from(quickNoteProposals)
        .where(eq(quickNoteProposals.quickNoteId, quickNote.id));

      await tx.delete(quickNotes).where(eq(quickNotes.id, quickNote.id));
      await tx.delete(documents).where(eq(documents.id, quickNote.documentId));
      await tx.delete(topics).where(eq(topics.id, quickNote.topicId));

      const generatedDocumentIds = [
        ...generatedResources.map(({ documentId }) => documentId),
        ...proposalDocuments.map(({ documentId }) => documentId),
      ].filter((documentId): documentId is string => Boolean(documentId));
      if (generatedDocumentIds.length > 0) {
        await tx.delete(documents).where(inArray(documents.id, generatedDocumentIds));
      }

      return true;
    });

  private ownershipWhere = () =>
    and(
      eq(quickNotes.userId, this.userId),
      this.workspaceId
        ? eq(quickNotes.workspaceId, this.workspaceId)
        : isNull(quickNotes.workspaceId),
    )!;
}
