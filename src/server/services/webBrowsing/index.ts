import type { LobeChatDatabase } from '@lobechat/database';
import { Md5 } from 'ts-md5';

import { DocumentModel } from '@/database/models/document';
import { createMarkdownEditorSnapshot } from '@/server/services/agentDocuments/headlessEditor';
import { DocumentService } from '@/server/services/document';

export interface UpsertCrawledDocumentParams {
  content: string;
  description?: string;
  title: string;
  url: string;
}

export interface UpsertCrawledDocumentResult {
  id: string;
  /**
   * - `created`: this URL is new for the user; a `documents` row was inserted.
   * - `updated`: the URL existed and the content changed; the row was updated
   *   and a `document_histories` snapshot was written.
   * - `unchanged`: the URL existed with byte-identical content; no write
   *   happened — repeat crawls of the same unchanged page short-circuit.
   */
  status: 'created' | 'updated' | 'unchanged';
}

const hashContent = (content: string): string => Md5.hashStr(content);

/**
 * Single owner of "crawl a web page, persist it as a document" semantics.
 *
 * Both the server agent runtime (`serverRuntimes/webBrowsing.ts`) and the
 * client builtin-tool executor (`store/.../lobe-web-browsing.ts`) route
 * through `upsertCrawledDocument`, so dedupe + content-hash short-circuit +
 * `document_histories` snapshot all live in one place. Splitting these
 * across two call sites previously caused LOBE-9384 (client path created a
 * fresh row every crawl while the server path was being patched to dedupe).
 */
export class WebBrowsingDocumentService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly documentModel: DocumentModel;
  private documentServiceInstance?: DocumentService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.documentModel = new DocumentModel(db, userId);
  }

  private get documentService() {
    this.documentServiceInstance ??= new DocumentService(this.db, this.userId);
    return this.documentServiceInstance;
  }

  upsertCrawledDocument = async (
    params: UpsertCrawledDocumentParams,
  ): Promise<UpsertCrawledDocumentResult> => {
    const { content, description, title, url } = params;

    const existing = await this.documentModel.findBySource(url, 'web');

    if (existing) {
      // Byte-identical content → skip the write entirely. Both `documents`
      // and `document_histories` would only churn `updated_at`, which is
      // not worth the cost (and pollutes the history list with no-op rows).
      if (hashContent(existing.content ?? '') === hashContent(content)) {
        return { id: existing.id, status: 'unchanged' };
      }

      const snapshot = await createMarkdownEditorSnapshot(content);
      // `DocumentService.updateDocument` runs inside a transaction and writes
      // a `document_histories` row when `editorData` differs from the row's
      // current snapshot, so each refresh becomes a real revision.
      await this.documentService.updateDocument(existing.id, {
        content: snapshot.content,
        editorData: snapshot.editorData,
        saveSource: 'llm_call',
        title,
      });
      return { id: existing.id, status: 'updated' };
    }

    const snapshot = await createMarkdownEditorSnapshot(content);
    const created = await this.documentModel.create({
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

    return { id: created.id, status: 'created' };
  };
}
