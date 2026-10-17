import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { READABLE_URL_BATCH_SIZE } from '@/const/readableFileUrls';
import type { FileModel } from '@/database/models/file';
import type { LobeChatDatabase } from '@/database/type';

import * as access from '../_helpers/knowledgeBaseAccess';
import { getReadableUrls, readableUrlsInput } from './readableUrls';

const file = (id: string) =>
  ({ id, url: `objects/${id}` }) as Awaited<ReturnType<FileModel['findByIds']>>[number];
const createContext = () => ({
  fileModel: { findById: vi.fn(), findByIds: vi.fn().mockResolvedValue([]) },
  fileService: { getFullFileUrl: vi.fn(async (url: string) => `https://storage.example/${url}`) },
  serverDB: {} as LobeChatDatabase,
  userId: 'test-user',
});

beforeEach(() => {
  vi.spyOn(access, 'assertContentsNotInRestrictedKnowledgeBase').mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());

describe('batched readable file URLs', () => {
  it('uses one scoped file lookup and one bulk permission check for unique IDs', async () => {
    const ctx = createContext();
    ctx.fileModel.findByIds.mockResolvedValue([file('file_b'), file('file_a')]);
    expect(await getReadableUrls(ctx, ['file_a', 'file_b', 'file_a'])).toEqual({
      file_a: 'https://storage.example/objects/file_a',
      file_b: 'https://storage.example/objects/file_b',
    });
    expect(ctx.fileModel.findByIds).toHaveBeenCalledExactlyOnceWith(['file_a', 'file_b']);
    expect(access.assertContentsNotInRestrictedKnowledgeBase).toHaveBeenCalledExactlyOnceWith(ctx, [
      'file_a',
      'file_b',
    ]);
    expect(ctx.fileService.getFullFileUrl).toHaveBeenCalledTimes(2);
  });

  it('rejects the entire batch before signing when a file is missing or owned by someone else', async () => {
    const ctx = createContext();
    ctx.fileModel.findByIds.mockResolvedValue([file('file_owned')]);
    await expect(getReadableUrls(ctx, ['file_owned', 'file_other'])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(ctx.fileService.getFullFileUrl).not.toHaveBeenCalled();
  });

  it('does not sign any URLs when a knowledge base denies access', async () => {
    const ctx = createContext();
    ctx.fileModel.findByIds.mockResolvedValue([file('file_a'), file('file_restricted')]);
    vi.mocked(access.assertContentsNotInRestrictedKnowledgeBase).mockRejectedValue(
      new TRPCError({ code: 'FORBIDDEN' }),
    );
    await expect(getReadableUrls(ctx, ['file_a', 'file_restricted'])).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(ctx.fileService.getFullFileUrl).not.toHaveBeenCalled();
  });

  it('bounds signing concurrency while returning every authorized URL', async () => {
    const ctx = createContext();
    const ids = Array.from({ length: 25 }, (_, i) => `file_${i}`);
    ctx.fileModel.findByIds.mockResolvedValue(ids.map(file));
    let active = 0;
    let peak = 0;
    ctx.fileService.getFullFileUrl.mockImplementation(async (url) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active--;
      return `https://storage.example/${url}`;
    });
    const urls = await getReadableUrls(ctx, ids);
    expect(Object.keys(urls)).toHaveLength(25);
    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBeGreaterThan(1);
  });

  it('propagates storage failures instead of returning partial results', async () => {
    const ctx = createContext();
    ctx.fileModel.findByIds.mockResolvedValue([file('file_a')]);
    ctx.fileService.getFullFileUrl.mockRejectedValue(new Error('storage unavailable'));
    await expect(getReadableUrls(ctx, ['file_a'])).rejects.toThrow('storage unavailable');
  });

  it('skips database and storage work for an empty batch', async () => {
    const ctx = createContext();
    expect(await getReadableUrls(ctx, [])).toEqual({});
    expect(ctx.fileModel.findByIds).not.toHaveBeenCalled();
    expect(ctx.fileService.getFullFileUrl).not.toHaveBeenCalled();
  });

  it('rejects oversized batches at the API boundary', () => {
    expect(
      readableUrlsInput.safeParse({
        ids: Array.from({ length: READABLE_URL_BATCH_SIZE }, () => 'file_a'),
      }).success,
    ).toBe(true);
    expect(
      readableUrlsInput.safeParse({
        ids: Array.from({ length: READABLE_URL_BATCH_SIZE + 1 }, () => 'file_a'),
      }).success,
    ).toBe(false);
  });
});
