import { DocumentModel } from '@/database/models/document';
import type { LobeChatDatabase } from '@/database/type';
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

/** The stored fields this API exposes; `content` is absent from list rows. */
interface DocumentRow {
  content?: string | null;
  createdAt: Date;
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
});

const notFound = (id: string) => new ApiException(404, 'not_found', `Document not found: ${id}`);

/**
 * Documents REST service.
 *
 * Writes go through the same create/update flow as the in-app editor
 * (`@/server/services/document/writeFlow`): slug parents, the parent
 * visibility check, Markdown → editor data and writing into an open page's
 * live room are not re-implemented here.
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
    const document = await createDocumentFromInput(this.context, body);

    return toPublicDocument(document);
  }

  async updateDocument(id: string, body: UpdateDocumentRequest): Promise<PublicDocument> {
    // The document service reports a missing row as a plain error; answer 404.
    if (!(await this.documentModel.findById(id))) throw notFound(id);

    await updateDocumentFromInput(this.context, { ...body, id });

    return this.getDocument(id);
  }
}
