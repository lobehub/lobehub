import { type LobeChatDatabase } from '@lobechat/database';
import { FileParseBudgetError } from '@lobechat/file-loaders';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';

import { FileService } from '../../file';
import { FileParseError, parseFileInWorker } from '../../fileParse';
import { DocumentService } from '../index';

vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => null }));
vi.mock('@/database/models/document');
vi.mock('@/database/models/file');
vi.mock('@/database/models/knowledgeBase');
vi.mock('../../file');
vi.mock('../history');
vi.mock('../../resourceEvents', () => ({ publishResourceEvent: vi.fn() }));
vi.mock('../../fileParse', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  parseFileInWorker: vi.fn(),
}));

describe('DocumentService parsing through the worker boundary', () => {
  const createdDocument = vi.fn();
  const downloadFileToLocal = vi.fn();
  let cleanupFinished: boolean;
  let service: DocumentService;

  beforeEach(() => {
    vi.resetAllMocks();
    cleanupFinished = false;
    createdDocument.mockResolvedValue({ id: 'doc-1' });

    vi.mocked(DocumentModel).mockImplementation(function () {
      return { create: createdDocument, findByFileId: vi.fn().mockResolvedValue(null) } as never;
    });
    vi.mocked(FileModel).mockImplementation(function () {
      return {} as never;
    });
    vi.mocked(KnowledgeBaseModel).mockImplementation(function () {
      return {} as never;
    });
    vi.mocked(FileService).mockImplementation(function () {
      return { downloadFileToLocal } as never;
    });

    downloadFileToLocal.mockResolvedValue({
      // The temp directory is removed asynchronously: the service must wait for it.
      cleanup: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        cleanupFinished = true;
      },
      file: { name: 'report.xlsx', parentId: null, url: 's3://bucket/report.xlsx' },
      filePath: '/tmp/x/report.xlsx',
    });

    const db = {
      transaction: vi.fn(async (callback: (tx: LobeChatDatabase) => Promise<unknown>) =>
        callback({ execute: vi.fn() } as never),
      ),
    } as never;
    service = new DocumentService(db, 'user-1');
  });

  it.each([
    ['QUEUE_FULL', 'TOO_MANY_REQUESTS'],
    ['QUEUE_TIMEOUT', 'TOO_MANY_REQUESTS'],
    ['TIMEOUT', 'TIMEOUT'],
    ['UNAVAILABLE', 'SERVICE_UNAVAILABLE'],
    ['LOAD_FAILED', 'UNPROCESSABLE_CONTENT'],
    ['INPUT_TOO_LARGE', 'PAYLOAD_TOO_LARGE'],
    ['WORKER_FAILED', 'INTERNAL_SERVER_ERROR'],
  ])(
    'maps %s to %s, stores nothing, and finishes cleanup before rejecting',
    async (code, trpcCode) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(parseFileInWorker).mockRejectedValue(
        new FileParseError(code as never, 'parse failed'),
      );

      for (const parse of [
        () => service.parseFile('file-1'),
        () => service.parseDocument('file-1'),
      ]) {
        cleanupFinished = false;
        const error = await parse().catch((e) => e);

        expect(error).toBeInstanceOf(TRPCError);
        expect(error).toMatchObject({ code: trpcCode });
        expect(cleanupFinished).toBe(true);
      }
      expect(createdDocument).not.toHaveBeenCalled();
    },
  );

  it('parses both entries on the worker with the file id and the matching mode', async () => {
    vi.mocked(parseFileInWorker).mockResolvedValue({
      content: 'text',
      metadata: {},
      totalCharCount: 4,
      totalLineCount: 1,
    } as never);

    await service.parseFile('file-1');
    await service.parseDocument('file-1');

    expect(parseFileInWorker).toHaveBeenNthCalledWith(1, '/tmp/x/report.xlsx', {
      fileId: 'file-1',
      mode: 'file',
    });
    expect(parseFileInWorker).toHaveBeenNthCalledWith(2, '/tmp/x/report.xlsx', {
      fileId: 'file-1',
      mode: 'document',
    });
    expect(cleanupFinished).toBe(true);
  });

  it('maps a budget refusal to a non-500 error that keeps reason, limit and actual as its cause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const budget = new FileParseBudgetError('sheet-cells', 5_000_000, 52_428_800);
    vi.mocked(parseFileInWorker).mockRejectedValue(budget);

    for (const parse of [
      () => service.parseFile('file-1'),
      () => service.parseDocument('file-1'),
    ]) {
      cleanupFinished = false;
      const error = await parse().catch((e) => e);

      expect(error).toBeInstanceOf(TRPCError);
      expect(error).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
      expect(error.cause).toBe(budget);
      expect(error.cause).toMatchObject({
        actual: 52_428_800,
        limit: 5_000_000,
        reason: 'sheet-cells',
      });
      expect(cleanupFinished).toBe(true);
    }
    expect(createdDocument).not.toHaveBeenCalled();
  });

  it('asks the download for the 64 MiB parse cap on both entries and keeps the access scope', async () => {
    vi.mocked(parseFileInWorker).mockResolvedValue({
      content: 'text',
      metadata: {},
      totalCharCount: 4,
      totalLineCount: 1,
    } as never);
    const scope = { kind: 'custom' } as never;

    await service.parseFile('file-1', scope);
    await service.parseDocument('file-2');

    expect(downloadFileToLocal).toHaveBeenNthCalledWith(1, 'file-1', scope, {
      maxBytes: 64 * 1024 * 1024,
    });
    expect(downloadFileToLocal).toHaveBeenNthCalledWith(2, 'file-2', undefined, {
      maxBytes: 64 * 1024 * 1024,
    });
  });

  it('stores nothing and parses nothing when the download refuses an oversized file', async () => {
    downloadFileToLocal.mockRejectedValue(
      new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'too large' }),
    );

    await expect(service.parseFile('file-1')).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(service.parseDocument('file-1')).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
    });

    expect(parseFileInWorker).not.toHaveBeenCalled();
    expect(createdDocument).not.toHaveBeenCalled();
  });
});
