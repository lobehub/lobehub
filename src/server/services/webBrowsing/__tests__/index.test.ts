import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WebBrowsingDocumentService } from '../index';

const mocks = vi.hoisted(() => ({
  documentModel: {
    create: vi.fn(),
    findBySource: vi.fn(),
  },
  documentService: {
    updateDocument: vi.fn(),
  },
  topicDocumentModel: {
    associate: vi.fn(),
  },
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(() => mocks.documentModel),
}));

vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn(() => mocks.topicDocumentModel),
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn(() => mocks.documentService),
}));

vi.mock('@/server/services/agentDocuments/headlessEditor', () => ({
  createMarkdownEditorSnapshot: vi.fn(async (content: string) => ({
    content,
    editorData: { root: { fakeNodeFor: content } },
  })),
}));

describe('WebBrowsingDocumentService.upsertCrawledDocument ()', () => {
  let service: WebBrowsingDocumentService;

  beforeEach(() => {
    mocks.documentModel.create.mockReset();
    mocks.documentModel.findBySource.mockReset();
    mocks.documentService.updateDocument.mockReset();
    mocks.topicDocumentModel.associate.mockReset();
    mocks.topicDocumentModel.associate.mockResolvedValue({
      documentId: 'doc',
      topicId: 'topic',
    });

    service = new WebBrowsingDocumentService({} as never, 'user-1');
  });

  it('creates a new document the first time a URL is crawled', async () => {
    mocks.documentModel.findBySource.mockResolvedValueOnce(undefined);
    mocks.documentModel.create.mockResolvedValueOnce({ id: 'doc-1' });

    const result = await service.upsertCrawledDocument({
      content: 'body\nline2',
      description: 'a page',
      title: 'Crawled',
      url: 'https://example.com/a',
    });

    expect(mocks.documentModel.findBySource).toHaveBeenCalledWith('https://example.com/a', 'web');
    expect(mocks.documentService.updateDocument).not.toHaveBeenCalled();
    expect(mocks.documentModel.create).toHaveBeenCalledWith({
      content: 'body\nline2',
      description: 'a page',
      editorData: { root: { fakeNodeFor: 'body\nline2' } },
      fileType: 'article',
      filename: 'Crawled',
      source: 'https://example.com/a',
      sourceType: 'web',
      title: 'Crawled',
      totalCharCount: 10,
      totalLineCount: 2,
    });
    expect(result).toEqual({ id: 'doc-1', status: 'created' });
  });

  // Byte-identical re-crawl must NOT write — neither `documents` nor
  // `document_histories` should churn for a no-op crawl, otherwise the
  // history list fills with empty revisions.
  it('short-circuits on byte-identical content (status: unchanged, no writes)', async () => {
    mocks.documentModel.findBySource.mockResolvedValueOnce({
      content: 'same content',
      id: 'doc-existing',
    } as any);

    const result = await service.upsertCrawledDocument({
      content: 'same content',
      title: 'No change',
      url: 'https://example.com/a',
    });

    expect(mocks.documentModel.create).not.toHaveBeenCalled();
    expect(mocks.documentService.updateDocument).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'doc-existing', status: 'unchanged' });
  });

  // Content changed → must route through DocumentService.updateDocument so
  // the document_histories snapshot pipeline fires.
  it('routes through DocumentService.updateDocument when content changed (status: updated)', async () => {
    mocks.documentModel.findBySource.mockResolvedValueOnce({
      content: 'old body',
      id: 'doc-existing',
    } as any);
    mocks.documentService.updateDocument.mockResolvedValueOnce({
      historyAppended: true,
      id: 'doc-existing',
    });

    const result = await service.upsertCrawledDocument({
      content: 'new body',
      description: 'updated description',
      title: 'Updated title',
      url: 'https://example.com/a',
    });

    expect(mocks.documentModel.create).not.toHaveBeenCalled();
    expect(mocks.documentService.updateDocument).toHaveBeenCalledWith('doc-existing', {
      content: 'new body',
      editorData: { root: { fakeNodeFor: 'new body' } },
      saveSource: 'llm_call',
      title: 'Updated title',
    });
    expect(result).toEqual({ id: 'doc-existing', status: 'updated' });
  });

  it('treats different URLs as distinct documents', async () => {
    mocks.documentModel.findBySource.mockResolvedValue(undefined);
    mocks.documentModel.create.mockResolvedValueOnce({ id: 'doc-a' });
    mocks.documentModel.create.mockResolvedValueOnce({ id: 'doc-b' });

    const a = await service.upsertCrawledDocument({
      content: 'a',
      title: 'A',
      url: 'https://example.com/a',
    });
    const b = await service.upsertCrawledDocument({
      content: 'b',
      title: 'B',
      url: 'https://example.com/b',
    });

    expect(a).toEqual({ id: 'doc-a', status: 'created' });
    expect(b).toEqual({ id: 'doc-b', status: 'created' });
    expect(mocks.documentModel.create).toHaveBeenCalledTimes(2);
    expect(mocks.documentService.updateDocument).not.toHaveBeenCalled();
  });

  it('persists the markdown editor snapshot on first create so future diffs have a baseline', async () => {
    mocks.documentModel.findBySource.mockResolvedValueOnce(undefined);
    mocks.documentModel.create.mockResolvedValueOnce({ id: 'doc-1' });

    await service.upsertCrawledDocument({
      content: 'hello',
      title: 'Hello',
      url: 'https://example.com/h',
    });

    expect(mocks.documentModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        editorData: { root: { fakeNodeFor: 'hello' } },
        sourceType: 'web',
      }),
    );
  });

  // Topic binding restores parity with the old `notebook.createDocument`
  // client path so crawled docs still show up under the active topic in
  // the notebook UI.
  it('binds the document to a topic when topicId is provided', async () => {
    mocks.documentModel.findBySource.mockResolvedValueOnce(undefined);
    mocks.documentModel.create.mockResolvedValueOnce({ id: 'doc-1' });

    await service.upsertCrawledDocument({
      content: 'body',
      title: 'Crawled',
      topicId: 'topic-1',
      url: 'https://example.com/a',
    });

    expect(mocks.topicDocumentModel.associate).toHaveBeenCalledWith({
      documentId: 'doc-1',
      topicId: 'topic-1',
    });
  });

  it('skips topic binding when topicId is omitted (server agent runtime path)', async () => {
    mocks.documentModel.findBySource.mockResolvedValueOnce(undefined);
    mocks.documentModel.create.mockResolvedValueOnce({ id: 'doc-1' });

    await service.upsertCrawledDocument({
      content: 'body',
      title: 'Crawled',
      url: 'https://example.com/a',
    });

    expect(mocks.topicDocumentModel.associate).not.toHaveBeenCalled();
  });

  it('binds the topic even on unchanged short-circuit so cross-topic re-crawls still appear', async () => {
    mocks.documentModel.findBySource.mockResolvedValueOnce({
      content: 'same body',
      id: 'doc-existing',
    } as any);

    const result = await service.upsertCrawledDocument({
      content: 'same body',
      title: 'Same',
      topicId: 'topic-other',
      url: 'https://example.com/a',
    });

    expect(result).toEqual({ id: 'doc-existing', status: 'unchanged' });
    expect(mocks.topicDocumentModel.associate).toHaveBeenCalledWith({
      documentId: 'doc-existing',
      topicId: 'topic-other',
    });
  });

  it('hashes existing.content treating null/undefined as empty string', async () => {
    // Defensive: legacy rows may have null content but hash compare should
    // still work (md5('') !== md5('new content')) so we fall into update.
    mocks.documentModel.findBySource.mockResolvedValueOnce({
      content: null,
      id: 'doc-legacy',
    } as any);
    mocks.documentService.updateDocument.mockResolvedValueOnce({ id: 'doc-legacy' });

    const result = await service.upsertCrawledDocument({
      content: 'fresh body',
      title: 'Title',
      url: 'https://example.com/legacy',
    });

    expect(mocks.documentService.updateDocument).toHaveBeenCalled();
    expect(result).toEqual({ id: 'doc-legacy', status: 'updated' });
  });
});
