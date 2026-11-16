import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';

import { FileService } from '../../file';
import { DocumentHistoryService } from '../history';
import { DocumentService } from '../index';

vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => null }));
vi.mock('@/database/models/document');
vi.mock('@/database/models/file');
vi.mock('@/database/models/knowledgeBase');
vi.mock('../../file');
vi.mock('../history');
vi.mock('../../resourceEvents', () => ({ publishResourceEvent: vi.fn() }));
vi.mock('@lobechat/file-loaders', () => {
  class UnsupportedFileTypeError extends Error {
    fileType: string;

    constructor(fileType: string, filename: string) {
      super(`Unsupported file type '${fileType || 'unknown'}' for file '${filename}'.`);
      this.name = 'UnsupportedFileTypeError';
      this.fileType = fileType;
    }
  }

  return { loadFile: vi.fn(), UnsupportedFileTypeError };
});
vi.mock('debug', () => ({
  default: () => vi.fn(),
}));

const { loadFile } = await import('@lobechat/file-loaders');

// `parseFile` decides a document's visibility inside the per-file write lock, so
// these scenarios need the locked transaction to hand back a second File model.
// They live in their own suite because `index.test.ts` is already over the
// 1,200-line limit in AGENTS.md.
describe('DocumentService.parseFile visibility under the write lock', () => {
  let service: DocumentService;
  let mockDb: any;
  let mockDocumentModel: any;
  let mockFileModel: any;
  let mockFileService: any;
  let mockKnowledgeBaseModel: any;
  const mockCleanup = vi.fn();

  beforeEach(() => {
    mockDb = {
      execute: vi.fn().mockResolvedValue(undefined),
      query: {
        documents: { findMany: vi.fn().mockResolvedValue([]) },
        files: { findMany: vi.fn().mockResolvedValue([]) },
      },
      transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(mockDb)),
    };

    mockDocumentModel = {
      create: vi.fn(),
      delete: vi.fn(),
      findByFileId: vi.fn().mockResolvedValue(null),
      findById: vi.fn(),
      query: vi.fn(),
      update: vi.fn(),
    };

    mockFileModel = {
      create: vi.fn(),
      delete: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
    };

    mockFileService = {
      deleteFile: vi.fn(),
      downloadFileToLocal: vi.fn(),
    };

    mockKnowledgeBaseModel = {
      findById: vi.fn().mockResolvedValue({ id: 'kb-1', visibility: 'public' }),
    };

    vi.mocked(DocumentModel).mockImplementation(function () {
      return mockDocumentModel;
    });
    vi.mocked(FileModel).mockImplementation(function () {
      return mockFileModel;
    });
    vi.mocked(FileService).mockImplementation(function () {
      return mockFileService;
    });
    vi.mocked(DocumentHistoryService).mockImplementation(function () {
      return {
        compareDocumentHistoryItems: vi.fn(),
        createHistory: vi.fn().mockResolvedValue({ id: 'history-default', savedAt: new Date() }),
        getDocumentHistoryItem: vi.fn(),
        listDocumentHistory: vi.fn(),
      };
    });
    vi.mocked(KnowledgeBaseModel).mockImplementation(function () {
      return mockKnowledgeBaseModel;
    });

    service = new DocumentService(mockDb, 'test-user-id');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // The model bound to the locked transaction has to be a different object
  // from the one the service already holds, otherwise no assertion can tell
  // which connection the re-check and the insert actually ran on.
  const mountLockedTransaction = (transactionModel: any, transactionFileModel?: any) => {
    const executeSpy = vi.fn().mockResolvedValue(undefined);
    const trx = { execute: executeSpy };
    mockDb.transaction = vi.fn(async (callback: any) => callback(trx));
    vi.mocked(DocumentModel).mockImplementation(function (db: any) {
      return (db === trx ? transactionModel : mockDocumentModel) as any;
    });
    if (transactionFileModel) {
      vi.mocked(FileModel).mockImplementation(function (db: any) {
        return (db === trx ? transactionFileModel : mockFileModel) as any;
      });
    }

    return { executeSpy, trx };
  };

  it('should store the visibility the file holds under the lock, not the one read before the parse', async () => {
    vi.mocked(loadFile).mockResolvedValue({
      content: 'Content',
      fileType: 'markdown',
      metadata: {},
      pages: undefined,
      totalCharCount: 7,
      totalLineCount: 1,
    } as any);
    // The download read the row while it was still private; a publish landed
    // while the file was being parsed.
    mockFileService.downloadFileToLocal.mockResolvedValue({
      cleanup: mockCleanup,
      file: {
        name: 'policy.md',
        parentId: null,
        url: 's3://bucket/policy.md',
        visibility: 'private',
      },
      filePath: '/tmp/policy.md',
    });
    const transactionModel = {
      create: vi.fn().mockResolvedValue({ id: 'doc-1' }),
      findByFileId: vi.fn().mockResolvedValue(null),
    };
    const transactionFileModel = {
      findById: vi.fn().mockResolvedValue({ id: 'file-1', visibility: 'public' }),
    };
    const { executeSpy } = mountLockedTransaction(transactionModel, transactionFileModel);

    await service.parseFile('file-1');

    expect(transactionFileModel.findById).toHaveBeenCalledWith('file-1', {
      accessScope: { type: 'ordinary' },
    });
    // Reading before the lock would leave the same window open, and reading
    // after the insert would be too late to influence the row.
    expect(executeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      transactionFileModel.findById.mock.invocationCallOrder[0],
    );
    expect(transactionFileModel.findById.mock.invocationCallOrder[0]).toBeLessThan(
      transactionModel.create.mock.invocationCallOrder[0],
    );
    expect(transactionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'public' }),
    );
  });

  it('should keep the download-time visibility when the file is no longer visible under the lock', async () => {
    vi.mocked(loadFile).mockResolvedValue({
      content: 'Content',
      fileType: 'markdown',
      metadata: {},
      pages: undefined,
      totalCharCount: 7,
      totalLineCount: 1,
    } as any);
    mockFileService.downloadFileToLocal.mockResolvedValue({
      cleanup: mockCleanup,
      file: {
        name: 'shared.md',
        parentId: null,
        url: 's3://bucket/shared.md',
        visibility: 'public',
      },
      filePath: '/tmp/shared.md',
    });
    const transactionModel = {
      create: vi.fn().mockResolvedValue({ id: 'doc-1' }),
      findByFileId: vi.fn().mockResolvedValue(null),
    };
    // An agent-share visitor parsed the file; the tenant-scoped re-read finds
    // no row to report.
    const transactionFileModel = { findById: vi.fn().mockResolvedValue(undefined) };
    mountLockedTransaction(transactionModel, transactionFileModel);

    await service.parseFile('file-1');

    expect(transactionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'public' }),
    );
  });
});
