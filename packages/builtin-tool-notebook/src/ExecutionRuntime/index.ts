import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  CreateDocumentArgs,
  CreateDocumentState,
  DeleteDocumentArgs,
  DeleteDocumentState,
  DocumentType,
  GetDocumentArgs,
  GetDocumentState,
  NotebookDocument,
  UpdateDocumentArgs,
  UpdateDocumentState,
} from '../types';

interface DocumentServiceResult {
  content: string | null;
  createdAt: Date;
  description: string | null;
  fileType: string;
  id: string;
  source: string;
  sourceType: 'api' | 'file' | 'web';
  title: string | null;
  totalCharCount: number;
  updatedAt: Date;
}

interface NotebookService {
  /**
   * Associate a document with a topic
   */
  associateDocumentWithTopic: (documentId: string, topicId: string) => Promise<void>;

  /**
   * Create a new document
   */
  createDocument: (params: {
    content: string;
    fileType: string;
    source: string;
    sourceType: 'api' | 'file' | 'web';
    title: string;
    totalCharCount: number;
    totalLineCount: number;
  }) => Promise<DocumentServiceResult>;

  /**
   * Delete a document by ID
   */
  deleteDocument: (id: string) => Promise<void>;

  /**
   * Get a document by ID
   */
  getDocument: (id: string) => Promise<DocumentServiceResult | undefined>;

  /**
   * Get documents by topic ID
   */
  getDocumentsByTopicId: (
    topicId: string,
    filter?: { type?: string },
  ) => Promise<DocumentServiceResult[]>;

  /**
   * Update a document by ID
   */
  updateDocument: (
    id: string,
    params: { content?: string; title?: string },
  ) => Promise<DocumentServiceResult>;
}

/**
 * Transform database document to NotebookDocument format
 */
const toNotebookDocument = (doc: DocumentServiceResult): NotebookDocument => {
  return {
    content: doc.content || '',
    createdAt: doc.createdAt.toISOString(),
    description: doc.description || '',
    id: doc.id,
    sourceType: doc.sourceType === 'api' ? 'ai' : doc.sourceType,
    title: doc.title || 'Untitled',
    type: (doc.fileType as DocumentType) || 'markdown',
    updatedAt: doc.updatedAt.toISOString(),
    wordCount: doc.totalCharCount,
  };
};

/**
 * Count words in content (simple implementation)
 */
const countWords = (content: string): number => {
  return content.trim().split(/\s+/).filter(Boolean).length;
};

/**
 * Count lines in content
 */
const countLines = (content: string): number => {
  return content.split('\n').length;
};

export class NotebookExecutionRuntime {
  private notebookService: NotebookService;

  constructor(notebookService: NotebookService) {
    this.notebookService = notebookService;
  }

  /**
   * Create a new document in the notebook
   */
  async createDocument(
    args: CreateDocumentArgs,
    options?: { topicId?: string | null },
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { title, content, type = 'markdown' } = args;

      if (!options?.topicId) {
        return {
          content: 'Error: No topic context. Documents must be created within a topic.',
          success: false,
        };
      }

      // Create document
      const doc = await this.notebookService.createDocument({
        content,
        fileType: type,
        source: `notebook:${options.topicId}`,
        sourceType: 'api',
        title,
        totalCharCount: countWords(content),
        totalLineCount: countLines(content),
      });

      // Associate with topic
      await this.notebookService.associateDocumentWithTopic(doc.id, options.topicId);

      const notebookDoc = toNotebookDocument(doc);
      const state: CreateDocumentState = { document: notebookDoc };

      return {
        content: `📄 Created document: "${title}"\n\nYou can view and edit this document in the Portal sidebar.`,
        state,
        success: true,
      };
    } catch (e) {
      return {
        content: `Error creating document: ${(e as Error).message}`,
        error: e,
        success: false,
      };
    }
  }

  /**
   * Update an existing document
   */
  async updateDocument(args: UpdateDocumentArgs): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { id, title, content, append } = args;

      // Get existing document
      const existingDoc = await this.notebookService.getDocument(id);
      if (!existingDoc) {
        return {
          content: `Error: Document not found: ${id}`,
          success: false,
        };
      }

      // Prepare update data
      const updateData: { content?: string; title?: string } = {};

      if (title !== undefined) {
        updateData.title = title;
      }

      if (content !== undefined) {
        if (append && existingDoc.content) {
          updateData.content = existingDoc.content + '\n\n' + content;
        } else {
          updateData.content = content;
        }
      }

      const updatedDoc = await this.notebookService.updateDocument(id, updateData);
      const notebookDoc = toNotebookDocument(updatedDoc);
      const state: UpdateDocumentState = { document: notebookDoc };

      const actionDesc = append ? 'Appended to' : 'Updated';

      return {
        content: `📝 ${actionDesc} document: "${notebookDoc.title}"`,
        state,
        success: true,
      };
    } catch (e) {
      return {
        content: `Error updating document: ${(e as Error).message}`,
        error: e,
        success: false,
      };
    }
  }

  /**
   * Get a document by ID
   */
  async getDocument(args: GetDocumentArgs): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { id } = args;

      const doc = await this.notebookService.getDocument(id);
      if (!doc) {
        return {
          content: `Error: Document not found: ${id}`,
          success: false,
        };
      }

      const notebookDoc = toNotebookDocument(doc);
      const state: GetDocumentState = { document: notebookDoc };

      return {
        content: `📄 Document: "${notebookDoc.title}"\n\n${notebookDoc.content}`,
        state,
        success: true,
      };
    } catch (e) {
      return {
        content: `Error retrieving document: ${(e as Error).message}`,
        error: e,
        success: false,
      };
    }
  }

  /**
   * Delete a document from the notebook
   */
  async deleteDocument(args: DeleteDocumentArgs): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { id } = args;

      // Verify document exists
      const doc = await this.notebookService.getDocument(id);
      if (!doc) {
        return {
          content: `Error: Document not found: ${id}`,
          success: false,
        };
      }

      await this.notebookService.deleteDocument(id);
      const state: DeleteDocumentState = { deletedId: id };

      return {
        content: `🗑️ Deleted document: "${doc.title}"`,
        state,
        success: true,
      };
    } catch (e) {
      return {
        content: `Error deleting document: ${(e as Error).message}`,
        error: e,
        success: false,
      };
    }
  }
}
