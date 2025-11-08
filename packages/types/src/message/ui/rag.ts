import { z } from 'zod';

import { MessageSemanticSearchChunk } from '../../rag';

export interface ChatFileChunk {
  fileId: string;
  fileType: string;
  fileUrl: string;
  filename: string;
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
