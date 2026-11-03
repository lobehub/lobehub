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
