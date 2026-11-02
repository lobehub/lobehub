import { and, eq, isNull, sql } from 'drizzle-orm';
import isEqual from 'fast-deep-equal';

import { DocumentModel } from '../../models/document';
import { DocumentHistoryModel } from '../../models/documentHistory';
import type {
  ClaimQuickNoteRunParams,
  CompleteQuickNoteRunParams,
  CreateQuickNoteParams,
  UpdateQuickNoteContentParams,
} from '../../models/quickNote';
import { QuickNoteModel } from '../../models/quickNote';
import { QUICK_NOTE_TASK } from '../../models/taskListFilters';
import { TopicModel } from '../../models/topic';
import { type QuickNoteProposalItem, tasks } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { idGenerator } from '../../utils/idGenerator';

/**
 * Thrown inside a transaction when an owned row checked earlier in the same flow is no longer
 * writable, so the whole unit of work rolls back instead of committing half of it.
 */
export const QUICK_NOTE_SCOPE_LOST = 'QUICK_NOTE_SCOPE_LOST';

/** Line count stored beside a Document body, matching the Document service projection. */
const countLines = (content: string) => (content.length === 0 ? 0 : content.split('\n').length);

/**
 * Quick Note units of work that span the Quick Note aggregate and the Documents, Document
 * Histories, and Topics it creates or edits.
 *
 * A Quick Note stores its source as a private Document, pins source revisions as Document
 * Histories, and its Runs chat in Topics their agent operations create. Each of those has a
 * lifecycle of its own, so every flow that writes them together commits here in one transaction,
 * composing the single-aggregate models bound to the transaction handle, rather than inside
 * {@link QuickNoteModel}.
 *
 * Expects:
 * - `userId` owns every read and mutation; `workspaceId` is omitted in personal mode.
 */
export class QuickNoteRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private models = (tx: LobeChatDatabase) => ({
    document: new DocumentModel(tx, this.userId, this.workspaceId),
    history: new DocumentHistoryModel(tx, this.userId, this.workspaceId),
    quickNote: new QuickNoteModel(tx, this.userId, this.workspaceId),
  });

  /**
   * Atomically creates a Quick Note, its private backing Document, and any sent-from resources.
   *
   * Use when:
   * - The user starts a new capture, possibly from another surface (message, Page, Topic).
   *
   * Expects:
   * - `content` is the searchable plain-text projection of `editorData`.
   * - `resources` are linked as `context` against a system revision of the initial source;
   *   inaccessible references are skipped.
   *
   * Returns:
   * - The newly persisted Quick Note.
   */
  create = async (params: CreateQuickNoteParams) => {
    const quickNoteId = params.id ?? idGenerator('quickNotes');
    const documentId = idGenerator('documents', 16);
    const content = params.content ?? '';
    const editorData = params.editorData ?? { root: { children: [] } };

    return this.db.transaction(async (trx) => {
      const tx = trx as LobeChatDatabase;
      const { document, history, quickNote } = this.models(tx);

      await document.create({
        content,
        editorData,
        fileType: 'text/markdown',
        id: documentId,
        source: `quick-note:${quickNoteId}`,
        sourceType: 'quick-note',
        totalCharCount: content.length,
        totalLineCount: countLines(content),
        visibility: 'private',
      });

      const created = await quickNote.createRecord({
        analyzeDueAt: params.analyzeDueAt,
        collection: params.collection,
        documentId,
        id: quickNoteId,
        location: params.location,
        tags: params.tags,
      });

      if (params.resources?.length) {
        const initialHistory = await history.append({
          documentId,
          editorData,
          saveSource: 'system',
          savedAt: new Date(),
        });
        await quickNote.linkUserResources(created.id, initialHistory.id, params.resources);
      }

      return created;
    });
  };

  /**
   * Saves the mutable source projection without creating a processing Run.
   *
   * Use when:
   * - Debounced editor persistence reaches the server.
   *
   * Expects:
   * - `editorData` and `content` describe the same editor state.
   * - A rich-text change keeps the previous state as a bounded autosave Document History.
   * - `isEquivalentText` decides whether a text edit is cosmetic (whitespace, punctuation, case).
   *   A cosmetic or rich-text-only edit keeps the existing `analyze_due_at`, so it never
   *   reschedules Analyze. Proposals are never marked stale here: whether the meaning changed is
   *   judged asynchronously by the caller.
   *
   * Returns:
   * - The updated owner-scoped Quick Note plus how its text changed, or `undefined` when
   *   inaccessible. `contentChange` is `none` (same text), `equivalent` (cosmetic edit), or
   *   `changed`.
   */
  updateContent = async (
    id: string,
    params: UpdateQuickNoteContentParams & {
      isEquivalentText?: (previous: string, next: string) => boolean;
    },
  ) =>
    this.db.transaction(async (trx) => {
      const { document, history, quickNote: model } = this.models(trx as LobeChatDatabase);
      const quickNote = await model.findWithContent(id);

      if (!quickNote) return undefined;

      const { isEquivalentText, ...content } = params;
      const savedAt = new Date();
      const currentEditorData = quickNote.editorData ?? { root: { children: [] } };
      const previousContent = quickNote.content ?? '';
      const contentChange: 'changed' | 'equivalent' | 'none' =
        previousContent === content.content
          ? 'none'
          : isEquivalentText?.(previousContent, content.content)
            ? 'equivalent'
            : 'changed';
      if (!isEqual(currentEditorData, content.editorData)) {
        await history.recordAutosave(quickNote.documentId, currentEditorData, savedAt);
      }

      await document.replaceContent(
        quickNote.documentId,
        { content: content.content, editorData: content.editorData },
        savedAt,
      );

      const updated = await model.recordContentSave(quickNote.id, {
        // Only a real text change restarts the quiet period before Automatic Analyze.
        analyzeDueAt: contentChange === 'changed' ? content.analyzeDueAt : undefined,
        // Each real text change re-arms the meaning-change check; the last edit sets the time.
        contentCheckDueAt: contentChange === 'changed' ? content.contentCheckDueAt : undefined,
        updatedAt: savedAt,
      });

      return updated ? { ...updated, contentChange } : undefined;
    });

  /**
   * Claims a Run, pins a non-coalescing system Document History, and stores the rendered input
   * snapshot (source text, Comments, pending Proposals) on the Run.
   *
   * Use when:
   * - Dispatching Automatic Analyze or Signal enrichment.
   *
   * Expects:
   * - Only one pending/running Run of the same kind is needed per capture.
   * - `renderSourceText` turns the pinned editor state into plain text.
   *
   * Returns:
   * - The existing active Run, a new pending Run, or `undefined` when inaccessible.
   */
  claimRun = async (id: string, params: ClaimQuickNoteRunParams) =>
    this.db.transaction(async (trx) => {
      const { history: historyModel, quickNote: model } = this.models(trx as LobeChatDatabase);
      const quickNote = await model.findWithContent(id);

      if (!quickNote) return undefined;

      const activeRun = await model.findActiveRun(id, params.kind);

      if (activeRun) return activeRun;

      const editorData = quickNote.editorData ?? { root: { children: [] } };
      const history = await historyModel.append({
        documentId: quickNote.documentId,
        editorData,
        saveSource: 'system',
        savedAt: new Date(),
      });
      const inputs = await model.collectRunInputs(quickNote.id);

      const run = await model.insertPendingRun(quickNote.id, history.id, {
        inputSnapshot: {
          ...inputs,
          source: params.renderSourceText(editorData),
          sourceHistoryId: history.id,
        },
        kind: params.kind,
        trigger: params.trigger,
      });

      if (run) return run;

      // A concurrent claimant won the partial unique index after this transaction
      // created its snapshot. Remove the unused snapshot, then return that winner.
      await historyModel.delete(history.id);

      return model.findActiveRun(id, params.kind);
    });

  /**
   * Completes a Run with its summary, intent decision, tags, and any Proposals it suggested.
   *
   * Use when:
   * - An Analyze or Signal enrichment Run returns accepted output.
   *
   * Expects:
   * - `runId` belongs to the current owner and is pending or running.
   * - A stale Run (source edited since its snapshot) is recorded but does not change current tags.
   *
   * Returns:
   * - The completed Run and created Proposals, or `undefined` when inaccessible or already terminal.
   */
  completeRun = async (runId: string, params: CompleteQuickNoteRunParams) =>
    this.db.transaction(async (trx) => {
      const { quickNote: model } = this.models(trx as LobeChatDatabase);
      const run = await model.findRunForCompletion(runId);

      if (!run || !['pending', 'running'].includes(run.status)) return undefined;

      const proposals: QuickNoteProposalItem[] = [];
      for (const draft of params.proposals ?? []) {
        const proposal = await model.createProposal({
          ...draft,
          quickNoteId: run.quickNoteId,
          runId,
          sourceHistoryId: run.sourceHistoryId,
        });
        if (!proposal) throw new Error(QUICK_NOTE_SCOPE_LOST);
        proposals.push(proposal);
      }

      const completion = await model.completeRun(runId, run, params);
      if (!completion) throw new Error(QUICK_NOTE_SCOPE_LOST);

      // A judgement of the current source is authoritative: it replaces every earlier pending
      // suggestion, stale or not (the debounced meaning check is only a hint shown before the new
      // judgement lands). A Run of an outdated revision never supersedes anything.
      const superseded = completion.sourceIsCurrent
        ? await model.supersedeEarlierProposals(run.quickNoteId, runId)
        : [];

      return { proposals, run: completion.run, superseded };
    });

  /**
   * Turns the Tasks a deleted note started into ordinary Tasks.
   *
   * Quick Note Tasks are hidden from task lists and Recent and are listed in the note sidebar
   * instead. Once the note is gone, that sidebar is gone too, so their `context.source` marker is
   * dropped: the Tasks (and their conversations, the user's own work) show in the normal lists
   * again. Dropping the marker, rather than adding an `orphaned` flag, keeps the single
   * `source.type = 'quick_note'` filter correct everywhere without teaching each list a new state;
   * the ids it held point at rows that no longer exist.
   */
  private detachQuickNoteTasks = async (tx: LobeChatDatabase, quickNoteId: string) =>
    tx
      .update(tasks)
      .set({ context: sql`${tasks.context} - 'source'` })
      .where(
        and(
          eq(tasks.createdByUserId, this.userId),
          this.workspaceId ? eq(tasks.workspaceId, this.workspaceId) : isNull(tasks.workspaceId),
          QUICK_NOTE_TASK,
          sql`(${tasks.context} -> 'source' ->> 'quickNoteId') = ${quickNoteId}`,
        ),
      );

  /**
   * Deletes a capture, its private source Document, and the Topics its Runs created.
   *
   * Use when:
   * - The owner removes a Quick Note from the existing list UI.
   *
   * Expects:
   * - Linked resources may point at user-owned objects and must survive.
   *
   * Returns:
   * - `true` when an owned Quick Note was removed, otherwise `false`.
   */
  delete = async (id: string): Promise<boolean> =>
    this.db.transaction(async (trx) => {
      const tx = trx as LobeChatDatabase;
      const { document, quickNote } = this.models(tx);
      const deleted = await quickNote.deleteRecord(id);

      if (!deleted) return false;

      await document.batchDeleteIncludingTrashed([deleted.documentId]);
      await this.detachQuickNoteTasks(tx, id);
      if (deleted.topicIds.length > 0) {
        await new TopicModel(tx, this.userId, this.workspaceId).batchDeleteIncludingTrashed(
          deleted.topicIds,
        );
      }

      return true;
    });
}
