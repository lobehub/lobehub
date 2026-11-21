import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { afterUnscoped } from '@/server/utils/scheduleAfterResponse';

import {
  mayBeOversizedKnowledgeFile,
  resolveKnowledgeFileContents,
} from './resolveKnowledgeFileContents';

const { mockParseFile, MockDocumentService } = vi.hoisted(() => {
  const mockParseFile = vi.fn();
  return {
    // Constructible on purpose: the resolver does `new DocumentService(db, userId, workspaceId)`,
    // and an arrow function cannot be used as a constructor under Vitest 5.
    MockDocumentService: vi.fn().mockImplementation(function () {
      return { parseFile: mockParseFile };
    }),
    mockParseFile,
  };
});

vi.mock('@/server/utils/scheduleAfterResponse', () => ({ afterUnscoped: vi.fn() }));

vi.mock('@/server/services/document', () => ({
  DocumentService: MockDocumentService,
}));

let db: Parameters<typeof resolveKnowledgeFileContents>[0]['db'];

describe('resolveKnowledgeFileContents', () => {
  beforeEach(() => {
    db = {} as typeof db;
    vi.mocked(afterUnscoped).mockClear();
    mockParseFile.mockReset();
    MockDocumentService.mockClear();
  });

  it('passes cached content through without parsing', async () => {
    const result = await resolveKnowledgeFileContents({
      db,
      files: [{ content: 'cached text', enabled: true, id: 'f1', name: 'notes.md' }],
      userId: 'u1',
    });

    expect(result).toEqual([{ content: 'cached text', fileId: 'f1', filename: 'notes.md' }]);
    expect(mockParseFile).not.toHaveBeenCalled();
    expect(MockDocumentService).not.toHaveBeenCalled();
  });

  it('carries the truncation count of a cached document', async () => {
    const result = await resolveKnowledgeFileContents({
      db,
      files: [
        { content: 'head', enabled: true, id: 'f1', name: 'big.md', originalCharCount: 120_000 },
      ],
      userId: 'u1',
    });

    expect(result).toEqual([
      { content: 'head', fileId: 'f1', filename: 'big.md', originalChars: 120_000 },
    ]);
  });

  it('reads the truncation count of an on-demand parse from the document metadata', async () => {
    mockParseFile.mockResolvedValue({ content: 'head', metadata: { originalCharCount: 80_000 } });

    const result = await resolveKnowledgeFileContents({
      db,
      files: [{ content: null, enabled: true, id: 'f2', name: 'big.docx' }],
      userId: 'u1',
    });

    expect(result).toEqual([
      { content: 'head', fileId: 'f2', filename: 'big.docx', originalChars: 80_000 },
    ]);
  });

  it('does not re-parse a cached empty document', async () => {
    const result = await resolveKnowledgeFileContents({
      db,
      files: [{ content: '', enabled: true, id: 'f1', name: 'empty.md' }],
      userId: 'u1',
    });

    expect(result).toEqual([{ content: '', fileId: 'f1', filename: 'empty.md' }]);
    expect(mockParseFile).not.toHaveBeenCalled();
  });

  it('parses files whose document row is missing', async () => {
    mockParseFile.mockResolvedValue({ content: 'parsed text' });

    const result = await resolveKnowledgeFileContents({
      db,
      files: [
        { content: 'cached', enabled: true, id: 'f1', name: 'a.md' },
        { content: null, enabled: true, id: 'f2', name: 'b.docx' },
      ],
      userId: 'u1',
      workspaceId: 'w1',
    });

    expect(mockParseFile).toHaveBeenCalledTimes(1);
    expect(mockParseFile).toHaveBeenCalledWith('f2');
    expect(MockDocumentService).toHaveBeenCalledWith(db, 'u1', 'w1');
    expect(result).toEqual([
      { content: 'cached', fileId: 'f1', filename: 'a.md' },
      { content: 'parsed text', fileId: 'f2', filename: 'b.docx' },
    ]);
  });

  it('normalizes a parsed document without content to an empty string', async () => {
    mockParseFile.mockResolvedValue({ content: null });

    const result = await resolveKnowledgeFileContents({
      db,
      files: [{ content: null, enabled: true, id: 'f1', name: 'a.pdf' }],
      userId: 'u1',
    });

    expect(mockParseFile).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ content: '', fileId: 'f1', filename: 'a.pdf' }]);
  });

  it('reports a parse failure through the error attribute instead of silence', async () => {
    mockParseFile.mockRejectedValue(new Error('unsupported'));

    const result = await resolveKnowledgeFileContents({
      db,
      files: [{ content: null, enabled: true, id: 'f1', name: 'broken.docx' }],
      userId: 'u1',
    });

    expect(result).toEqual([
      {
        content: '',
        error: 'The file is attached but its contents could not be extracted.',
        fileId: 'f1',
        filename: 'broken.docx',
      },
    ]);
  });

  afterEach(() => vi.useRealTimers());

  it('returns the processing placeholder after five seconds while the same scoped parse continues', async () => {
    vi.useFakeTimers();
    const deferred = Promise.withResolvers<{ content: string }>();
    mockParseFile.mockReturnValue(deferred.promise);
    const input = {
      db,
      files: [{ enabled: true, id: 'slow', name: 'slow.md' }],
      userId: 'u1',
      workspaceId: 'w1',
    };

    const initial = resolveKnowledgeFileContents(input);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(initial).resolves.toEqual([
      {
        content: '',
        error:
          'The file is attached but is still being processed; its contents are not available for this message.',
        fileId: 'slow',
        filename: 'slow.md',
      },
    ]);
    const second = resolveKnowledgeFileContents(input);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(second).resolves.toEqual(await initial);
    expect(afterUnscoped).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    const next = resolveKnowledgeFileContents(input);
    expect(mockParseFile).toHaveBeenCalledTimes(1);
    deferred.resolve({ content: 'parsed body' });
    await vi.mocked(afterUnscoped).mock.calls[0][0]();
    await expect(next).resolves.toEqual([
      { content: 'parsed body', fileId: 'slow', filename: 'slow.md' },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caches a late failure for five minutes within one authorization scope', async () => {
    vi.useFakeTimers();
    const deferred = Promise.withResolvers<{ content: string }>();
    mockParseFile.mockReturnValueOnce(deferred.promise).mockResolvedValue({ content: 'parsed' });
    const input = {
      db,
      files: [{ enabled: true, id: 'broken', name: 'broken.md' }],
      userId: 'u1',
      workspaceId: 'w1',
    };

    const initial = resolveKnowledgeFileContents(input);
    await vi.advanceTimersByTimeAsync(5_000);
    await initial;
    deferred.reject(new Error('parse failed'));
    await vi.advanceTimersByTimeAsync(0);
    const cached = await resolveKnowledgeFileContents(input);
    expect(cached[0].error).toBe('The file is attached but its contents could not be extracted.');
    expect(mockParseFile).toHaveBeenCalledTimes(1);

    await resolveKnowledgeFileContents({ ...input, userId: 'u2' });
    await resolveKnowledgeFileContents({ ...input, workspaceId: 'w2' });
    expect(mockParseFile).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(300_000);
    const retried = await resolveKnowledgeFileContents(input);
    expect(retried[0].content).toBe('parsed');
    expect(mockParseFile).toHaveBeenCalledTimes(4);
  });

  it('excludes disabled files and returns an empty list without enabled ones', async () => {
    const result = await resolveKnowledgeFileContents({
      db,
      files: [{ content: null, enabled: false, id: 'f1', name: 'off.md' }],
      userId: 'u1',
    });

    expect(result).toEqual([]);
    expect(mockParseFile).not.toHaveBeenCalled();
  });

  it('skips parsing when the file id or the user id is missing', async () => {
    const withoutFileId = await resolveKnowledgeFileContents({
      db,
      files: [{ content: null, enabled: true, name: 'orphan.md' }],
      userId: 'u1',
    });
    const withoutUserId = await resolveKnowledgeFileContents({
      db,
      files: [{ content: null, enabled: true, id: 'f1', name: 'a.md' }],
    });

    expect(withoutFileId).toEqual([{ content: '', fileId: '', filename: 'orphan.md' }]);
    expect(withoutUserId).toEqual([{ content: '', fileId: 'f1', filename: 'a.md' }]);
    expect(mockParseFile).not.toHaveBeenCalled();
  });

  it('parses a file mounted by several members only once', async () => {
    // The junction key is fileId + agentId + userId, so the same file can
    // appear twice in the knowledge list; the parse must not race itself.
    mockParseFile.mockResolvedValue({ content: 'shared parse' });

    const result = await resolveKnowledgeFileContents({
      db,
      files: [
        { content: null, enabled: true, id: 'f1', name: 'shared.docx' },
        { content: null, enabled: true, id: 'f1', name: 'shared.docx' },
      ],
      userId: 'u1',
    });

    expect(mockParseFile).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      { content: 'shared parse', fileId: 'f1', filename: 'shared.docx' },
      { content: 'shared parse', fileId: 'f1', filename: 'shared.docx' },
    ]);
  });

  it('skips parsing media files the same way the attachment path does', async () => {
    const result = await resolveKnowledgeFileContents({
      db,
      files: [
        { content: null, enabled: true, fileType: 'image/png', id: 'f1', name: 'a.png' },
        { content: null, enabled: true, fileType: 'video/mp4', id: 'f2', name: 'b.mp4' },
        { content: null, enabled: true, fileType: 'audio/wav', id: 'f3', name: 'c.wav' },
      ],
      userId: 'u1',
    });

    expect(result).toEqual([
      { content: '', fileId: 'f1', filename: 'a.png' },
      { content: '', fileId: 'f2', filename: 'b.mp4' },
      { content: '', fileId: 'f3', filename: 'c.wav' },
    ]);
    expect(mockParseFile).not.toHaveBeenCalled();
  });
});

describe('mayBeOversizedKnowledgeFile', () => {
  it('keeps cached documents on the inline-limit rule', () => {
    expect(mayBeOversizedKnowledgeFile({ content: 'short', enabled: true, id: 'f1' })).toBe(false);
    expect(
      mayBeOversizedKnowledgeFile({ content: 'x'.repeat(100_001), enabled: true, id: 'f1' }),
    ).toBe(true);
    expect(
      mayBeOversizedKnowledgeFile({
        content: 'head',
        enabled: true,
        id: 'f1',
        originalCharCount: 120_000,
      }),
    ).toBe(true);
  });

  it('treats an unparsed document as possibly oversized', () => {
    expect(mayBeOversizedKnowledgeFile({ content: null, enabled: true, id: 'f2' })).toBe(true);
    expect(
      mayBeOversizedKnowledgeFile({ enabled: true, fileType: 'application/pdf', id: 'f2' }),
    ).toBe(true);
  });

  it('ignores disabled, id-less and media files', () => {
    expect(mayBeOversizedKnowledgeFile({ content: null, enabled: false, id: 'f3' })).toBe(false);
    expect(mayBeOversizedKnowledgeFile({ content: null, enabled: true })).toBe(false);
    expect(
      mayBeOversizedKnowledgeFile({
        content: null,
        enabled: true,
        fileType: 'image/png',
        id: 'f4',
      }),
    ).toBe(false);
  });
});
