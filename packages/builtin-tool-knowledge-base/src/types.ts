import type { ChatSemanticSearchChunk, FileSearchResult } from '@lobechat/types';

export const KnowledgeBaseIdentifier = 'lobe-knowledge-base';

export const KnowledgeBaseApiName = {
  readKnowledge: 'readKnowledge',
  searchKnowledgeBase: 'searchKnowledgeBase',
};

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
