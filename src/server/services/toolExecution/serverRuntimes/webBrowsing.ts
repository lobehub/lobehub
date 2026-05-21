import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { WebBrowsingExecutionRuntime } from '@lobechat/builtin-tool-web-browsing/executionRuntime';

import { DocumentModel } from '@/database/models/document';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { createMarkdownEditorSnapshot } from '@/server/services/agentDocuments/headlessEditor';
import { DocumentService } from '@/server/services/document';
import { SearchService } from '@/server/services/search';

import { type ServerRuntimeRegistration } from './types';

interface UpsertWebDocumentParams {
  content: string;
  description?: string;
  title: string;
  url: string;
}

/**
 * Persist a crawled web page as a `documents` row, deduping by URL.
 *
 * LOBE-9384: repeated crawls of the same URL (e.g. nightly review re-ingesting
 * the same PR list) used to insert a fresh document row every pass, bloating
 * storage and the agent's progressive index. Now:
 *
 *  - First crawl creates the row with an `editorData` snapshot derived from the
 *    markdown content, so subsequent diffs have something to compare against.
 *  - Repeat crawls hand off to `DocumentService.updateDocument`, which writes a
 *    `document_histories` row when `editorData` differs and bumps `updatedAt`
 *    either way — users get a real revision trail of each crawl.
 *
 * Exported for unit tests; runtime callers go through `webBrowsingRuntime`.
 */
export const upsertWebDocument = async (
  documentModel: DocumentModel,
  documentService: DocumentService,
  { content, description, title, url }: UpsertWebDocumentParams,
): Promise<{ id: string }> => {
  const snapshot = await createMarkdownEditorSnapshot(content);

  const existing = await documentModel.findBySource(url, 'web');
  if (existing) {
    await documentService.updateDocument(existing.id, {
      content: snapshot.content,
      editorData: snapshot.editorData,
      saveSource: 'llm_call',
      title,
    });
    return { id: existing.id };
  }

  return documentModel.create({
    content: snapshot.content,
    description,
    editorData: snapshot.editorData,
    fileType: 'article',
    filename: title,
    source: url,
    sourceType: 'web',
    title,
    totalCharCount: snapshot.content.length,
    totalLineCount: snapshot.content.split('\n').length,
  });
};

export const webBrowsingRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    const { userId, serverDB, agentId } = context;
    const canSaveDocuments = userId && serverDB && agentId;

    return new WebBrowsingExecutionRuntime({
      documentService: canSaveDocuments
        ? {
            associateDocument: async (documentId) => {
              const service = new AgentDocumentsService(serverDB, userId);
              await service.associateDocument(agentId, documentId);
            },
            createDocument: async (params) =>
              upsertWebDocument(
                new DocumentModel(serverDB, userId),
                new DocumentService(serverDB, userId),
                params,
              ),
          }
        : undefined,
      searchService: new SearchService(),
    });
  },
  identifier: WebBrowsingManifest.identifier,
};
