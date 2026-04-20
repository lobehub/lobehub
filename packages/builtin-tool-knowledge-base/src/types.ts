import type { ChatSemanticSearchChunk, FileSearchResult } from '@lobechat/types';

export const KnowledgeBaseIdentifier = 'lobe-knowledge-base';

export const KnowledgeBaseApiName = {
  addFiles: 'addFiles',
  createDocument: 'createDocument',
  createKnowledgeBase: 'createKnowledgeBase',
  deleteKnowledgeBase: 'deleteKnowledgeBase',
  getFileDetail: 'getFileDetail',
  listFiles: 'listFiles',
  listKnowledgeBases: 'listKnowledgeBases',
  readKnowledge: 'readKnowledge',
  removeFiles: 'removeFiles',
  searchKnowledgeBase: 'searchKnowledgeBase',
  viewKnowledgeBase: 'viewKnowledgeBase',
};

// ============ Search & Read ============

export interface SearchKnowledgeBaseArgs {
  query: string;
  topK?: number;
}
export interface SearchKnowledgeBaseState {
  chunks: ChatSemanticSearchChunk[];
  fileResults: FileSearchResult[];
  totalResults: number;
}

export interface ReadKnowledgeArgs {
  fileIds: string[];
}

export interface FileContentDetail {
  error?: string;
  fileId: string;
  filename: string;
  preview?: string;
  totalCharCount?: number;
  totalLineCount?: number;
}

export interface ReadKnowledgeState {
  files: FileContentDetail[];
}

// ============ P0: Knowledge Base Visibility ============

export interface ListKnowledgeBasesArgs {}

export interface KnowledgeBaseInfo {
  avatar: string | null;
  description?: string | null;
  id: string;
  name: string;
  updatedAt: Date;
}

export interface ListKnowledgeBasesState {
  knowledgeBases: KnowledgeBaseInfo[];
  total: number;
}

export interface ViewKnowledgeBaseArgs {
  id: string;
  limit?: number;
  offset?: number;
}

export interface KnowledgeBaseFileInfo {
  fileType: string;
  id: string;
  name: string;
  size: number;
  sourceType: string;
  updatedAt: Date;
}

export interface ViewKnowledgeBaseState {
  files: KnowledgeBaseFileInfo[];
  hasMore: boolean;
  knowledgeBase: KnowledgeBaseInfo;
  total: number;
}

// ============ P1: Knowledge Base Management ============

export interface CreateKnowledgeBaseArgs {
  description?: string;
  name: string;
}

export interface CreateKnowledgeBaseState {
  id: string;
}

export interface DeleteKnowledgeBaseArgs {
  id: string;
}

export interface CreateDocumentArgs {
  content: string;
  knowledgeBaseId: string;
  parentId?: string;
  title: string;
}

export interface CreateDocumentState {
  id: string;
}

export interface AddFilesArgs {
  fileIds: string[];
  knowledgeBaseId: string;
}

export interface RemoveFilesArgs {
  fileIds: string[];
  knowledgeBaseId: string;
}

// ============ Resource Library Files ============

export interface ListFilesArgs {
  category?: string;
  limit?: number;
  offset?: number;
  q?: string;
}

export interface FileInfo {
  createdAt: Date;
  fileType: string;
  id: string;
  name: string;
  size: number;
  sourceType: string;
  url: string;
}

export interface ListFilesState {
  files: FileInfo[];
  hasMore: boolean;
  total: number;
}

export interface GetFileDetailArgs {
  id: string;
}

export interface FileDetail {
  createdAt: Date;
  fileType: string;
  id: string;
  metadata?: Record<string, any> | null;
  name: string;
  size: number;
  sourceType: string;
  updatedAt: Date;
  url: string;
}

export interface GetFileDetailState {
  file: FileDetail;
}
