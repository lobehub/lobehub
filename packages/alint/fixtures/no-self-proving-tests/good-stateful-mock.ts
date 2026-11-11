import { expect, it, vi } from 'vitest';

const retry = async (request: () => Promise<string>) => {
  try {
    return await request();
  } catch {
    return request();
  }
};

it('recovers from the first request failure', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('ready');
  expect(await retry(request)).toBe('ready');
  expect(request).toHaveBeenCalledTimes(2);
});
