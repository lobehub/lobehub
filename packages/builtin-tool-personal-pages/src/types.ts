import type {
  DocumentRuntimeService,
  ModifyDocumentOperation,
} from '@lobechat/builtin-tool-document-core';

export type { DocumentRecord } from '@lobechat/builtin-tool-document-core';

export const PersonalPagesIdentifier = 'lobe-personal-pages';

export const PersonalPagesApiName = {
  createPage: 'createPage',
  listPages: 'listPages',
  modifyNodes: 'modifyNodes',
  readPage: 'readPage',
  replaceContent: 'replaceContent',
} as const;

export interface CreatePageArgs {
  content: string;
  title: string;
}

export interface CreatePageState {
  pageId: string;
}

export interface ReadPageArgs {
  format?: 'xml' | 'markdown' | 'both';
  id: string;
}

export interface ReadPageState {
  content?: string;
  id: string;
  title?: string;
  xml?: string;
}

export interface ReplaceContentArgs {
  content: string;
  id: string;
}

export interface ReplaceContentState {
  id: string;
  updated: boolean;
}

export type {
  ModifyDocumentInsertOperation,
  ModifyDocumentOperation,
  ModifyDocumentRemoveOperation,
  ModifyDocumentUpdateOperation,
} from '@lobechat/builtin-tool-document-core';

export interface ModifyNodesArgs {
  id: string;
  operations: ModifyDocumentOperation[];
}

export interface ModifyNodesState {
  id: string;
  results: Array<{
    action: 'insert' | 'remove' | 'modify';
    success: boolean;
  }>;
  successCount: number;
  totalCount: number;
}

export interface ListPagesArgs {}

export interface ListPagesState {
  documents: { documentId?: string; filename: string; id: string; title?: string }[];
}

export interface PersonalPagesRuntimeService extends DocumentRuntimeService {}
