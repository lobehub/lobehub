import { TopicModel } from '@/database/models/topic';
import { TopicDocumentModel } from '@/database/models/topicDocument';
import type { DocumentItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { documentRouter } from '@/server/routers/lambda/document';
import { notebookRouter } from '@/server/routers/lambda/notebook';

import { BaseService } from '../common/base.service';
import { ApiException } from '../common/errors';
import { resolvePagination } from '../helpers/pagination';
import type { DeletedResource } from '../types/common.type';
import type {
  AssociateNotebookDocumentRequest,
  CreateNotebookDocumentRequest,
  NotebookDocumentResponse,
  NotebookListQuery,
  UpdateNotebookDocumentRequest,
} from '../types/notebook.type';
import { NotebookDocumentTypeSchema } from '../types/notebook.type';
import { toIso } from './document.service';

type NotebookRow = Pick<
  DocumentItem,
  | 'content'
  | 'createdAt'
  | 'description'
  | 'fileType'
  | 'id'
  | 'metadata'
  | 'title'
  | 'totalCharCount'
  | 'totalLineCount'
  | 'updatedAt'
>;

const toNotebookDocument = (row: NotebookRow): NotebookDocumentResponse => ({
  content: row.content ?? null,
  createdAt: toIso(row.createdAt),
  description: row.description ?? null,
  fileType: row.fileType,
  id: row.id,
  metadata: row.metadata ?? null,
  title: row.title ?? null,
  totalCharCount: row.totalCharCount,
  totalLineCount: row.totalLineCount,
  updatedAt: toIso(row.updatedAt),
});

/**
 * Topic notebook REST service.
 *
 * A topic's notebook is the set of documents attached to it — what an agent
 * writes with the notebook tool. Writes go through the `notebook` tRPC
 * procedures (called server-side) so REST shares their de-duplication of
 * verbatim twins, per-plan length limit and General Access guards. Topics are
 * resolved with the caller's scope and documents through the document reader,
 * so a topic or document in another account or workspace, or in a library the
 * caller may not browse, reads as missing instead of silently accepting writes.
 */
export class NotebookRestService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string };

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId };
  }

  private get notebook() {
    return notebookRouter.createCaller(this.ctx);
  }

  private async requireTopic(topicId: string) {
    const topic = await new TopicModel(this.db, this.userId, this.workspaceId).findById(topicId);
    if (!topic) throw this.createNotFoundError('Topic not found');
    return topic;
  }

  /**
   * A document in one of the caller's topic notebooks. Read through the document
   * reader so visibility, General Access and restricted libraries apply exactly
   * as on `/documents/{id}`; a document in no notebook is not addressable here.
   */
  private async requireDocument(id: string) {
    const document = await documentRouter.createCaller(this.ctx).getDocumentById({ id });
    const topicIds = document
      ? await new TopicDocumentModel(this.db, this.userId, this.workspaceId).findByDocumentId(id)
      : [];
    if (!document || topicIds.length === 0) {
      throw this.createNotFoundError('Notebook document not found');
    }
    return document as DocumentItem;
  }

  async listDocuments(query: NotebookListQuery) {
    await this.requireTopic(query.topicId);
    const { limit, offset } = resolvePagination(query);
    const { data, total } = await this.notebook.listDocuments({
      topicId: query.topicId,
      type: query.type,
    });

    return {
      items: data.slice(offset, offset + limit).map((document) => ({
        ...toNotebookDocument(document as NotebookRow),
        associatedAt: toIso(document.associatedAt),
      })),
      total,
    };
  }

  async getDocument(id: string) {
    return toNotebookDocument(await this.requireDocument(id));
  }

  async createDocument(body: CreateNotebookDocumentRequest) {
    await this.requireTopic(body.topicId);
    const document = await this.notebook.createDocument(body);
    return toNotebookDocument(document);
  }

  /**
   * A notebook note, not a Page attached to the notebook. The notebook write
   * stores Markdown only (a page's editor state and live room would go stale),
   * and the notebook delete removes the document itself, which for an attached
   * page would destroy it in every other place it is used.
   */
  private async requireNote(id: string, action: 'delete' | 'update') {
    const document = await this.requireDocument(id);
    if (!NotebookDocumentTypeSchema.safeParse(document.fileType).success) {
      throw new ApiException(
        422,
        'unprocessable_entity',
        `This document is a page attached to a notebook, not a notebook note; ${action} it through /api/v1/documents/{id}`,
      );
    }
    return document;
  }

  async updateDocument(id: string, body: UpdateNotebookDocumentRequest) {
    await this.requireNote(id, 'update');
    const document = await this.notebook.updateDocument({ ...body, id });
    if (!document) throw this.createNotFoundError('Notebook document not found');
    return toNotebookDocument(document);
  }

  async deleteDocument(id: string): Promise<DeletedResource> {
    await this.requireNote(id, 'delete');
    await this.notebook.deleteDocument({ id });
    return { deleted: true, id };
  }

  async associateDocument(body: AssociateNotebookDocumentRequest) {
    await this.requireTopic(body.topicId);
    return this.notebook.associateDocument(body);
  }
}
