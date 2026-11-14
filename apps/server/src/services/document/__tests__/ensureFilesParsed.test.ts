import { type LobeChatDatabase } from '@lobechat/database';
import { loadFile } from '@lobechat/file-loaders';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_FILE_PARSE_SIZE } from '@/const/file';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';

import { FileService } from '../../file';
import { DocumentService } from '../index';

vi.mock('@/database/models/document');
vi.mock('@/database/models/file');
vi.mock('@/database/models/knowledgeBase');
vi.mock('../../file');
vi.mock('../history');
vi.mock('@lobechat/file-loaders', () => ({
  loadFile: vi.fn(),
  UnsupportedFileTypeError: class extends Error {},
}));

const parsedFile = (overrides: Record<string, unknown> = {}) => ({
  fileType: 'text/markdown',
  id: 'file-md',
  name: 'policy.md',
  size: 1024,
  url: 's3://bucket/policy.md',
  ...overrides,
});

describe('DocumentService.ensureFilesParsed', () => {
  const findByIds = vi.fn();
  const findFileById = vi.fn();
  const findByFileId = vi.fn();
  const create = vi.fn();
  const downloadFileToLocal = vi.fn();
  let service: DocumentService;

  beforeEach(() => {
    vi.clearAllMocks();
    findFileById.mockResolvedValue(undefined);
    findByFileId.mockResolvedValue(null);
    create.mockResolvedValue({ id: 'doc-1' });
    downloadFileToLocal.mockImplementation(async (id: string) => ({
      cleanup: vi.fn(),
      file: { name: `${id}.md`, parentId: null, url: `s3://${id}`, visibility: 'private' },
      filePath: `/tmp/${id}`,
    }));
    vi.mocked(loadFile).mockResolvedValue({
      content: '差旅住宿标准',
      fileType: 'md',
      metadata: {},
      pages: [],
      totalCharCount: 6,
      totalLineCount: 1,
    } as any);
    vi.mocked(DocumentModel).mockImplementation(function () {
      return { create, findByFileId } as any;
    });
    vi.mocked(FileModel).mockImplementation(function () {
      return { findById: findFileById, findByIds } as any;
    });
    vi.mocked(FileService).mockImplementation(function () {
      return { downloadFileToLocal } as any;
    });

    const db = {
      execute: vi.fn(),
      transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
    };
    service = new DocumentService(db as unknown as LobeChatDatabase, 'user-1', 'workspace-1');
  });

  it('stores full text for a file without needing chunks or embeddings', async () => {
    findByIds.mockResolvedValue([parsedFile()]);

    await service.ensureFilesParsed(['file-md']);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ content: '差旅住宿标准', fileId: 'file-md' }),
    );
  });

  it('keeps the parsed document as private as its source file', async () => {
    findByIds.mockResolvedValue([parsedFile()]);

    await service.ensureFilesParsed(['file-md']);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }));
  });

  it('takes the visibility a publish committed while the file was parsing', async () => {
    findByIds.mockResolvedValue([parsedFile()]);
    // The row read before the download was private, then a publish landed while
    // the whole file was being parsed. The row re-read under the parse lock is
    // the value the insert has to carry, otherwise the text stays private while
    // the file itself is already in the workspace.
    findFileById.mockResolvedValue({ ...parsedFile(), visibility: 'public' });

    await service.ensureFilesParsed(['file-md']);

    expect(findFileById).toHaveBeenCalledWith('file-md', expect.anything());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'public' }));
  });

  it('only parses files that can hold searchable text', async () => {
    findByIds.mockResolvedValue([
      parsedFile({ fileType: 'image/png', id: 'file-image' }),
      parsedFile({ id: 'file-huge', size: MAX_FILE_PARSE_SIZE + 1 }),
      parsedFile({ id: 'file-inline', url: 'internal://document/placeholder' }),
      parsedFile({ id: 'file-md' }),
    ]);

    await service.ensureFilesParsed([
      'file-image',
      'file-huge',
      'file-inline',
      'file-md',
      'docs_page',
    ]);

    expect(findByIds).toHaveBeenCalledWith(['file-image', 'file-huge', 'file-inline', 'file-md']);
    expect(downloadFileToLocal).toHaveBeenCalledTimes(1);
    expect(downloadFileToLocal).toHaveBeenCalledWith('file-md', expect.anything());
  });

  it('continues past a file that fails to parse', async () => {
    findByIds.mockResolvedValue([parsedFile({ id: 'file-bad' }), parsedFile({ id: 'file-good' })]);
    vi.mocked(loadFile).mockRejectedValueOnce(new Error('corrupt file'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(service.ensureFilesParsed(['file-bad', 'file-good'])).resolves.toBeUndefined();

    expect(create).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  it('does not look up files when only inline documents were added', async () => {
    await service.ensureFilesParsed(['docs_page']);

    expect(findByIds).not.toHaveBeenCalled();
  });
});
