import { beforeEach, describe, expect, it, vi } from 'vitest';

import { READABLE_URL_BATCH_SIZE } from '@/const/readableFileUrls';
import { lambdaClient } from '@/libs/trpc/client';

import { fileService } from './index';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { file: { getReadableUrls: { query: vi.fn() } } },
}));

beforeEach(() => vi.clearAllMocks());

describe('FileService.getReadableUrls', () => {
  it('bounds and deduplicates requests for long image histories', async () => {
    let active = 0;
    let peak = 0;
    vi.mocked(lambdaClient.file.getReadableUrls.query).mockImplementation(async ({ ids }) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return Object.fromEntries(ids.map((id) => [id, `https://storage.example/${id}`]));
    });
    const ids = Array.from({ length: READABLE_URL_BATCH_SIZE * 2 + 1 }, (_, i) => `file_${i}`);
    const urls = await fileService.getReadableUrls([...ids, ...ids]);
    expect(Object.keys(urls)).toEqual(ids);
    expect(urls.file_0).toBe('https://storage.example/file_0');
    expect(lambdaClient.file.getReadableUrls.query).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
    for (const [input] of vi.mocked(lambdaClient.file.getReadableUrls.query).mock.calls) {
      expect(input.ids.length).toBeLessThanOrEqual(READABLE_URL_BATCH_SIZE);
    }
  });

  it('stops before another batch if cancelled during a lookup', async () => {
    const controller = new AbortController();
    vi.mocked(lambdaClient.file.getReadableUrls.query).mockImplementation(async () => {
      controller.abort();
      return {};
    });
    const ids = Array.from({ length: READABLE_URL_BATCH_SIZE + 1 }, (_, i) => `file_${i}`);
    await expect(fileService.getReadableUrls(ids, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(lambdaClient.file.getReadableUrls.query).toHaveBeenCalledTimes(1);
  });

  it('does not query for empty or already cancelled requests', async () => {
    expect(await fileService.getReadableUrls([])).toEqual({});
    const controller = new AbortController();
    controller.abort();
    await expect(
      fileService.getReadableUrls(['file_camera'], controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(lambdaClient.file.getReadableUrls.query).not.toHaveBeenCalled();
  });
});
