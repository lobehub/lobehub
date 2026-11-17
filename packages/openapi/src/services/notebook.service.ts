import { TopicModel } from '@/database/models/topic';
import type { DocumentItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { notebookRouter } from '@/server/routers/lambda/notebook';

import { BaseService } from '../common/base.service';
import { resolvePagination } from '../helpers/pagination';
import type { DeletedResource } from '../types/common.type';
import type {
  AssociateNotebookDocumentRequest,
  CreateNotebookDocumentRequest,
  NotebookDocumentResponse,
  NotebookListQuery,
  UpdateNotebookDocumentRequest,
} from '../types/notebook.type';
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
 * verbatim twins, per-plan length limit and General Access guards. The topic
 * itself is resolved first with the caller's scope, so a topic in another
 * account or workspace reads as missing instead of silently accepting writes.
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

  private async requireDocument(id: string) {
    const document = await this.notebook.getDocument({ id });
    if (!document) throw this.createNotFoundError('Notebook document not found');
    return document;
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

  async updateDocument(id: string, body: UpdateNotebookDocumentRequest) {
    await this.requireDocument(id);
    const document = await this.notebook.updateDocument({ ...body, id });
    if (!document) throw this.createNotFoundError('Notebook document not found');
    return toNotebookDocument(document);
  }

  async deleteDocument(id: string): Promise<DeletedResource> {
    await this.requireDocument(id);
    await this.notebook.deleteDocument({ id });
    return { deleted: true, id };
  }

  async associateDocument(body: AssociateNotebookDocumentRequest) {
    await this.requireTopic(body.topicId);
    return this.notebook.associateDocument(body);
  }
}
