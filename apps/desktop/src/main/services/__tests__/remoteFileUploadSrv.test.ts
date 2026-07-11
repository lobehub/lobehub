import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type App } from '@/core/App';

import RemoteFileUploadService from '../remoteFileUploadSrv';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('@/utils/user-agent', () => ({
  setDesktopUserAgentHeader: vi.fn(),
}));

const mockRemoteServerConfigCtr = {
  getAccessToken: vi.fn(),
  getRemoteServerUrl: vi.fn(),
};

const mockApp = {
  getController: vi.fn(() => mockRemoteServerConfigCtr),
} as unknown as App;

const fetchMock = vi.fn();

/** Build a trpc lambda response envelope (superjson: `{ json }`). */
const trpcResponse = (json: unknown) => ({
  json: async () => ({ result: { data: { json } } }),
  ok: true,
});

describe('RemoteFileUploadService.uploadFileBuffer', () => {
  let service: RemoteFileUploadService;
  const input = {
    buffer: Buffer.from('image-bytes'),
    fileName: 'cat.png',
    fileType: 'image/png',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    mockRemoteServerConfigCtr.getRemoteServerUrl.mockResolvedValue('https://server.example.com');
    mockRemoteServerConfigCtr.getAccessToken.mockResolvedValue('token-abc');
    service = new RemoteFileUploadService(mockApp);
  });

  it('declines (returns undefined) without an active remote session', async () => {
    mockRemoteServerConfigCtr.getAccessToken.mockResolvedValue(null);

    expect(await service.uploadFileBuffer(input)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uploads via pre-signed PUT and creates the file record', async () => {
    fetchMock
      // 1. file.checkFileHash → miss
      .mockResolvedValueOnce(trpcResponse({ isExist: false }))
      // 2. upload.createS3PreSignedUrl
      .mockResolvedValueOnce(trpcResponse('https://s3.example.com/presigned'))
      // 3. S3 PUT
      .mockResolvedValueOnce({ ok: true })
      // 4. file.createFile
      .mockResolvedValueOnce(
        trpcResponse({ id: 'file-1', url: 'https://files.example.com/cat.png' }),
      );

    const record = await service.uploadFileBuffer(input);

    expect(record).toEqual({ id: 'file-1', url: 'https://files.example.com/cat.png' });

    const [hashUrl, hashInit] = fetchMock.mock.calls[0];
    expect(hashUrl).toBe('https://server.example.com/trpc/lambda/file.checkFileHash');
    expect(hashInit.headers['Oidc-Auth']).toBe('token-abc');
    expect(JSON.parse(hashInit.body).json.hash).toMatch(/^[0-9a-f]{64}$/);

    const [putUrl, putInit] = fetchMock.mock.calls[2];
    expect(putUrl).toBe('https://s3.example.com/presigned');
    expect(putInit.method).toBe('PUT');
    expect(putInit.headers['Content-Type']).toBe('image/png');

    const [createUrl, createInit] = fetchMock.mock.calls[3];
    expect(createUrl).toBe('https://server.example.com/trpc/lambda/file.createFile');
    const createBody = JSON.parse(createInit.body).json;
    expect(createBody.name).toBe('cat.png');
    expect(createBody.fileType).toBe('image/png');
    expect(createBody.url).toMatch(/^files\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{64}\.png$/);
  });

  it('skips the S3 upload when the hash already exists', async () => {
    fetchMock
      .mockResolvedValueOnce(trpcResponse({ isExist: true, url: 'files/2026-07-11/dedup.png' }))
      .mockResolvedValueOnce(
        trpcResponse({ id: 'file-2', url: 'https://files.example.com/dedup.png' }),
      );

    const record = await service.uploadFileBuffer(input);

    expect(record).toEqual({ id: 'file-2', url: 'https://files.example.com/dedup.png' });
    // Only checkFileHash + createFile — no presign, no PUT.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const createBody = JSON.parse(fetchMock.mock.calls[1][1].body).json;
    expect(createBody.url).toBe('files/2026-07-11/dedup.png');
  });

  it('throws when the S3 PUT fails', async () => {
    fetchMock
      .mockResolvedValueOnce(trpcResponse({ isExist: false }))
      .mockResolvedValueOnce(trpcResponse('https://s3.example.com/presigned'))
      .mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden' });

    await expect(service.uploadFileBuffer(input)).rejects.toThrow('S3 upload failed: 403');
  });
});
