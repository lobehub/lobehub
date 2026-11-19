import { z } from 'zod';

import type { ChatSemanticSearchChunk } from './chunk';

export const SemanticSearchSchema = z.object({
  fileIds: z.array(z.string()).optional(),
  knowledgeIds: z.array(z.string()).optional(),
  query: z.string(),
  topK: z.number().optional(),
});

export type SemanticSearchSchemaType = z.infer<typeof SemanticSearchSchema>;

export type MessageSemanticSearchChunk = Pick<ChatSemanticSearchChunk, 'id' | 'similarity'>;

/**
 * What a knowledge-base search could actually read, reported when it matched nothing, so "no item
 * matches" can be told apart from "the items were never searchable". Counts only items the caller
 * may see.
 */
export interface KnowledgeBaseSearchIndexStatus {
  /** Uploaded files with embedded chunks: reachable by meaning (vector search). */
  embeddedFiles: number;
  /** Pages and parsed files without embeddings: reachable by keyword (full-text) search only. */
  keywordOnlyItems: number;
  /** Uploaded files with neither embeddings nor parsed text: invisible to both search paths. */
  unindexedFiles: number;
  /** A few of the unindexed files, so the caller can read them directly. */
  unindexedFileSamples: { id: string; name: string }[];
}

export interface FileSearchResult {
  fileId: string;
  fileName: string;
  relevanceScore: number;
  topChunks: Array<{
    id: string;
    similarity: number;
    text: string;
  }>;
}
