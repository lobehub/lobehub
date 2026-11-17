import { AsyncTaskStatus } from '@lobechat/types';
import { z } from 'zod';

import { dateTimeSchema } from './common.type';

/** The largest result set a single search returns. */
export const MAX_SEARCH_TOP_K = 50;

/** Files one `POST /files/search` call may search across. */
export const MAX_SEARCH_FILE_IDS = 100;

const querySchema = z
  .string()
  .trim()
  .min(1, 'query cannot be empty')
  .max(8000)
  .describe('Natural-language query; it is embedded and matched against chunk vectors.');

const topKSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_SEARCH_TOP_K)
  .optional()
  .describe('Maximum number of chunks (and documents) to return. Defaults to 20.');

// ==================== Requests ====================

/** `POST /knowledge-bases/{id}/search` */
export const KnowledgeBaseSearchRequestSchema = z
  .object({ query: querySchema, topK: topKSchema })
  .strict()
  .meta({ id: 'KnowledgeBaseSearchRequest' });
export type KnowledgeBaseSearchRequest = z.infer<typeof KnowledgeBaseSearchRequestSchema>;

/** `POST /files/search` */
export const FileSearchRequestSchema = z
  .object({
    fileIds: z
      .array(z.string().min(1))
      .min(1, 'fileIds must list at least one file')
      .max(MAX_SEARCH_FILE_IDS)
      .describe('The files to search; every one must be visible to the caller.'),
    query: querySchema,
    topK: topKSchema,
  })
  .strict()
  .meta({ id: 'FileSearchRequest' });
export type FileSearchRequest = z.infer<typeof FileSearchRequestSchema>;

// ==================== Responses ====================

/** One matching chunk: its text, cosine similarity and the file it came from. */
export const SearchChunkSchema = z
  .object({
    fileId: z.string().nullable().describe('The source file.'),
    fileName: z.string().nullable(),
    id: z.string().describe('Chunk id.'),
    index: z.number().int().nullable().describe('Position of the chunk inside its file.'),
    similarity: z.number().describe('Cosine similarity to the query, 0–1 (higher is closer).'),
    text: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'SearchChunk' });

/** Chunks grouped by source file, best file first. */
export const SearchFileResultSchema = z
  .object({
    fileId: z.string(),
    fileName: z.string(),
    relevanceScore: z.number().describe('Mean similarity of the file’s top three chunks.'),
    topChunks: z.array(
      z.object({ id: z.string(), similarity: z.number(), text: z.string() }).strict(),
    ),
  })
  .strict()
  .meta({ id: 'SearchFileResult' });

/** A full-text (BM25) hit on a document stored inside the knowledge base. */
export const SearchDocumentHitSchema = z
  .object({
    documentId: z.string(),
    fileId: z.string().nullable(),
    knowledgeBaseId: z.string(),
    relevance: z.number(),
    snippet: z.string(),
    title: z.string(),
    updatedAt: dateTimeSchema,
  })
  .strict()
  .meta({ id: 'SearchDocumentHit' });

/** Result of a semantic search over files. */
export const FileSearchResultSchema = z
  .object({
    chunks: z.array(SearchChunkSchema).describe('Matching chunks, most similar first.'),
    files: z.array(SearchFileResultSchema).describe('The same chunks grouped by source file.'),
    total: z.number().int().describe('Number of chunks returned.'),
  })
  .strict()
  .meta({ id: 'FileSearchResult' });
export type FileSearchResult = z.infer<typeof FileSearchResultSchema>;

/**
 * Result of a knowledge-base search: vector matches over the base's files plus
 * full-text matches over the documents written directly into it.
 */
export const KnowledgeBaseSearchResultSchema = FileSearchResultSchema.extend({
  documents: z
    .array(SearchDocumentHitSchema)
    .describe('Full-text matches on documents stored in the knowledge base.'),
  total: z.number().int().describe('Chunks plus documents returned.'),
})
  .strict()
  .meta({ id: 'KnowledgeBaseSearchResult' });
export type KnowledgeBaseSearchResult = z.infer<typeof KnowledgeBaseSearchResultSchema>;

/** An async file-processing task that was just queued. */
export const FileTaskAcceptedSchema = z
  .object({
    fileId: z.string(),
    status: z.enum(AsyncTaskStatus).describe('Initial task status; poll `GET /files/{id}/chunks`.'),
    taskId: z.string().describe('Async task id.'),
  })
  .strict()
  .meta({ id: 'FileTaskAccepted' });
export type FileTaskAccepted = z.infer<typeof FileTaskAcceptedSchema>;
