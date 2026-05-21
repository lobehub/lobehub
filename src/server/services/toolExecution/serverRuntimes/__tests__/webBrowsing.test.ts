import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentModel } from '@/database/models/document';
import type { DocumentService } from '@/server/services/document';

import { upsertWebDocument } from '../webBrowsing';

// `webBrowsing.ts` eagerly imports SearchService, whose constructor reads
// server-only env vars at module load. We only exercise `upsertWebDocument`
// in this file, so swap the module out for a no-op (vitest hoists vi.mock).
vi.mock('@/server/services/search', () => ({
  SearchService: class {},
}));

vi.mock('@/server/services/agentDocuments/headlessEditor', () => ({
  createMarkdownEditorSnapshot: vi.fn(async (content: string) => ({
    content,
    editorData: { root: { fakeNodeFor: content } },
  })),
}));

const buildModelMock = () => ({
  create: vi.fn(),
  findBySource: vi.fn(),
});

const buildServiceMock = () => ({
  updateDocument: vi.fn(),
});

describe('upsertWebDocument (LOBE-9384 dedupe + history snapshot)', () => {
  let model: ReturnType<typeof buildModelMock>;
  let service: ReturnType<typeof buildServiceMock>;

  beforeEach(() => {
    model = buildModelMock();
    service = buildServiceMock();
  });

  it('creates a new documents row the first time a URL is crawled', async () => {
    model.findBySource.mockResolvedValueOnce(undefined);
    model.create.mockResolvedValueOnce({ id: 'doc-1' });

    const result = await upsertWebDocument(
      model as unknown as DocumentModel,
      service as unknown as DocumentService,
      {
        content: 'body\nline2',
        description: 'a page',
        title: 'Crawled',
        url: 'https://example.com/a',
      },
    );

    expect(model.findBySource).toHaveBeenCalledWith('https://example.com/a', 'web');
    expect(service.updateDocument).not.toHaveBeenCalled();
    expect(model.create).toHaveBeenCalledWith({
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
    expect(result).toEqual({ id: 'doc-1' });
  });

  // Repeat crawl must route through DocumentService.updateDocument so the
  // document_histories snapshot pipeline fires — this is the "creates a
  // history version" behavior LOBE-9384 expects.
  it('routes a repeated URL through DocumentService.updateDocument to record history', async () => {
    model.findBySource.mockResolvedValueOnce({ id: 'doc-existing' } as any);
    service.updateDocument.mockResolvedValueOnce({ id: 'doc-existing', historyAppended: true });

    const result = await upsertWebDocument(
      model as unknown as DocumentModel,
      service as unknown as DocumentService,
      {
        content: 'updated body',
        description: 'updated description',
        title: 'Updated title',
        url: 'https://example.com/a',
      },
    );

    expect(model.findBySource).toHaveBeenCalledWith('https://example.com/a', 'web');
    expect(model.create).not.toHaveBeenCalled();
    expect(service.updateDocument).toHaveBeenCalledWith('doc-existing', {
      content: 'updated body',
      editorData: { root: { fakeNodeFor: 'updated body' } },
      saveSource: 'llm_call',
      title: 'Updated title',
    });
    expect(result).toEqual({ id: 'doc-existing' });
  });

  it('treats different URLs as distinct documents', async () => {
    model.findBySource.mockResolvedValue(undefined);
    model.create.mockResolvedValueOnce({ id: 'doc-a' });
    model.create.mockResolvedValueOnce({ id: 'doc-b' });

    const a = await upsertWebDocument(
      model as unknown as DocumentModel,
      service as unknown as DocumentService,
      { content: 'a', title: 'A', url: 'https://example.com/a' },
    );
    const b = await upsertWebDocument(
      model as unknown as DocumentModel,
      service as unknown as DocumentService,
      { content: 'b', title: 'B', url: 'https://example.com/b' },
    );

    expect(a).toEqual({ id: 'doc-a' });
    expect(b).toEqual({ id: 'doc-b' });
    expect(model.create).toHaveBeenCalledTimes(2);
    expect(service.updateDocument).not.toHaveBeenCalled();
  });

  it('persists the markdown editor snapshot on first create so later history diffs have something to compare', async () => {
    model.findBySource.mockResolvedValueOnce(undefined);
    model.create.mockResolvedValueOnce({ id: 'doc-1' });

    await upsertWebDocument(
      model as unknown as DocumentModel,
      service as unknown as DocumentService,
      { content: 'hello', title: 'Hello', url: 'https://example.com/h' },
    );

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        editorData: { root: { fakeNodeFor: 'hello' } },
        sourceType: 'web',
      }),
    );
  });
});
