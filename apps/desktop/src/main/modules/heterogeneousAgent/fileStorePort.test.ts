import superjson from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLambdaFileStorePort } from './fileStorePort';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

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
