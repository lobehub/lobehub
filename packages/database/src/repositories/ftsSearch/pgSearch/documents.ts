import { and, desc, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';

import { DOCUMENT_FOLDER_TYPE, documents, knowledgeBaseFiles } from '../../../schemas';
import { buildWorkspaceWhere } from '../../../utils/workspace';
import type {
  FtsSearchBackendResponse,
  FtsSearchFolderResult,
  FtsSearchKnowledgeBaseDocumentHit,
  FtsSearchPageResult,
} from '../types';
import type { PgFtsSearchField } from './dialect';
import { buildResponse, truncate } from './results';
import type { PgSearchFtsSearchContext } from './scope';

const FOLDER_FIELDS: PgFtsSearchField[] = [
  { column: documents.title, weight: 4 },
  { column: documents.slug, weight: 3 },
  { column: documents.description, weight: 2 },
];

const PAGE_FIELDS: PgFtsSearchField[] = [
  { column: documents.title, weight: 4 },
  { column: documents.slug, weight: 3 },
  { column: documents.content },
];

const KNOWLEDGE_BASE_DOCUMENT_FIELDS = PAGE_FIELDS;

/** Search folders (documents with `file_type=DOCUMENT_FOLDER_TYPE`). */
export async function searchFolders(
  context: PgSearchFtsSearchContext,
  query: string,
  limit: number,
  excludeKbIds?: string[],
): Promise<FtsSearchBackendResponse<FtsSearchFolderResult>> {
  const { db, dialect } = context;
  const preparedQuery = dialect.prepare(query);
  const score = dialect.score(documents.id, FOLDER_FIELDS, preparedQuery);

  const hits = db
    .select({
      createdAt: documents.createdAt,
      description: documents.description,
      filename: documents.filename,
      id: documents.id,
      knowledgeBaseId: documents.knowledgeBaseId,
      score: score.as('score'),
      slug: documents.slug,
      title: documents.title,
      updatedAt: documents.updatedAt,
      workspaceId: documents.workspaceId,
    })
    .from(documents)
    .where(
      and(
        context.scanScopeWhere(documents),
        eq(documents.fileType, DOCUMENT_FOLDER_TYPE),
        dialect.match(FOLDER_FIELDS, preparedQuery),
      ),
    )
    .orderBy(sql`${score} DESC`)
    .limit(context.scanCandidateLimit(limit))
    .as('folder_hits');

  const rows = await db
    .select({
      createdAt: hits.createdAt,
      description: hits.description,
      filename: hits.filename,
      id: hits.id,
      knowledgeBaseId: hits.knowledgeBaseId,
      score: hits.score,
      slug: hits.slug,
      title: hits.title,
      updatedAt: hits.updatedAt,
    })
    .from(hits)
    .where(
      and(
        context.liftedScopeWhere(hits.workspaceId),
        excludeKbIds && excludeKbIds.length > 0
          ? or(isNull(hits.knowledgeBaseId), notInArray(hits.knowledgeBaseId, excludeKbIds))
          : undefined,
      ),
    )
    .orderBy(desc(hits.score))
    .limit(limit);

  return buildResponse(rows, (row) => {
    const title = row.title || row.filename || 'Untitled';
    return {
      createdAt: row.createdAt,
      description: row.description,
      id: row.id,
      knowledgeBaseId: row.knowledgeBaseId,
      relevance: row.relevance,
      slug: row.slug,
      title,
      type: 'folder' as const,
      updatedAt: row.updatedAt,
    };
  });
}

/** Search pages (documents with `file_type='custom/document'`). */
export async function searchPages(
  context: PgSearchFtsSearchContext,
  query: string,
  limit: number,
  excludeKbIds?: string[],
): Promise<FtsSearchBackendResponse<FtsSearchPageResult>> {
  const { db, dialect } = context;
  const preparedQuery = dialect.prepare(query);
  const score = dialect.score(documents.id, PAGE_FIELDS, preparedQuery);

  const hits = db
    .select({
      createdAt: documents.createdAt,
      fileId: documents.fileId,
      filename: documents.filename,
      id: documents.id,
      knowledgeBaseId: documents.knowledgeBaseId,
      score: score.as('score'),
      title: documents.title,
      updatedAt: documents.updatedAt,
      workspaceId: documents.workspaceId,
    })
    .from(documents)
    .where(
      and(
        context.scanScopeWhere(documents),
        eq(documents.fileType, 'custom/document'),
        dialect.match(PAGE_FIELDS, preparedQuery),
      ),
    )
    .orderBy(sql`${score} DESC`)
    .limit(context.scanCandidateLimit(limit))
    .as('page_hits');

  const rows = await db
    .select({
      createdAt: hits.createdAt,
      filename: hits.filename,
      id: hits.id,
      score: hits.score,
      title: hits.title,
      updatedAt: hits.updatedAt,
    })
    .from(hits)
    .where(
      and(
        context.liftedScopeWhere(hits.workspaceId),
        excludeKbIds && excludeKbIds.length > 0
          ? or(isNull(hits.knowledgeBaseId), notInArray(hits.knowledgeBaseId, excludeKbIds))
          : undefined,
        // Parsed-file pages store KB membership on file_id instead of the
        // document row, so check the join table as well.
        excludeKbIds && excludeKbIds.length > 0
          ? or(
              isNull(hits.fileId),
              notInArray(
                hits.fileId,
                db
                  .select({ fileId: knowledgeBaseFiles.fileId })
                  .from(knowledgeBaseFiles)
                  .where(inArray(knowledgeBaseFiles.knowledgeBaseId, excludeKbIds)),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(hits.score))
    .limit(limit);

  return buildResponse(rows, (row) => {
    const title = row.title || row.filename || 'Untitled';
    return {
      createdAt: row.createdAt,
      description: null,
      id: row.id,
      relevance: row.relevance,
      title,
      type: 'page' as const,
      updatedAt: row.updatedAt,
    };
  });
}

/**
 * FTS search documents belonging to one or more knowledge bases.
 *
 * Inline pages and file-backed documents use separate scoring queries because
 * ParadeDB rejects a disjunctive shape spanning BM25 and non-BM25 predicates.
 */
export async function searchKnowledgeBaseDocuments(
  context: PgSearchFtsSearchContext,
  query: string,
  knowledgeBaseIds: string[],
  limit: number = 20,
): Promise<FtsSearchBackendResponse<FtsSearchKnowledgeBaseDocumentHit>> {
  if (!query || query.trim() === '') return { candidates: [], items: [] };
  if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) {
    return { candidates: [], items: [] };
  }

  const { db, dialect } = context;
  const preparedQuery = dialect.prepare(query);
  const score = dialect.score(documents.id, KNOWLEDGE_BASE_DOCUMENT_FIELDS, preparedQuery);
  const matchClause = dialect.match(KNOWLEDGE_BASE_DOCUMENT_FIELDS, preparedQuery);
  const folderClause = ne(documents.fileType, DOCUMENT_FOLDER_TYPE);
  const userClause = buildWorkspaceWhere(context.scope, documents);

  const inlineRowsPromise = db
    .select({
      content: documents.content,
      fileId: documents.fileId,
      filename: documents.filename,
      id: documents.id,
      knowledgeBaseId: documents.knowledgeBaseId,
      score,
      title: documents.title,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(
      and(
        userClause,
        folderClause,
        inArray(documents.knowledgeBaseId, knowledgeBaseIds),
        matchClause,
      ),
    )
    .orderBy(sql`${score} DESC`)
    .limit(limit);

  const fileBackedRowsPromise = db
    .select({
      content: documents.content,
      fileId: documents.fileId,
      filename: documents.filename,
      id: documents.id,
      knowledgeBaseId: knowledgeBaseFiles.knowledgeBaseId,
      score,
      title: documents.title,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .innerJoin(
      knowledgeBaseFiles,
      and(
        eq(knowledgeBaseFiles.fileId, documents.fileId),
        buildWorkspaceWhere(context.scope, knowledgeBaseFiles),
        inArray(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseIds),
      ),
    )
    .where(and(userClause, folderClause, matchClause))
    .orderBy(sql`${score} DESC`)
    .limit(limit);

  const [inlineRows, fileBackedRows] = await Promise.all([
    inlineRowsPromise,
    fileBackedRowsPromise,
  ]);

  const byId = new Map<string, (typeof inlineRows)[number]>();
  for (const row of [...inlineRows, ...fileBackedRows]) {
    const previous = byId.get(row.id);
    if (!previous || row.score > previous.score) byId.set(row.id, row);
  }
  const merged = Array.from(byId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return buildResponse(merged, (row) => ({
    documentId: row.id,
    fileId: row.fileId ?? undefined,
    knowledgeBaseId: row.knowledgeBaseId ?? '',
    relevance: row.relevance,
    snippet: truncate(row.content, 300) ?? '',
    title: row.title || row.filename || 'Untitled',
    updatedAt: row.updatedAt,
  }));
}
