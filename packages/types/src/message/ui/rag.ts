import { z } from 'zod';

import type { MessageSemanticSearchChunk } from '../../rag';

export interface ChatFileChunk {
  fileId: string;
  filename: string;
  fileType: string;
  fileUrl: string;
  id: string;
  similarity?: number;
  text: string;
}

export const SemanticSearchChunkSchema = z.object({
  id: z.string(),
  similarity: z.number(),
});

export interface UpdateMessageRAGParams {
  fileChunks: MessageSemanticSearchChunk[];
  ragQueryId?: string;
}

export const UpdateMessageRAGParamsSchema = z.object({
  id: z.string(),
  value: z.object({
    fileChunks: z.array(SemanticSearchChunkSchema),
    ragQueryId: z.string().optional(),
  }),
});
