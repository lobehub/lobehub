import { CUSTOM_FOLDER_FILE_TYPE, HTML_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import { TRPCError } from '@trpc/server';

import { DocumentModel } from '@/database/models/document';
import type { LobeChatDatabase } from '@/database/type';
import { isValidEditorData } from '@/libs/editor/isValidEditorData';
import { DOCUMENT_EDITOR_DATA_MAX_LENGTH } from '@/server/routers/lambda/_schema/documentHistory';
import { exportEditorDataSnapshot } from '@/server/services/agentDocuments/headlessEditor';
import { DocumentService } from '@/server/services/document';
import {
  createDocumentFromInput,
  type DocumentWriteContext,
  updateDocumentFromInput,
} from '@/server/services/document/writeFlow';
import { getDocumentForViewer } from '@/server/services/documentAccess';
import {
  assertContentsNotInRestrictedKnowledgeBase,
  getRestrictedKnowledgeBaseIds,
} from '@/server/services/knowledgeBaseAccess';

import { BaseService } from '../common/base.service';
import { ApiException } from '../common/errors';
import { resolvePagination } from '../helpers/pagination';
import type {
  CreateDocumentRequest,
  DocumentListQuery,
  DocumentSummary,
  PublicDocument,
  UpdateDocumentRequest,
} from '../types/document.type';

/** The stored fields this API exposes; `content` and `editorData` are absent from list rows. */
interface DocumentRow {
  content?: string | null;
  createdAt: Date;
  editorData?: unknown;
  fileType: string;
  id: string;
  parentId: string | null;
  slug: string | null;
  title: string | null;
  updatedAt: Date;
}

const toSummary = (row: DocumentRow): DocumentSummary => ({
  createdAt: row.createdAt.toISOString(),
  fileType: row.fileType,
  id: row.id,
  parentId: row.parentId ?? null,
  slug: row.slug ?? null,
  title: row.title ?? null,
  updatedAt: row.updatedAt.toISOString(),
});

const toPublicDocument = (row: DocumentRow): PublicDocument => ({
  ...toSummary(row),
  content: row.content ?? null,
  // Older CLI builds stored `{ type: 'doc', content }`; only Lexical state is editor data.
  editorData: isValidEditorData(row.editorData) ? row.editorData : null,
});

const notFound = (id: string) => new ApiException(404, 'not_found', `Document not found: ${id}`);

/** `ifUpdatedAt` no longer names the stored version; the detail carries the one that does. */
const versionConflict = (updatedAt: Date) =>
  new ApiException(
    409,
    'conflict',
    'Document was updated after ifUpdatedAt; read it again before saving',
    [{ message: updatedAt.toISOString(), path: 'json.ifUpdatedAt' }],
  );

/**
 * The body fields a write hands to the shared write flow, which takes editor
 * state serialized. Editor data sent without Markdown gets the Markdown the
 * editor exports from it, so `content` never lags behind the rich text.
 */
const toBodyWrite = async (
  { content, editorData }: { content?: string; editorData?: Record<string, unknown> },
  fileType: string | undefined,
): Promise<{ content?: string; editorData?: string }> => {
  if (editorData === undefined) return { content };

  // An HTML page's body is its content alone, and a folder has no body; the
  // write flow would drop or keep the state silently, so refuse it here.
  if (fileType === HTML_DOCUMENT_FILE_TYPE || fileType === CUSTOM_FOLDER_FILE_TYPE) {
    throw new ApiException(
      400,
      'bad_request',
      `A ${fileType} document carries no editorData; send Markdown content instead`,
    );
  }

  const serialized = JSON.stringify(editorData);
  if (serialized.length > DOCUMENT_EDITOR_DATA_MAX_LENGTH) {
    const message = `Serialized editorData exceeds ${DOCUMENT_EDITOR_DATA_MAX_LENGTH} characters`;
    throw new ApiException(400, 'validation_error', `Invalid request: ${message}`, [
      { message, path: 'json.editorData' },
    ]);
  }

  return {
    content: content ?? (await exportEditorDataSnapshot({ editorData })).content,
    editorData: serialized,
  };
};

/**
 * Documents REST service.
 *
 * Writes go through the same create/update flow as the in-app editor
 * (`@/server/services/document/writeFlow`): slug parents, the parent
 * visibility check, Markdown → editor data, the HTML-page rule and writing
 * into an open page's live room are not re-implemented here.
 */
export class DocumentRestService extends BaseService {
  private readonly documentModel: DocumentModel;
  private readonly documentService: DocumentService;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.documentModel = new DocumentModel(db, this.userId, workspaceId);
    this.documentService = new DocumentService(db, this.userId, workspaceId);
  }

  private get context(): DocumentWriteContext {
    return {
      documentModel: this.documentModel,
      documentService: this.documentService,
      serverDB: this.db,
      userId: this.userId,
      workspaceId: this.workspaceId,
    };
  }

  async listDocuments(query: DocumentListQuery) {
    const { limit, offset } = resolvePagination(query);
    let parentId = query.parentId;
    if (parentId) {
      const folderBySlug = await this.documentModel.findBySlug(parentId);
      if (folderBySlug) parentId = folderBySlug.id;
    }
    // Pages in restricted (member No-access) libraries stay out of listings,
    // the same exclusion the in-app sidebar applies.
    const excludeKnowledgeBaseIds = await getRestrictedKnowledgeBaseIds(this.context);
    const { items, total } = await this.documentService.queryDocuments({
      excludeKnowledgeBaseIds,
      offset,
      pageSize: limit,
      parentId,
    });

    return { items: items.map(toSummary), total };
  }

  async getDocument(id: string): Promise<PublicDocument> {
    await assertContentsNotInRestrictedKnowledgeBase(this.context, [id]);
    const document = await getDocumentForViewer(this.context, id);
    if (!document) throw notFound(id);

    return toPublicDocument(document);
  }

  async createDocument(body: CreateDocumentRequest): Promise<PublicDocument> {
    const { editorData, ...input } = body;
    const bodyWrite = await toBodyWrite({ content: input.content, editorData }, input.fileType);
    const document = await createDocumentFromInput(this.context, { ...input, ...bodyWrite });

    return toPublicDocument(document);
  }

  async updateDocument(id: string, body: UpdateDocumentRequest): Promise<PublicDocument> {
    const { editorData, ifUpdatedAt, ...input } = body;
    // The document service reports a missing row as a plain error; answer 404.
    const current = await this.documentModel.findById(id);
    if (!current) throw notFound(id);

    // An early answer for a version that is already stale. The write enforces it
    // itself, on the row or in the page's live room, where it cannot race.
    const expectedUpdatedAt = ifUpdatedAt === undefined ? undefined : new Date(ifUpdatedAt);
    if (expectedUpdatedAt && current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw versionConflict(current.updatedAt);
    }

    const bodyWrite = await toBodyWrite({ content: input.content, editorData }, current.fileType);
    try {
      await updateDocumentFromInput(this.context, {
        ...input,
        ...bodyWrite,
        expectedUpdatedAt,
        id,
      });
    } catch (error) {
      // Another save landed before the write, or the page's live room held edits
      // the stored page did not show yet (the write stored them first).
      const versionMismatch =
        error instanceof TRPCError &&
        error.code === 'CONFLICT' &&
        (error.cause as { data?: { code?: string } } | undefined)?.data?.code ===
          'DocumentVersionMismatch';
      const latest = versionMismatch ? await this.documentModel.findById(id) : undefined;
      if (latest) throw versionConflict(latest.updatedAt);
      throw error;
    }

    return this.getDocument(id);
  }
}
