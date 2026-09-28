import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type App } from '@/core/App';

import RemoteFileUploadService, { describeUploadFailure } from '../remoteFileUploadSrv';

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

const { bridgeCloseMock, startSocksHttpBridgeMock } = vi.hoisted(() => {
  const bridgeCloseMock = vi.fn(async () => undefined);
  return {
    bridgeCloseMock,
    startSocksHttpBridgeMock: vi.fn(async () => ({
      close: bridgeCloseMock,
      url: 'http://lobehub:bridge-token@127.0.0.1:54321',
    })),
  };
});

vi.mock('@/modules/networkProxy/socksHttpBridge', () => ({
  startSocksHttpBridge: startSocksHttpBridgeMock,
}));

vi.mock('@/modules/cliEmbedding', () => ({
  resolveCliScript: () => '/app/resources/bin/lobe-cli.js',
}));

const mockRemoteServerConfigCtr = {
  getAccessToken: vi.fn(),
  getRemoteServerUrl: vi.fn(),
};

const mockStoreManager = {
  get: vi.fn(),
};

const mockApp = {
  getController: vi.fn(() => mockRemoteServerConfigCtr),
  storeManager: mockStoreManager,
} as unknown as App;

/** The shape `execFile` rejects with when the child exits non-zero. */
const execFileError = (filePath: string, stderr: string) =>
  Object.assign(
    new Error(
      `Command failed: /Applications/LobeHub.app/Contents/MacOS/LobeHub /app/resources/bin/lobe-cli.js file upload ${filePath} --json id,url\n${stderr}`,
    ),
    { code: 1, killed: false, signal: null, stderr, stdout: '' },
  );

describe('describeUploadFailure', () => {
  it('ignores the command line when classifying — a path is not an error', () => {
    const failure = describeUploadFailure(
      execFileError('/tmp/network-diagram.png', '[ERROR] Unsupported file type: image/x-foo\n'),
    );

    expect(failure).toEqual({ kind: 'unknown', reason: 'Unsupported file type: image/x-foo' });
  });

  it('does not read auth keywords out of the uploaded path', () => {
    const failure = describeUploadFailure(
      execFileError('/Users/me/login/401.png', '[ERROR] Unsupported file type: image/x-foo\n'),
    );

    expect(failure.kind).toBe('unknown');
  });

  it('does not read network keywords out of a path the CLI echoes back', () => {
    const failure = describeUploadFailure(
      execFileError(
        '/tmp/network-timeout.png',
        '[ERROR] File not found: /tmp/network-timeout.png\n',
      ),
    );

    expect(failure).toEqual({
      kind: 'unknown',
      reason: 'File not found: /tmp/network-timeout.png',
    });
  });

  it('still classifies the real CLI network error line', () => {
    const failure = describeUploadFailure(
      execFileError(
        '/tmp/cat.png',
        '[ERROR] Upload to storage failed: fetch failed (ECONNRESET)\n',
      ),
    );

    expect(failure).toEqual({
      kind: 'network',
      reason: 'Upload to storage failed: fetch failed (ECONNRESET)',
    });
  });

  it('still classifies storage quota and auth failures', () => {
    expect(
      describeUploadFailure(
        execFileError('/tmp/cat.png', '[ERROR] storage_block:upgrade_required\n'),
      ),
    ).toEqual({ kind: 'storage_quota', reason: 'storage_block:upgrade_required' });
    expect(
      describeUploadFailure(
        execFileError('/tmp/cat.png', '[ERROR] No authentication found. Run `lh login`.\n'),
      ).kind,
    ).toBe('auth');
  });
});

describe('RemoteFileUploadService.uploadLocalFile', () => {
  let service: RemoteFileUploadService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoteServerConfigCtr.getRemoteServerUrl.mockResolvedValue('https://server.example.com/');
    mockRemoteServerConfigCtr.getAccessToken.mockResolvedValue('token-abc');
    mockStoreManager.get.mockReturnValue(undefined);
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

  it('forwards the in-app network proxy to the `lh file upload` child process', async () => {
    mockStoreManager.get.mockImplementation((key: string) =>
      key === 'networkProxy'
        ? { enableProxy: true, proxyPort: '7890', proxyServer: '127.0.0.1', proxyType: 'http' }
        : undefined,
    );
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify({ id: 'file-3', url: 'https://files.example.com/c.png' }),
    });

    await service.uploadLocalFile('/tmp/cat.png');

    const [, , opts] = execFileMock.mock.calls[0];
    expect(opts.env.HTTPS_PROXY).toBe('http://127.0.0.1:7890');
    expect(opts.env.HTTP_PROXY).toBe('http://127.0.0.1:7890');
    // Node's fetch only honours HTTP(S)_PROXY when env-proxy mode is on.
    expect(opts.env.NODE_USE_ENV_PROXY).toBe('1');
  });

  it('bridges a SOCKS5 proxy to the child, which only honours HTTP(S)_PROXY', async () => {
    const socksConfig = {
      enableProxy: true,
      proxyBypass: 'localhost',
      proxyPort: '1080',
      proxyRequireAuth: false,
      proxyServer: '127.0.0.1',
      proxyType: 'socks5',
    };
    mockStoreManager.get.mockImplementation((key: string) =>
      key === 'networkProxy' ? socksConfig : undefined,
    );
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify({ id: 'file-5', url: 'https://files.example.com/e.png' }),
    });

    await service.uploadLocalFile('/tmp/e.png');

    expect(startSocksHttpBridgeMock).toHaveBeenCalledWith(socksConfig);
    const [, , opts] = execFileMock.mock.calls[0];
    expect(opts.env.HTTPS_PROXY).toBe('http://lobehub:bridge-token@127.0.0.1:54321');
    expect(opts.env.HTTP_PROXY).toBe('http://lobehub:bridge-token@127.0.0.1:54321');
    expect(opts.env.NO_PROXY).toBe('localhost');
    expect(opts.env.NODE_USE_ENV_PROXY).toBe('1');
    expect(bridgeCloseMock).toHaveBeenCalledTimes(1);
  });

  it('closes the SOCKS5 bridge when the upload fails', async () => {
    mockStoreManager.get.mockImplementation((key: string) =>
      key === 'networkProxy'
        ? { enableProxy: true, proxyPort: '1080', proxyServer: '127.0.0.1', proxyType: 'socks5' }
        : undefined,
    );
    execFileMock.mockRejectedValue(
      execFileError('/tmp/f.png', '[ERROR] storage_block:upgrade_required\n'),
    );

    await expect(service.uploadLocalFile('/tmp/f.png')).rejects.toThrow();
    expect(bridgeCloseMock).toHaveBeenCalledTimes(1);
  });

  describe('with proxy variables inherited from the parent environment', () => {
    const INHERITED = {
      all_proxy: 'socks5://inherited-all:1080',
      http_proxy: 'http://inherited-lower:3128',
      https_proxy: 'http://inherited-lower:3128',
      no_proxy: '*',
    };
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
      saved = Object.fromEntries(Object.keys(INHERITED).map((key) => [key, process.env[key]]));
      Object.assign(process.env, INHERITED);
    });

    afterEach(() => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    // Node's env-proxy mode reads `http_proxy || HTTP_PROXY` (and the same
    // for https_proxy / no_proxy), so an inherited lowercase value would win
    // over the in-app proxy unless both cases are set.
    it('overrides lowercase proxy variables with the in-app HTTP proxy', async () => {
      mockStoreManager.get.mockImplementation((key: string) =>
        key === 'networkProxy'
          ? {
              enableProxy: true,
              proxyBypass: 'localhost',
              proxyPort: '7890',
              proxyServer: '127.0.0.1',
              proxyType: 'http',
            }
          : undefined,
      );
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({ id: 'file-6', url: 'https://files.example.com/g.png' }),
      });

      await service.uploadLocalFile('/tmp/g.png');

      const [, , opts] = execFileMock.mock.calls[0];
      expect(opts.env.http_proxy).toBe('http://127.0.0.1:7890');
      expect(opts.env.https_proxy).toBe('http://127.0.0.1:7890');
      expect(opts.env.HTTP_PROXY).toBe('http://127.0.0.1:7890');
      expect(opts.env.HTTPS_PROXY).toBe('http://127.0.0.1:7890');
      expect(opts.env.no_proxy).toBe('localhost');
      expect(opts.env.NO_PROXY).toBe('localhost');
      expect(opts.env.all_proxy).toBeUndefined();
    });

    it('overrides lowercase proxy variables with the SOCKS5 bridge', async () => {
      mockStoreManager.get.mockImplementation((key: string) =>
        key === 'networkProxy'
          ? { enableProxy: true, proxyPort: '1080', proxyServer: '127.0.0.1', proxyType: 'socks5' }
          : undefined,
      );
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({ id: 'file-7', url: 'https://files.example.com/h.png' }),
      });

      await service.uploadLocalFile('/tmp/h.png');

      const [, , opts] = execFileMock.mock.calls[0];
      expect(opts.env.http_proxy).toBe('http://lobehub:bridge-token@127.0.0.1:54321');
      expect(opts.env.https_proxy).toBe('http://lobehub:bridge-token@127.0.0.1:54321');
      // No bypass configured in-app — an inherited `no_proxy=*` must not
      // silently route every request around the bridge.
      expect(opts.env.no_proxy).toBeUndefined();
      expect(opts.env.NO_PROXY).toBeUndefined();
      expect(opts.env.all_proxy).toBeUndefined();
      expect(opts.env.ALL_PROXY).toBeUndefined();
    });

    it('leaves inherited proxy variables alone when the in-app proxy is off', async () => {
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({ id: 'file-8', url: 'https://files.example.com/i.png' }),
      });

      await service.uploadLocalFile('/tmp/i.png');

      const [, , opts] = execFileMock.mock.calls[0];
      expect(opts.env.http_proxy).toBe('http://inherited-lower:3128');
      expect(opts.env.no_proxy).toBe('*');
    });
  });

  describe('upload deadline', () => {
    // readFile's client deadline is 30s; the upload (all attempts included)
    // must settle before it so the model gets the fallback, not a timeout.
    let now: number;

    beforeEach(() => {
      now = 1_000_000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('caps every attempt inside the readFile deadline', async () => {
      execFileMock.mockResolvedValue({
        stdout: JSON.stringify({ id: 'file-9', url: 'https://files.example.com/j.png' }),
      });

      await service.uploadLocalFile('/tmp/j.png');

      const [, , opts] = execFileMock.mock.calls[0];
      expect(opts.timeout).toBeLessThan(30_000);
    });

    it('does not start a retry that cannot finish before the deadline', async () => {
      execFileMock.mockImplementation(async () => {
        // The first attempt fails late — 20s in.
        now += 20_000;
        throw new Error('[ERROR] fetch failed: ECONNRESET');
      });

      await expect(service.uploadLocalFile('/tmp/k.png')).rejects.toThrow('ECONNRESET');
      expect(execFileMock).toHaveBeenCalledTimes(1);
    });

    it('gives a retry only the time left in the budget', async () => {
      execFileMock
        .mockImplementationOnce(async () => {
          now += 5000;
          throw new Error('[ERROR] fetch failed: ECONNRESET');
        })
        .mockResolvedValue({
          stdout: JSON.stringify({ id: 'file-10', url: 'https://files.example.com/l.png' }),
        });

      await service.uploadLocalFile('/tmp/l.png');

      expect(execFileMock).toHaveBeenCalledTimes(2);
      const [, , second] = execFileMock.mock.calls[1];
      // The retry starts 5s in and must still end before readFile's deadline.
      expect(5000 + second.timeout).toBeLessThan(30_000);
    });
  });

  it('does not retry a non-network failure whose path mentions "network"', async () => {
    execFileMock.mockRejectedValue(
      execFileError('/tmp/network-diagram.png', '[ERROR] Unsupported file type: image/x-foo\n'),
    );

    await expect(service.uploadLocalFile('/tmp/network-diagram.png')).rejects.toThrow(
      'Unsupported file type',
    );
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient network failure', async () => {
    execFileMock
      .mockRejectedValueOnce(new Error('[ERROR] fetch failed: ECONNRESET'))
      .mockResolvedValue({
        stdout: JSON.stringify({ id: 'file-4', url: 'https://files.example.com/d.png' }),
      });

    const record = await service.uploadLocalFile('/tmp/d.png');

    expect(record).toEqual({ id: 'file-4', url: 'https://files.example.com/d.png' });
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a storage quota rejection', async () => {
    execFileMock.mockRejectedValue(new Error('[ERROR] storage_block:upgrade_required'));

    await expect(service.uploadLocalFile('/tmp/full.png')).rejects.toThrow(
      'storage_block:upgrade_required',
    );
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('propagates CLI failures (non-zero exit) to the caller', async () => {
    execFileMock.mockRejectedValue(new Error('No authentication found'));

    await expect(service.uploadLocalFile('/tmp/fail.png')).rejects.toThrow(
      'No authentication found',
    );
  });
});
