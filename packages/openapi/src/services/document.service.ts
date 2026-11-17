import { pageShareRouter } from '@/business/server/lambda-routers/pageShare';
import type { DocumentItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { documentRouter } from '@/server/routers/lambda/document';
import { exportEditorDataSnapshot } from '@/server/services/agentDocuments/headlessEditor';
import { DocumentService } from '@/server/services/document';
import { resolveDocumentWrite } from '@/server/services/document/editorData';
import { getRestrictedKnowledgeBaseIds } from '@/server/services/knowledgeBaseAccess';

import { BaseService } from '../common/base.service';
import { ApiException } from '../common/errors';
import { resolvePagination } from '../helpers/pagination';
import type { DeletedResource, DeletedResources } from '../types/common.type';
import type {
  BatchCreateDocumentsRequest,
  CreateDocumentRequest,
  DocumentListQuery,
  DocumentResponse,
  DocumentShare,
  DocumentSummary,
  DocumentVersion,
  UpdateDocumentRequest,
} from '../types/document.type';

/** `Date` (or an ISO string that already crossed a JSON boundary) as ISO 8601. */
export const toIso = (value: Date | string): string => new Date(value).toISOString();

type DocumentRow = Pick<
  DocumentItem,
  | 'createdAt'
  | 'fileId'
  | 'fileType'
  | 'filename'
  | 'id'
  | 'metadata'
  | 'parentId'
  | 'slug'
  | 'source'
  | 'sourceType'
  | 'title'
  | 'totalCharCount'
  | 'totalLineCount'
  | 'updatedAt'
  | 'userId'
  | 'visibility'
  | 'workspaceId'
>;

export const toDocumentSummary = (row: DocumentRow): DocumentSummary => ({
  createdAt: toIso(row.createdAt),
  fileId: row.fileId ?? null,
  fileType: row.fileType,
  filename: row.filename ?? null,
  id: row.id,
  metadata: row.metadata ?? null,
  parentId: row.parentId ?? null,
  slug: row.slug ?? null,
  source: row.source,
  sourceType: row.sourceType,
  title: row.title ?? null,
  totalCharCount: row.totalCharCount,
  totalLineCount: row.totalLineCount,
  updatedAt: toIso(row.updatedAt),
  userId: row.userId,
  visibility: row.visibility,
  workspaceId: row.workspaceId ?? null,
});

export const toDocument = (row: DocumentItem): DocumentResponse => ({
  ...toDocumentSummary(row),
  content: row.content ?? null,
  description: row.description ?? null,
  editorData: row.editorData ?? null,
  knowledgeBaseId: row.knowledgeBaseId ?? null,
});

interface HistoryState {
  editorData: Record<string, any> | null;
  id: string;
  isCurrent: boolean;
  savedAt: Date | string;
  saveSource: DocumentVersion['saveSource'];
}

/** A version with its body rendered to Markdown, so REST clients never parse editor state. */
const toVersion = async (state: HistoryState): Promise<DocumentVersion> => ({
  content: state.editorData
    ? (await exportEditorDataSnapshot({ editorData: state.editorData })).content
    : '',
  editorData: state.editorData,
  id: state.id,
  isCurrent: state.isCurrent,
  saveSource: state.saveSource,
  savedAt: toIso(state.savedAt),
});

/** Version-list cursor: the `(id, savedAt)` pair the history query resumes before. */
const encodeVersionCursor = (id: string, savedAt: Date | string) =>
  Buffer.from(JSON.stringify([id, toIso(savedAt)])).toString('base64url');

const decodeVersionCursor = (cursor: string): { beforeId: string; beforeSavedAt: string } => {
  try {
    const [beforeId, beforeSavedAt] = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (
      typeof beforeId === 'string' &&
      typeof beforeSavedAt === 'string' &&
      !Number.isNaN(Date.parse(beforeSavedAt))
    ) {
      return { beforeId, beforeSavedAt: toIso(beforeSavedAt) };
    }
  } catch {
    // fall through to the validation error below
  }
  throw new ApiException(400, 'validation_error', 'Invalid request: query.cursor is not valid', [
    { message: 'Not a cursor returned by this endpoint', path: 'query.cursor' },
  ]);
};

const SHARE_UNAVAILABLE = 'Page sharing is not available on this deployment';

/**
 * Documents / Pages REST service.
 *
 * Every write goes through the same `document` / `pageShare` tRPC procedures the
 * web editor and `lh doc` call — invoked server-side, with no API-key scopes in
 * their context (the REST route has already narrowed the key to
 * `document:*`). That keeps one implementation of the rules that matter:
 * workspace visibility and General Access, restricted knowledge bases, the
 * per-plan length limit, collaborative-room writes, mention notifications and
 * resource-permission bookkeeping. This layer only shapes requests and
 * responses and turns "not visible" into 404.
 */
export class DocumentRestService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string };

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId };
  }

  private get documents() {
    return documentRouter.createCaller(this.ctx);
  }

  private get shares() {
    return pageShareRouter.createCaller(this.ctx);
  }

  /** The document as the caller may read it; 404 when it does not exist or is not visible. */
  private async requireDocument(id: string): Promise<DocumentItem> {
    const document = await this.documents.getDocumentById({ id });
    if (!document) throw this.createNotFoundError('Document not found');
    return document as DocumentItem;
  }

  async listDocuments(query: DocumentListQuery) {
    const { limit, offset } = resolvePagination(query);
    const excludeKnowledgeBaseIds = this.workspaceId
      ? await getRestrictedKnowledgeBaseIds({
          serverDB: this.db,
          userId: this.userId,
          workspaceId: this.workspaceId,
        })
      : [];

    const { items, total } = await new DocumentService(
      this.db,
      this.userId,
      this.workspaceId,
    ).queryDocuments({
      creator: query.creator,
      excludeKnowledgeBaseIds,
      fileTypes: query.fileTypes,
      keyword: query.keyword,
      offset,
      pageSize: limit,
      parentId: query.parentId === 'root' ? null : query.parentId,
      sortBy: query.sortBy,
      sourceTypes: query.sourceTypes,
      standaloneOnly: query.standaloneOnly,
    });

    return { items: items.map(toDocumentSummary), total };
  }

  async getDocument(id: string): Promise<DocumentResponse> {
    return toDocument(await this.requireDocument(id));
  }

  async createDocument(body: CreateDocumentRequest): Promise<DocumentResponse> {
    const document = await this.documents.createDocument({
      ...body,
      editorData: body.editorData ? JSON.stringify(body.editorData) : undefined,
    });
    return toDocument(document);
  }

  async batchCreateDocuments({ documents }: BatchCreateDocumentsRequest) {
    const created = await this.documents.createDocuments({
      documents: documents.map((document) => ({
        ...document,
        editorData: document.editorData ? JSON.stringify(document.editorData) : undefined,
      })),
    });
    return { items: created.map(toDocument) };
  }

  async updateDocument(id: string, body: UpdateDocumentRequest): Promise<DocumentResponse> {
    await this.requireDocument(id);
    await this.documents.updateDocument({
      content: body.content,
      editorData: body.editorData ? JSON.stringify(body.editorData) : undefined,
      expectedUpdatedAt: body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : undefined,
      fileType: body.fileType,
      id,
      metadata: body.metadata,
      title: body.title,
    });
    return this.getDocument(id);
  }

  /** Move into a folder (or to the root with `null`); a folder never moves into its own subtree. */
  async moveDocument(id: string, parentId: string | null): Promise<DocumentResponse> {
    await this.requireDocument(id);
    if (parentId) {
      const destination = await this.requireDocument(parentId).catch((error) => {
        if (error?.name === 'NotFoundError') throw this.createNotFoundError('Folder not found');
        throw error;
      });
      const chain = await this.documents.getFolderBreadcrumb({ slug: destination.id });
      if (chain.some((folder) => folder.id === id)) {
        throw this.createValidationError('A document cannot be moved into itself or its subtree');
      }
    }
    await this.documents.updateDocument({ id, parentId });
    return this.getDocument(id);
  }

  async getBreadcrumb(id: string) {
    const document = await this.requireDocument(id);
    return { items: await this.documents.getFolderBreadcrumb({ slug: document.id }) };
  }

  async deleteDocument(id: string): Promise<DeletedResource> {
    await this.requireDocument(id);
    await this.documents.deleteDocument({ id });
    return { deleted: true, id };
  }

  async batchDeleteDocuments(ids: string[]): Promise<DeletedResources> {
    const unique = [...new Set(ids)];
    await this.documents.deleteDocuments({ ids: unique });
    return { count: unique.length, deleted: true };
  }

  // ==================== Versions ====================

  async listVersions(id: string, query: { cursor?: string; limit?: number }) {
    await this.requireDocument(id);
    const { limit } = resolvePagination({ limit: query.limit });
    const before = query.cursor ? decodeVersionCursor(query.cursor) : undefined;

    const page = await this.documents.listDocumentHistory({
      ...before,
      documentId: id,
      // The live document heads the first page, so a client sees what a restore replaces.
      includeCurrent: !before,
      limit,
    });

    const nextCursor =
      page.nextBeforeId && page.nextBeforeSavedAt
        ? encodeVersionCursor(page.nextBeforeId, page.nextBeforeSavedAt)
        : null;

    return {
      hasMore: nextCursor !== null,
      items: page.items.map((item) => ({
        agentId: item.agentId ?? null,
        editorIds: item.editorIds ?? null,
        id: item.id,
        isCurrent: item.isCurrent,
        saveSource: item.saveSource,
        savedAt: toIso(item.savedAt),
        userId: item.userId,
      })),
      nextCursor,
    };
  }

  async getVersion(id: string, versionId: string): Promise<DocumentVersion> {
    await this.requireDocument(id);
    const item = await this.documents.getDocumentHistoryItem({
      documentId: id,
      historyId: versionId,
    });
    return toVersion(item);
  }

  async compareVersions(id: string, from: string, to: string) {
    await this.requireDocument(id);
    const result = await this.documents.compareDocumentHistoryItems({
      documentId: id,
      fromHistoryId: from,
      toHistoryId: to,
    });
    const [fromVersion, toVersion_] = await Promise.all([
      toVersion(result.from),
      toVersion(result.to),
    ]);
    return { from: fromVersion, to: toVersion_ };
  }

  /** Store the document as it is now as a manual version. */
  async saveVersion(id: string) {
    const document = await this.requireDocument(id);
    const editorData =
      document.editorData ??
      (
        await resolveDocumentWrite({
          content: document.content ?? '',
          fileType: document.fileType,
          title: document.title ?? undefined,
        })
      ).editorData;
    if (!editorData) {
      throw this.createValidationError('This document has no editable body to version');
    }

    const result = await this.documents.saveDocumentHistory({
      documentId: id,
      editorData: JSON.stringify(editorData),
      saveSource: 'manual',
    });
    return { id: result.historyId, savedAt: toIso(result.savedAt) };
  }

  /** Write a version's body back as the current document (recorded as a `restore` save). */
  async restoreVersion(id: string, versionId: string): Promise<DocumentResponse> {
    await this.requireDocument(id);
    const version = await this.getVersion(id, versionId);
    if (!version.editorData) {
      throw this.createValidationError('This version has no body to restore');
    }

    await this.documents.updateDocument({
      content: version.content,
      editorData: JSON.stringify(version.editorData),
      id,
      restoreFromHistoryId: versionId,
      saveSource: 'restore',
    });
    return this.getDocument(id);
  }

  // ==================== Share ====================

  private shareState(
    documentId: string,
    settings: { pageViewCount: number; permission: string; visibility: string } | null,
  ): DocumentShare {
    const visibility = settings?.visibility === 'link' ? 'link' : 'private';
    return {
      documentId,
      pageViewCount: settings?.pageViewCount ?? 0,
      permission: 'read',
      url:
        visibility === 'link' && appEnv.APP_URL
          ? new URL(`/share/page/${documentId}`, appEnv.APP_URL).toString()
          : null,
      visibility,
    };
  }

  async getShare(id: string): Promise<DocumentShare> {
    await this.requireDocument(id);
    return this.shareState(id, await this.shares.getShareSettings({ id }));
  }

  async setShare(id: string, visibility: 'link' | 'private'): Promise<DocumentShare> {
    await this.requireDocument(id);
    // Deployments without page sharing answer the mutation with `null`.
    const result = await this.shares.updateShareSettings({ id, permission: 'read', visibility });
    if (!result) throw new ApiException(412, 'precondition_failed', SHARE_UNAVAILABLE);

    return this.shareState(id, await this.shares.getShareSettings({ id }));
  }
}
