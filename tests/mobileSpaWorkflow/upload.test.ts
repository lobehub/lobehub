import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyUploadedAssets } from '../../scripts/mobileSpaWorkflow/upload';

describe('verifyUploadedAssets', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects an asset batch when the public CDN returns an error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 404 }),
    );

    await expect(verifyUploadedAssets(['https://cdn.test/mobile/app.js'])).rejects.toThrow(
      'Uploaded mobile assets are not publicly reachable: https://cdn.test/mobile/app.js (404)',
    );
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.test/mobile/app.js', { method: 'HEAD' });
  });

  it('accepts an asset batch when every public CDN request succeeds', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await expect(
      verifyUploadedAssets([
        'https://cdn.test/mobile/index.js',
        'https://cdn.test/mobile/index.css',
      ]),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a transport failure instead of treating it as an uploaded asset', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network unavailable'));

    await expect(verifyUploadedAssets(['https://cdn.test/mobile/index.js'])).rejects.toThrow(
      'https://cdn.test/mobile/index.js (Error: network unavailable)',
    );
  });
});
