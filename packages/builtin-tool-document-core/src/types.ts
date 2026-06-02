export interface DocumentRecord {
  content?: string;
  documentId?: string;
  filename?: string;
  id: string;
  litexml?: string;
  title?: string;
}

export type DocumentReadFormat = 'xml' | 'markdown' | 'both';

export interface DocumentToolContext {
  messageId: string;
  operationId?: string;
  taskId?: string | null;
  toolCallId: string;
  topicId?: string;
}

export interface DocumentToolTriggerInput {
  toolContext?: DocumentToolContext;
  trigger?: 'tool';
}

export interface DocumentTriggerContext {
  messageId?: string | null;
  operationId?: string | null;
  taskId?: string | null;
  toolCallId?: string | null;
  topicId?: string | null;
}

export type ModifyDocumentInsertOperation =
  | {
      action: 'insert';
      afterId: string;
      litexml: string;
    }
  | {
      action: 'insert';
      beforeId: string;
      litexml: string;
    };

export interface ModifyDocumentUpdateOperation {
  action: 'modify';
  litexml: string | string[];
}

export interface ModifyDocumentRemoveOperation {
  action: 'remove';
  id: string;
}

export type ModifyDocumentOperation =
  | ModifyDocumentInsertOperation
  | ModifyDocumentRemoveOperation
  | ModifyDocumentUpdateOperation;

export interface DocumentRuntimeCreateParams {
  content: string;
  title: string;
}

export interface DocumentRuntimeReadParams {
  format?: DocumentReadFormat;
  id: string;
}

export interface DocumentRuntimeReplaceContentParams {
  content: string;
  id: string;
}

export interface DocumentRuntimeModifyNodesParams {
  id: string;
  operations: ModifyDocumentOperation[];
}

export interface DocumentRuntimeService {
  createDocument: (
    params: DocumentRuntimeCreateParams & DocumentToolTriggerInput,
  ) => Promise<DocumentRecord | undefined>;
  listDocuments: () => Promise<DocumentRecord[]>;
  modifyNodes: (params: DocumentRuntimeModifyNodesParams) => Promise<DocumentRecord | undefined>;
  readDocument: (params: DocumentRuntimeReadParams) => Promise<DocumentRecord | undefined>;
  replaceContent: (
    params: DocumentRuntimeReplaceContentParams,
  ) => Promise<DocumentRecord | undefined>;
}
