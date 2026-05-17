import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { detectAllApps, detectApp } from '../detectors';
import { extractAllIcons } from '../iconExtractor';

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

// Mock node:child_process - execFile is wrapped via promisify, so the mock must
// expose execFile as the underlying callback-style function we can drive.
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

// Mock the icon extractor — detection tests should not depend on real icon
// extraction. The default returns an empty Map (no icons) which leaves the
// `icon` field absent from all detection results.
vi.mock('../iconExtractor', () => ({
  extractAllIcons: vi.fn(async () => new Map<string, string>()),
}));

const mockedAccess = vi.mocked(access);
const mockedExecFile = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;

interface ExecOutcome {
  code: number;
  error?: NodeJS.ErrnoException;
  stderr?: string;
  stdout?: string;
}

const respondExec = (outcome: ExecOutcome) => {
  mockedExecFile.mockImplementationOnce(
    (_file: string, _args: string[], _opts: unknown, cb: any) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (outcome.code === 0) {
        callback(null, outcome.stdout ?? '', outcome.stderr ?? '');
      } else {
        const err: NodeJS.ErrnoException & { stderr?: string } =
          outcome.error ?? new Error('exec failed');
        err.stderr = outcome.stderr ?? '';
        (err as any).code = outcome.code;
        callback(err, '', outcome.stderr ?? '');
      }
      return undefined as any;
    },
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('detectApp', () => {
  describe('appBundle strategy', () => {
    it('returns true when fs.access resolves for any path', async () => {
      mockedAccess.mockRejectedValueOnce(new Error('missing'));
      mockedAccess.mockResolvedValueOnce(undefined);

      const result = await detectApp('terminal', 'darwin');

      expect(result).toBe(true);
      expect(mockedAccess).toHaveBeenCalledTimes(2);
    });

    it('returns false when all paths reject', async () => {
      mockedAccess.mockRejectedValue(new Error('missing'));

      const result = await detectApp('vscode', 'darwin');

      expect(result).toBe(false);
    });
  });

  describe('commandV strategy', () => {
    it('returns true on exit 0', async () => {
      respondExec({ code: 0, stdout: '/usr/bin/zed' });

      const result = await detectApp('zed', 'linux');

      expect(result).toBe(true);
      expect(mockedExecFile).toHaveBeenCalledWith(
        '/bin/sh',
        ['-c', 'command -v "zed"'],
        expect.any(Function),
      );
    });

    it('returns false on non-zero exit', async () => {
      respondExec({ code: 1, stderr: 'not found' });

      const result = await detectApp('zed', 'linux');

      expect(result).toBe(false);
    });

    it('rejects unsafe binary names without spawning a shell', async () => {
      // We monkey-patch a registry entry transiently to inject a malicious binary.
      const registry = await import('../registry');
      const originalGhostty = registry.APP_REGISTRY.ghostty.detect.linux;
      registry.APP_REGISTRY.ghostty.detect.linux = {
        binary: 'foo; rm -rf /',
        type: 'commandV',
      };

      const result = await detectApp('ghostty', 'linux');

      expect(result).toBe(false);
      expect(mockedExecFile).not.toHaveBeenCalled();

      registry.APP_REGISTRY.ghostty.detect.linux = originalGhostty;
    });
  });

  describe('registryAppPaths strategy', () => {
    it('returns true on exit 0', async () => {
      respondExec({ code: 0, stdout: 'C:\\Program Files\\code.exe' });

      const result = await detectApp('vscode', 'win32');

      expect(result).toBe(true);
      expect(mockedExecFile).toHaveBeenCalledWith(
        'where',
        ['Code.exe'],
        { windowsHide: true },
        expect.any(Function),
      );
    });

    it('returns false on non-zero exit', async () => {
      respondExec({ code: 1, stderr: 'not found' });

      const result = await detectApp('vscode', 'win32');

      expect(result).toBe(false);
    });
  });

  it('returns false when platform has no detect entry for the app', async () => {
    const result = await detectApp('xcode', 'linux');

    expect(result).toBe(false);
    expect(mockedAccess).not.toHaveBeenCalled();
    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it('returns true for ALWAYS_INSTALLED entries without probing', async () => {
    const darwinFinder = await detectApp('finder', 'darwin');
    const win32Explorer = await detectApp('explorer', 'win32');
    const linuxFiles = await detectApp('files', 'linux');

    expect(darwinFinder).toBe(true);
    expect(win32Explorer).toBe(true);
    expect(linuxFiles).toBe(true);
    expect(mockedAccess).not.toHaveBeenCalled();
    expect(mockedExecFile).not.toHaveBeenCalled();
  });
});

describe('detectAllApps', () => {
  it('returns one entry per AppId regardless of platform', async () => {
    mockedAccess.mockRejectedValue(new Error('missing'));
    mockedExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: any) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      const err: NodeJS.ErrnoException = new Error('fail');
      callback(err, '', '');
      return undefined as any;
    });

    const apps = await detectAllApps('linux');

    const registry = await import('../registry');
    expect(apps.length).toBe(Object.keys(registry.APP_REGISTRY).length);
    // every entry has the three required fields
    for (const app of apps) {
      expect(app).toEqual(
        expect.objectContaining({
          displayName: expect.any(String),
          id: expect.any(String),
          installed: expect.any(Boolean),
        }),
      );
    }
  });

  it('marks unsupported-on-platform apps as not installed', async () => {
    mockedAccess.mockRejectedValue(new Error('missing'));
    mockedExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: any) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      const err: NodeJS.ErrnoException = new Error('fail');
      callback(err, '', '');
      return undefined as any;
    });

    const apps = await detectAllApps('linux');

    const xcode = apps.find((a) => a.id === 'xcode');
    expect(xcode?.installed).toBe(false);
  });

  it('marks ALWAYS_INSTALLED platform file manager as installed without probes', async () => {
    mockedAccess.mockRejectedValue(new Error('missing'));
    mockedExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: any) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      const err: NodeJS.ErrnoException = new Error('fail');
      callback(err, '', '');
      return undefined as any;
    });

    const apps = await detectAllApps('darwin');

    const finder = apps.find((a) => a.id === 'finder');
    expect(finder?.installed).toBe(true);
  });

  it('merges extracted icons onto installed apps only', async () => {
    mockedAccess.mockRejectedValue(new Error('missing'));
    mockedExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: any) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      const err: NodeJS.ErrnoException = new Error('fail');
      callback(err, '', '');
      return undefined as any;
    });

    vi.mocked(extractAllIcons).mockResolvedValueOnce(
      new Map([['finder', 'data:image/png;base64,FAKE']]),
    );

    const apps = await detectAllApps('darwin');

    const finder = apps.find((a) => a.id === 'finder');
    expect(finder?.icon).toBe('data:image/png;base64,FAKE');

    // not-installed apps must not have an icon field
    const xcode = apps.find((a) => a.id === 'xcode');
    expect(xcode?.installed).toBe(false);
    expect(xcode?.icon).toBeUndefined();
  });

  it('passes only installed AppIds to extractAllIcons', async () => {
    mockedAccess.mockRejectedValue(new Error('missing'));
    mockedExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: any) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      const err: NodeJS.ErrnoException = new Error('fail');
      callback(err, '', '');
      return undefined as any;
    });

    vi.mocked(extractAllIcons).mockResolvedValueOnce(new Map());

    await detectAllApps('darwin');

    expect(extractAllIcons).toHaveBeenCalledTimes(1);
    const [ids, platform] = vi.mocked(extractAllIcons).mock.calls[0];
    expect(platform).toBe('darwin');
    // only finder is ALWAYS_INSTALLED on darwin; all others fail probes
    expect(ids).toEqual(['finder']);
  });
});
