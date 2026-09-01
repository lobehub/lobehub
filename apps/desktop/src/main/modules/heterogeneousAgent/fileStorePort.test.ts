import superjson from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLambdaFileStorePort } from './fileStorePort';

const auth = {
  getAccessToken: async () => 'token-123',
  getServerUrl: async () => 'https://cloud.lobehub.com',
};

/** A tRPC v11 success envelope: `result.data` is a superjson payload. */
const trpcOk = (data: unknown) => ({
  json: async () => ({ result: { data: superjson.serialize(data) } }),
  ok: true,
  status: 200,
  statusText: 'OK',
});

describe('createLambdaFileStorePort', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns undefined when the app has no authed remote server', async () => {
    expect(
      await createLambdaFileStorePort({ ...auth, getAccessToken: async () => null }),
    ).toBeUndefined();
    expect(
      await createLambdaFileStorePort({ ...auth, getServerUrl: async () => null }),
    ).toBeUndefined();
  });

  it('keeps a sibling rejection handled when an auth callback throws synchronously', async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      // Shape of the real failure: `getServerUrl` is async (rejects) while
      // `getAccessToken` is a plain arrow that throws. Building the `Promise.all`
      // argument list must not leave the first rejection without a subscriber —
      // in Electron main an unhandled rejection kills the process.
      await expect(
        createLambdaFileStorePort({
          getAccessToken: () => {
            throw new TypeError("Cannot read properties of undefined (reading 'getAccessToken')");
          },
          getServerUrl: async () => {
            throw new TypeError("Cannot read properties of undefined (reading 'getServerUrl')");
          },
        }),
      ).rejects.toThrow(TypeError);

      // Node reports unhandled rejections once the microtask queue drains.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('POSTs a superjson-serialized input to the lambda procedure and deserializes the result', async () => {
    vi.mocked(fetch).mockResolvedValue(trpcOk({ isExist: true, url: 'files/a/b.png' }) as any);

    const port = await createLambdaFileStorePort(auth);
    const result = await port!.checkFileHash({ hash: 'abc' });

    expect(result).toEqual({ isExist: true, url: 'files/a/b.png' });
    expect(fetch).toHaveBeenCalledWith('https://cloud.lobehub.com/trpc/lambda/file.checkFileHash', {
      body: JSON.stringify(superjson.serialize({ hash: 'abc' })),
      headers: { 'Content-Type': 'application/json', 'Oidc-Auth': 'token-123' },
      method: 'POST',
    });
  });

  it('strips a trailing slash from the server url', async () => {
    vi.mocked(fetch).mockResolvedValue(trpcOk('https://s3/presigned') as any);

    const port = await createLambdaFileStorePort({
      ...auth,
      getServerUrl: async () => 'https://cloud.lobehub.com/',
    });
    await port!.createS3PreSignedUrl({ pathname: 'files/a/b.png' });

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'https://cloud.lobehub.com/trpc/lambda/upload.createS3PreSignedUrl',
    );
  });

  it('surfaces a tRPC error envelope as a throw', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({
        error: superjson.serialize({ code: -32_001, message: 'UNAUTHORIZED' }),
      }),
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as any);

    const port = await createLambdaFileStorePort(auth);

    await expect(port!.createFile({} as any)).rejects.toThrow(
      'trpc file.createFile failed: 401 UNAUTHORIZED',
    );
  });

  it('surfaces a non-JSON failure response as a throw', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: async () => {
        throw new Error('not json');
      },
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
    } as any);

    const port = await createLambdaFileStorePort(auth);

    await expect(port!.checkFileHash({ hash: 'abc' })).rejects.toThrow('502');
  });
});
