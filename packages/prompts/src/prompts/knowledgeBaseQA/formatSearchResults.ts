export interface FileSearchResultChunk {
  similarity: number;
  text: string;
}

export interface FileSearchResult {
  fileId: string;
  fileName: string;
  relevanceScore: number;
  topChunks: FileSearchResultChunk[];
}

export interface DocumentSearchResult {
  documentId: string;
  knowledgeBaseId: string;
  relevance: number;
  snippet: string;
  title: string;
}

export interface SearchResultErrors {
  bm25?: string;
  vector?: string;
}

/**
 * Formats a single chunk with XML tags
 */
const formatChunk = (chunk: FileSearchResultChunk, fileId: string, fileName: string): string => {
  return `<chunk fileId="${fileId}" fileName="${fileName}" similarity="${chunk.similarity}">${chunk.text}</chunk>`;
};

/**
 * Formats a single file search result with XML tags
 */
const formatFile = (file: FileSearchResult): string => {
  const chunks = file.topChunks.map((chunk) => formatChunk(chunk, file.fileId, file.fileName));

  return `<file id="${file.fileId}" name="${file.fileName}" relevanceScore="${file.relevanceScore}">
${chunks.join('\n')}
</file>`;
};

/**
 * Formats a single document search result (BM25 hit on custom/document) with XML tags.
 * Documents return only a snippet — agent should call readKnowledge with the docs_* id
 * to fetch the full content.
 */
const formatDocument = (doc: DocumentSearchResult): string => {
  return `<document id="${doc.documentId}" title="${doc.title}" relevance="${doc.relevance}" knowledgeBaseId="${doc.knowledgeBaseId}">
<snippet>${doc.snippet}</snippet>
</document>`;
};

/**
 * Formats knowledge base search results into an XML structure.
 * Two source types:
 *   - <files>: uploaded files matched by semantic vector search (chunk-level)
 *   - <documents>: inline documents matched by full-text search (document-level)
 */
export const formatSearchResults = (
  fileResults: FileSearchResult[],
  query: string,
  documentResults: DocumentSearchResult[] = [],
  errors?: SearchResultErrors,
): string => {
  const totalCount = fileResults.length + documentResults.length;

  const errorNotes: string[] = [];
  if (errors?.vector) {
    errorNotes.push(
      `Note: vector search unavailable (${errors.vector}); only document results returned.`,
    );
  }
  if (errors?.bm25) {
    errorNotes.push(
      `Note: full-text document search unavailable (${errors.bm25}); only file chunk results returned.`,
    );
  }
  const errorNote = errorNotes.length > 0 ? '\n' + errorNotes.join('\n') : '';

  if (totalCount === 0) {
    return `<knowledge_base_search_results query="${query}" totalCount="0">
<instruction>No relevant content found in the knowledge base for this query.${errorNote}</instruction>
</knowledge_base_search_results>`;
  }

  const sections: string[] = [];

  if (fileResults.length > 0) {
    const filesXml = fileResults.map((file) => formatFile(file)).join('\n');
    sections.push(`<files totalCount="${fileResults.length}">
${filesXml}
</files>`);
  }

  if (documentResults.length > 0) {
    const docsXml = documentResults.map((doc) => formatDocument(doc)).join('\n');
    sections.push(`<documents totalCount="${documentResults.length}">
${docsXml}
</documents>`);
  }

  const instruction = `Search results from the knowledge base. ${
    fileResults.length > 0 && documentResults.length > 0
      ? 'Two source types: <files> (vector search, chunk-level) and <documents> (full-text search, document-level). '
      : fileResults.length > 0
        ? 'Source type: <files> (vector search, chunk-level). '
        : 'Source type: <documents> (full-text search, document-level). '
  }Use the readKnowledge tool with the returned IDs (file_* or docs_*) to fetch complete content.${errorNote}`;

  return `<knowledge_base_search_results query="${query}" totalCount="${totalCount}">
<instruction>${instruction}</instruction>
${sections.join('\n')}
</knowledge_base_search_results>`;
};
