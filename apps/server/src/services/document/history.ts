import { buildWorkspaceWhere } from '@lobechat/database';
import type { DocumentItem } from '@lobechat/database/schemas';
import { documentHistories, documentReviewSessions, documents } from '@lobechat/database/schemas';
import { and, desc, eq, gte, inArray, lt, or } from 'drizzle-orm';

import {
  DOCUMENT_HISTORY_AUTOSAVE_WINDOW_MS,
  DOCUMENT_HISTORY_QUERY_LIST_LIMIT,
  DOCUMENT_HISTORY_SOURCE_LIMITS,
} from '@/const/documentHistory';
import { isValidEditorData } from '@/libs/editor/isValidEditorData';

import type {
  CompareDocumentHistoryItemsParams,
  CompareDocumentHistoryItemsResult,
  DatabaseLike,
  DocumentHistoryAccessOptions,
  DocumentHistoryItemResult,
  DocumentHistoryListItem,
  DocumentHistorySaveSource,
  GetDocumentHistoryItemParams,
  ListDocumentHistoryParams,
  ListDocumentHistoryResult,
} from './types';

const getDocumentEditorData = (document: DocumentItem | undefined): Record<string, any> | null => {
  const editorData = document?.editorData;

  return isValidEditorData(editorData) ? editorData : null;
};

export class DocumentHistoryService {
  private readonly db: DatabaseLike;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: DatabaseLike, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private documentsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents);

  private historiesOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documentHistories);

  /** A review session references the snapshot it compares against by history id. */
  private isHistoryReferencedByReview = async (historyId: string, documentId: string) => {
    const session = await this.db.query.documentReviewSessions.findFirst({
      columns: { id: true },
      where: and(
        eq(documentReviewSessions.baseHistoryId, historyId),
        eq(documentReviewSessions.documentId, documentId),
      ),
    });

    return Boolean(session);
  };

  /**
   * Every history row a review session pinned as its comparison base. Retention
   * must treat these as undeletable: dropping one makes every later Analyze fail
   * with `BASELINE_NOT_FOUND`, and the panel keeps reusing the dead id.
   */
  private pinnedReviewBaselineIds = async (documentId: string) => {
    const rows = await this.db
      .select({ id: documentReviewSessions.baseHistoryId })
      .from(documentReviewSessions)
      .where(eq(documentReviewSessions.documentId, documentId));

    return rows.map((row) => row.id).filter((id): id is string => Boolean(id));
  };

  createHistory = async (params: {
    breakAutosaveWindow?: boolean;
    documentId: string;
    editorData: Record<string, any>;
    saveSource: DocumentHistorySaveSource;
    savedAt: Date;
  }) => {
    const [document] = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, params.documentId), this.documentsOwnership()))
      .limit(1);

    if (!document) {
      throw new Error('Document not found');
    }

    // Autosave versions coalesce into fixed 10-min windows (Notion-like),
    // bucketed on the clock grid so the anchor stays immutable even though the
    // overwritten row's savedAt keeps moving — a sliding anchor would collapse
    // an entire continuous editing session into a single version.
    // Any non-autosave version in between closes the window.
    if (params.saveSource === 'autosave' && !params.breakAutosaveWindow) {
      const latest = await this.db.query.documentHistories.findFirst({
        orderBy: [desc(documentHistories.savedAt), desc(documentHistories.id)],
        where: and(eq(documentHistories.documentId, params.documentId), this.historiesOwnership()),
      });

      const withinWindow =
        latest?.saveSource === 'autosave' &&
        Math.floor(latest.savedAt.getTime() / DOCUMENT_HISTORY_AUTOSAVE_WINDOW_MS) ===
          Math.floor(params.savedAt.getTime() / DOCUMENT_HISTORY_AUTOSAVE_WINDOW_MS);

      // A document review pins its baseline by history id, so a coalescing
      // autosave must not rewrite that row: the impact analysis would then
      // compare the newest body against a snapshot it never saw. When the row is
      // referenced, fall through and open a fresh window instead of overwriting.
      const pinnedAsReviewBaseline = withinWindow
        ? await this.isHistoryReferencedByReview(latest.id, params.documentId)
        : false;

      if (withinWindow && !pinnedAsReviewBaseline) {
        await this.db
          .update(documentHistories)
          .set({ editorData: params.editorData, savedAt: params.savedAt })
          .where(and(eq(documentHistories.id, latest.id), this.historiesOwnership()));

        return { id: latest.id, savedAt: params.savedAt };
      }
    }

    const [history] = await this.db
      .insert(documentHistories)
      .values({
        documentId: params.documentId,
        editorData: params.editorData,
        saveSource: params.saveSource,
        savedAt: params.savedAt,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      })
      .returning({ id: documentHistories.id });

    await this.trimHistoryBySource(params.documentId, params.saveSource);

    return { id: history!.id, savedAt: params.savedAt };
  };

  compareDocumentHistoryItems = async (
    params: CompareDocumentHistoryItemsParams,
    options?: DocumentHistoryAccessOptions,
  ): Promise<CompareDocumentHistoryItemsResult> => {
    const [from, to] = await Promise.all([
      this.getDocumentHistoryItem(
        { documentId: params.documentId, historyId: params.fromHistoryId },
        options,
      ),
      this.getDocumentHistoryItem(
        { documentId: params.documentId, historyId: params.toHistoryId },
        options,
      ),
    ]);

    return { from, to };
  };

  getDocumentHistoryItem = async (
    params: GetDocumentHistoryItemParams,
    options?: DocumentHistoryAccessOptions,
  ): Promise<DocumentHistoryItemResult> => {
    const headDocument = await this.findHeadDocument(params.documentId);

    if (!headDocument) {
      throw new Error(`Document not found: ${params.documentId}`);
    }

    // Treat 'head' as a special historyId representing the current document state
    if (params.historyId === 'head') {
      return {
        editorData: getDocumentEditorData(headDocument),
        id: 'head',
        isCurrent: true,
        saveSource: 'system',
        savedAt: headDocument.updatedAt,
      };
    }

    const historyRow = await this.db.query.documentHistories.findFirst({
      where: and(
        eq(documentHistories.id, params.historyId),
        eq(documentHistories.documentId, params.documentId),
        this.historiesOwnership(),
        options?.historySince ? gte(documentHistories.savedAt, options.historySince) : undefined,
      ),
    });

    if (!historyRow) {
      throw new Error(`Document history item not found: ${params.documentId}@${params.historyId}`);
    }

    return {
      editorData: historyRow.editorData as Record<string, any>,
      id: historyRow.id,
      isCurrent: false,
      saveSource: historyRow.saveSource as DocumentHistorySaveSource,
      savedAt: historyRow.savedAt,
    };
  };

  listDocumentHistory = async (
    params: ListDocumentHistoryParams,
    options?: DocumentHistoryAccessOptions,
  ): Promise<ListDocumentHistoryResult> => {
    const limit = Math.min(params.limit ?? DOCUMENT_HISTORY_QUERY_LIST_LIMIT, 100);
    const headDocument = await this.findHeadDocument(params.documentId);

    if (!headDocument) {
      return { items: [] };
    }

    const includeCurrent = params.includeCurrent ?? true;
    // Head is a synthetic "current" item that always sorts first.
    // Once pagination starts (beforeSavedAt is defined), head has already been passed.
    const shouldIncludeHead = includeCurrent && params.beforeSavedAt === undefined;

    // When head is included, it occupies one slot. To avoid dropping a history
    // row that would then be skipped by an exclusive cursor, we query enough
    // rows so that we can return (limit - 1) history items plus head while
    // basing the cursor on the last returned row (not a dropped one).
    const effectiveLimit = shouldIncludeHead ? Math.max(limit, 2) : limit;

    const historyRows = await this.db.query.documentHistories.findMany({
      limit: effectiveLimit,
      orderBy: [desc(documentHistories.savedAt), desc(documentHistories.id)],
      where: and(
        eq(documentHistories.documentId, params.documentId),
        this.historiesOwnership(),
        options?.historySince ? gte(documentHistories.savedAt, options.historySince) : undefined,
        params.beforeSavedAt !== undefined && params.beforeId !== undefined
          ? or(
              lt(documentHistories.savedAt, params.beforeSavedAt),
              and(
                eq(documentHistories.savedAt, params.beforeSavedAt),
                lt(documentHistories.id, params.beforeId),
              ),
            )
          : params.beforeSavedAt !== undefined
            ? lt(documentHistories.savedAt, params.beforeSavedAt)
            : undefined,
      ),
    });

    const items: DocumentHistoryListItem[] = [];

    if (shouldIncludeHead) {
      items.push({
        id: 'head',
        isCurrent: true,
        saveSource: 'system',
        savedAt: headDocument.updatedAt,
        userId: headDocument.userId,
      });
    }

    const historyItems = historyRows.map((row) => ({
      id: row.id,
      isCurrent: false,
      saveSource: row.saveSource as DocumentHistorySaveSource,
      savedAt: row.savedAt,
      userId: row.userId,
    }));

    // If head consumed a slot and we fetched a full page of history rows,
    // drop the last history item so total count respects the limit.
    if (shouldIncludeHead && historyRows.length === effectiveLimit) {
      items.push(...historyItems.slice(0, -1));
    } else {
      items.push(...historyItems);
    }

    const hasMore = historyRows.length === effectiveLimit && historyRows.length > 0;

    // Cursor must be based on the last item actually returned, not a dropped row.
    // For head + full page, the last returned history row is the penultimate DB row.
    const lastRow = hasMore
      ? shouldIncludeHead
        ? historyRows.at(-2)
        : historyRows.at(-1)
      : undefined;

    return {
      items,
      nextBeforeId: lastRow?.id,
      nextBeforeSavedAt: lastRow?.savedAt,
    };
  };

  private findHeadDocument = async (documentId: string) => {
    return this.db.query.documents.findFirst({
      where: and(eq(documents.id, documentId), this.documentsOwnership()),
    });
  };

  private trimHistoryBySource = async (
    documentId: string,
    saveSource: DocumentHistorySaveSource,
  ) => {
    const limit = DOCUMENT_HISTORY_SOURCE_LIMITS[saveSource];
    const BATCH_SIZE = 100;

    const pinnedIds = new Set(await this.pinnedReviewBaselineIds(documentId));

    const rows = await this.db
      .select({ id: documentHistories.id })
      .from(documentHistories)
      .where(
        and(
          eq(documentHistories.documentId, documentId),
          this.historiesOwnership(),
          eq(documentHistories.saveSource, saveSource),
        ),
      )
      .orderBy(desc(documentHistories.savedAt), desc(documentHistories.id));

    // Keep the newest `limit` rows plus every pinned baseline, and only then
    // spill into the delete batch: a baseline is never part of the retention
    // budget, however far back it sits.
    const rowsToDelete: string[] = [];
    let retained = 0;
    for (const row of rows) {
      if (pinnedIds.has(row.id)) continue;

      if (retained < limit) {
        retained++;
        continue;
      }

      rowsToDelete.push(row.id);
      if (rowsToDelete.length >= BATCH_SIZE) break;
    }

    if (rowsToDelete.length === 0) return;

    await this.db.delete(documentHistories).where(
      and(
        eq(documentHistories.documentId, documentId),
        this.historiesOwnership(),
        eq(documentHistories.saveSource, saveSource),
        inArray(documentHistories.id, rowsToDelete),
      ),
    );
  };
}
