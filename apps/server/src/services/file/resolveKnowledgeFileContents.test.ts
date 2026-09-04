import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveKnowledgeFileContents } from './resolveKnowledgeFileContents';

const { mockParseFile, MockDocumentService } = vi.hoisted(() => {
  const mockParseFile = vi.fn();
  return {
    MockDocumentService: vi.fn().mockImplementation(() => ({ parseFile: mockParseFile })),
    mockParseFile,
  };
});

vi.mock('@/server/services/document', () => ({
  DocumentService: MockDocumentService,
}));

const db = {} as never;

describe('resolveKnowledgeFileContents', () => {
  beforeEach(() => {
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
