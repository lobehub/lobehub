import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type App } from '@/core/App';

import RemoteFileUploadService from '../remoteFileUploadSrv';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

// promisify(execFile) uses the custom-promisify symbol when present; easiest
// is to make the mock already promisified.
vi.mock('node:util', () => ({
  promisify: (fn: any) => fn,
}));

vi.mock('@/modules/cliEmbedding', () => ({
  resolveCliScript: () => '/app/resources/bin/lobe-cli.js',
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

const mockRemoteServerConfigCtr = {
  getAccessToken: vi.fn(),
  getRemoteServerUrl: vi.fn(),
};

const mockApp = {
  getController: vi.fn(() => mockRemoteServerConfigCtr),
} as unknown as App;

describe('RemoteFileUploadService.uploadLocalFile', () => {
  let service: RemoteFileUploadService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoteServerConfigCtr.getRemoteServerUrl.mockResolvedValue('https://server.example.com/');
    mockRemoteServerConfigCtr.getAccessToken.mockResolvedValue('token-abc');
    service = new RemoteFileUploadService(mockApp);
  });

  it('runs the embedded CLI with the desktop session injected and parses the record', async () => {
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify({ id: 'file-1', url: 'https://files.example.com/cat.png' }),
    });

    const record = await service.uploadLocalFile('/tmp/cat.png');

    expect(record).toEqual({ id: 'file-1', url: 'https://files.example.com/cat.png' });

    const [execPath, args, opts] = execFileMock.mock.calls[0];
    expect(execPath).toBe(process.execPath);
    expect(args).toEqual([
      '/app/resources/bin/lobe-cli.js',
      'file',
      'upload',
      '/tmp/cat.png',
      '--json',
      'id,url',
    ]);
    expect(opts.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(opts.env.LOBEHUB_JWT).toBe('token-abc');
    // Trailing slash is stripped for LOBEHUB_SERVER.
    expect(opts.env.LOBEHUB_SERVER).toBe('https://server.example.com');
  });

  it('still runs without a desktop session — lh falls back to its own login', async () => {
    mockRemoteServerConfigCtr.getAccessToken.mockResolvedValue(null);
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify({ id: 'file-2', url: 'https://files.example.com/b.png' }),
    });

    const record = await service.uploadLocalFile('/tmp/b.png');

    expect(record).toEqual({ id: 'file-2', url: 'https://files.example.com/b.png' });
    const [, , opts] = execFileMock.mock.calls[0];
    expect(opts.env.LOBEHUB_JWT).toBeUndefined();
    expect(opts.env.LOBEHUB_SERVER).toBeUndefined();
  });

  it('returns undefined when the CLI output has no record', async () => {
    execFileMock.mockResolvedValue({ stdout: '{}' });

    expect(await service.uploadLocalFile('/tmp/none.png')).toBeUndefined();
  });

  it('propagates CLI failures (non-zero exit) to the caller', async () => {
    execFileMock.mockRejectedValue(new Error('No authentication found'));

    await expect(service.uploadLocalFile('/tmp/fail.png')).rejects.toThrow(
      'No authentication found',
    );
  });
});
