import type { SQLWrapper } from 'drizzle-orm';
import { and, desc, eq, inArray, isNotNull, ne, notInArray, sql } from 'drizzle-orm';

import { DOCUMENT_FOLDER_TYPE, documents, files, knowledgeBaseFiles } from '../../../schemas';
import { notAgentShareDocument } from '../../../utils/documentVisibility';
import {
  libraryVisibleFileSource,
  notAgentShareFileReference,
} from '../../../utils/fileVisibility';
import { buildWorkspaceWhere } from '../../../utils/workspace';
import { loadDocumentSnippets } from '../snippet';
import type { FtsSearchBackendResponse, FtsSearchFileResult } from '../types';
import type { PostgresFtsSearchContext } from './context';
import type { PostgresFtsSearchField } from './dialect';
import { buildResponse } from './results';

const FILE_CONTENT_FIELDS: PostgresFtsSearchField[] = [{ column: documents.content }];

// Inline documents without a file and re-parsed duplicates of one file share the
// scored pool, so it is drawn deeper than the number of files returned.
const FILE_CONTENT_CANDIDATE_MULTIPLIER = 4;

export async function searchFileContents(
  context: PostgresFtsSearchContext,
  query: string,
  limit: number,
  excludeKbIds?: string[],
): Promise<FtsSearchBackendResponse<FtsSearchFileResult>> {
  const { db, dialect } = context;
  const preparedQuery = dialect.prepare(query);
  const score = dialect.score(documents.id, FILE_CONTENT_FIELDS, preparedQuery);
  const candidateLimit = limit * FILE_CONTENT_CANDIDATE_MULTIPLIER;
  const excludeKb = (fileId: SQLWrapper) =>
    excludeKbIds && excludeKbIds.length > 0
      ? notInArray(
          fileId,
          db
            .select({ fileId: knowledgeBaseFiles.fileId })
            .from(knowledgeBaseFiles)
            .where(inArray(knowledgeBaseFiles.knowledgeBaseId, excludeKbIds)),
        )
      : undefined;

  const hits = db
    .select({
      fileId: documents.fileId,
      id: documents.id,
      metadata: documents.metadata,
      score: score.as('score'),
      workspaceId: documents.workspaceId,
    })
    .from(documents)
    .where(
      and(
        context.scanScopeWhere(documents),
        eq(documents.sourceType, 'file'),
        ne(documents.fileType, DOCUMENT_FOLDER_TYPE),
        // file_id is not a BM25 field, so ParadeDB keeps it out of its TopN scan.
        context.liftsExclusionFilter
          ? undefined
          : and(isNotNull(documents.fileId), excludeKb(documents.fileId)),
        dialect.match(FILE_CONTENT_FIELDS, preparedQuery),
      ),
    )
    .orderBy(sql`${score} DESC`)
    .limit(context.scanCandidateLimit(candidateLimit))
    .as('file_content_hits');

  const rows = await db
    .select({
      createdAt: files.createdAt,
      documentId: hits.id,
      fileType: files.fileType,
      id: files.id,
      name: files.name,
      score: hits.score,
      size: files.size,
      updatedAt: files.updatedAt,
      url: files.url,
    })
    .from(hits)
    .innerJoin(files, eq(files.id, hits.fileId))
    .where(
      and(
        context.liftedScopeWhere(hits.workspaceId),
        buildWorkspaceWhere(context.scope, files),
        ne(files.fileType, 'custom/document'),
        libraryVisibleFileSource(files.source),
        notAgentShareDocument(hits.metadata),
        notAgentShareFileReference(db, files.id),
        context.liftsExclusionFilter ? excludeKb(files.id) : undefined,
      ),
    )
    .orderBy(desc(hits.score), files.id)
    .limit(candidateLimit);

  const seenFileIds = new Set<string>();
  const fileRows = rows
    .filter(({ id }) => {
      if (seenFileIds.has(id)) return false;
      seenFileIds.add(id);
      return true;
    })
    .slice(0, limit);

  const fileIds = fileRows.map(({ id }) => id);
  const [snippets, knowledgeBaseRows] = await Promise.all([
    loadDocumentSnippets(
      db,
      fileRows.map(({ documentId }) => documentId),
      query,
    ),
    fileIds.length === 0
      ? []
      : db
          .select({
            fileId: knowledgeBaseFiles.fileId,
            knowledgeBaseId: knowledgeBaseFiles.knowledgeBaseId,
          })
          .from(knowledgeBaseFiles)
          .where(inArray(knowledgeBaseFiles.fileId, fileIds))
          .orderBy(knowledgeBaseFiles.knowledgeBaseId),
  ]);
  const knowledgeBaseIdByFile = new Map<string, string>();
  for (const { fileId, knowledgeBaseId } of knowledgeBaseRows) {
    if (!knowledgeBaseIdByFile.has(fileId)) knowledgeBaseIdByFile.set(fileId, knowledgeBaseId);
  }

  return buildResponse(fileRows, (row) => ({
    createdAt: row.createdAt,
    description: snippets.get(row.documentId) ?? null,
    fileType: row.fileType,
    id: row.id,
    knowledgeBaseId: knowledgeBaseIdByFile.get(row.id) ?? null,
    name: row.name,
    relevance: row.relevance,
    size: row.size,
    title: row.name,
    type: 'file' as const,
    updatedAt: row.updatedAt,
    url: row.url,
  }));
}
