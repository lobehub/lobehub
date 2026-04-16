import { type DocumentItem } from '@lobechat/database/schemas';

import { lambdaClient } from '@/libs/trpc/client';
import type {
  CompareHistoryItemsInput,
  CompareHistoryItemsOutput,
  GetHistoryItemInput,
  GetHistoryItemOutput,
  ListHistoryInput,
  ListHistoryOutput,
  SaveDocumentHistoryInput,
  SaveDocumentHistoryOutput,
  UpdateDocumentInput,
  UpdateDocumentOutput,
} from '@/server/routers/lambda/_schema/documentHistory';

import { abortableRequest } from '../utils/abortableRequest';

const serializeSavedAt = (savedAt: Date | string) =>
  savedAt instanceof Date ? savedAt.toISOString() : savedAt;

type SerializedSavedAt<T extends { savedAt: Date | string }> = Omit<T, 'savedAt'> & {
  savedAt: string;
};

const serializeHistoryTimestamp = <T extends { savedAt: Date | string }>(
  result: T,
): SerializedSavedAt<T> => ({
  ...result,
  savedAt: serializeSavedAt(result.savedAt),
});

const serializeHistoryList = <
  T extends {
    items: Array<{
      id: string;
      isCurrent: boolean;
      saveSource: ListHistoryOutput['items'][number]['saveSource'];
      savedAt: Date | string;
    }>;
    nextBeforeSavedAt?: Date | string;
  },
>(
  result: T,
): ListHistoryOutput => ({
  ...result,
  items: result.items.map((item) => ({
    ...item,
    savedAt: serializeSavedAt(item.savedAt),
  })),
  nextBeforeSavedAt: result.nextBeforeSavedAt
    ? serializeSavedAt(result.nextBeforeSavedAt)
    : undefined,
});

const serializeHistoryItem = <
  T extends {
    editorData: GetHistoryItemOutput['editorData'];
    id: string;
    isCurrent: boolean;
    saveSource: GetHistoryItemOutput['saveSource'];
    savedAt: Date | string;
  },
>(
  result: T,
): GetHistoryItemOutput => serializeHistoryTimestamp(result);

const serializeHistoryComparison = <
  T extends {
    from: {
      editorData: CompareHistoryItemsOutput['from']['editorData'];
      id: string;
      isCurrent: boolean;
      saveSource: CompareHistoryItemsOutput['from']['saveSource'];
      savedAt: Date | string;
    };
    to: {
      editorData: CompareHistoryItemsOutput['to']['editorData'];
      id: string;
      isCurrent: boolean;
      saveSource: CompareHistoryItemsOutput['to']['saveSource'];
      savedAt: Date | string;
    };
  },
>(
  result: T,
): CompareHistoryItemsOutput => ({
  from: serializeHistoryTimestamp(result.from),
  to: serializeHistoryTimestamp(result.to),
});

export interface CreateDocumentParams {
  content?: string;
  editorData: string;
  fileType?: string;
  knowledgeBaseId?: string;
  metadata?: Record<string, any>;
  parentId?: string;
  slug?: string;
  title: string;
}

export interface ListDocumentHistoryParams extends ListHistoryInput {}

export interface GetDocumentHistoryItemParams extends GetHistoryItemInput {}

export interface CompareDocumentHistoryItemsParams extends CompareHistoryItemsInput {}

export interface UpdateDocumentParams extends UpdateDocumentInput {}

export interface DocumentHistoryClientSurface {
  compareDocumentHistoryItems: (
    params: CompareDocumentHistoryItemsParams,
  ) => Promise<CompareHistoryItemsOutput>;
  getDocumentHistoryItem: (
    params: GetDocumentHistoryItemParams,
    uniqueKey?: string,
  ) => Promise<GetHistoryItemOutput>;
  listDocumentHistory: (params: ListDocumentHistoryParams) => Promise<ListHistoryOutput>;
  saveDocumentHistory: (params: SaveDocumentHistoryInput) => Promise<SaveDocumentHistoryOutput>;
  updateDocument: (params: UpdateDocumentParams) => Promise<UpdateDocumentOutput>;
}

export class DocumentService {
  async createDocument(params: CreateDocumentParams): Promise<DocumentItem> {
    return lambdaClient.document.createDocument.mutate(params);
  }

  async createDocuments(documents: CreateDocumentParams[]): Promise<DocumentItem[]> {
    return lambdaClient.document.createDocuments.mutate({ documents });
  }

  async queryDocuments(params?: {
    current?: number;
    fileTypes?: string[];
    pageSize?: number;
    sourceTypes?: string[];
  }): Promise<{ items: DocumentItem[]; total: number }> {
    return lambdaClient.document.queryDocuments.query(params);
  }

  async listDocumentHistory(params: ListDocumentHistoryParams): Promise<ListHistoryOutput> {
    const result = await lambdaClient.document.listDocumentHistory.query(params);

    return serializeHistoryList(result);
  }

  async getDocumentHistoryItem(
    params: GetDocumentHistoryItemParams,
    uniqueKey?: string,
  ): Promise<GetHistoryItemOutput> {
    if (uniqueKey) {
      return abortableRequest.execute(uniqueKey, async (signal) => {
        const result = await lambdaClient.document.getDocumentHistoryItem.query(params, {
          signal,
        });

        return serializeHistoryItem(result);
      });
    }

    const result = await lambdaClient.document.getDocumentHistoryItem.query(params);

    return serializeHistoryItem(result);
  }

  async compareDocumentHistoryItems(
    params: CompareDocumentHistoryItemsParams,
  ): Promise<CompareHistoryItemsOutput> {
    const result = await lambdaClient.document.compareDocumentHistoryItems.query(params);

    return serializeHistoryComparison(result);
  }

  async getPageDocuments(pageSize: number = 20): Promise<DocumentItem[]> {
    const result = await this.queryDocuments({
      current: 0,
      fileTypes: ['custom/document', 'application/pdf'],
      pageSize,
      sourceTypes: ['editor', 'file', 'api'],
    });

    return result.items
      .filter(
        (doc) =>
          ['editor', 'file', 'api'].includes(doc.sourceType) &&
          ['custom/document', 'application/pdf'].includes(doc.fileType),
      )
      .map((doc) => ({ ...doc, filename: doc.filename ?? doc.title ?? 'Untitled' }));
  }

  async getDocumentById(id: string, uniqueKey?: string): Promise<DocumentItem | undefined> {
    if (uniqueKey) {
      // Use fixed key so switching documents cancels the previous request
      // This prevents race conditions where old document's data overwrites new document's editor
      return abortableRequest.execute(uniqueKey, async (signal) =>
        lambdaClient.document.getDocumentById.query({ id }, { signal }),
      );
    }

    return lambdaClient.document.getDocumentById.query({ id });
  }

  async deleteDocument(id: string): Promise<void> {
    await lambdaClient.document.deleteDocument.mutate({ id });
  }

  async deleteDocuments(ids: string[]): Promise<void> {
    await lambdaClient.document.deleteDocuments.mutate({ ids });
  }

  async updateDocument(params: UpdateDocumentParams): Promise<UpdateDocumentOutput> {
    const result = await lambdaClient.document.updateDocument.mutate(params);

    return {
      ...result,
      savedAt: result.savedAt
        ? result.savedAt instanceof Date
          ? result.savedAt.toISOString()
          : result.savedAt
        : undefined,
    };
  }

  async saveDocumentHistory(params: SaveDocumentHistoryInput): Promise<SaveDocumentHistoryOutput> {
    const result = await lambdaClient.document.saveDocumentHistory.mutate(params);

    return {
      savedAt: result.savedAt instanceof Date ? result.savedAt.toISOString() : result.savedAt,
    };
  }
}

export const documentService = new DocumentService() as DocumentService &
  DocumentHistoryClientSurface;
