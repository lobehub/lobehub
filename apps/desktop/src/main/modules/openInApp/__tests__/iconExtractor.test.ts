import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, unlink } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetForTest, extractAllIcons, extractAppIcon } from '../iconExtractor';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  mkdtemp: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const mockedAccess = vi.mocked(access);
const mockedMkdtemp = vi.mocked(mkdtemp);
const mockedReadFile = vi.mocked(readFile);
const mockedUnlink = vi.mocked(unlink);
const mockedExecFile = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;

/**
 * Drives the next execFile call. The promisified callback signature is
 * `(error, stdout, stderr)`; non-error responses resolve with stdout.
 */
const respondExec = (
  match: { args?: string[]; binary: string },
  outcome: { error?: Error; stderr?: string; stdout?: string },
) => {
  mockedExecFile.mockImplementationOnce(
    (_file: string, _args: string[], _opts: unknown, cb: any) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (_file !== match.binary) {
        callback(new Error(`unexpected binary: ${_file}`), '', '');
        return undefined as any;
      }
      if (match.args && JSON.stringify(_args) !== JSON.stringify(match.args)) {
        callback(new Error(`unexpected args: ${JSON.stringify(_args)}`), '', '');
        return undefined as any;
      }
      if (outcome.error) {
        callback(outcome.error, '', outcome.stderr ?? '');
      } else {
        callback(null, outcome.stdout ?? '', outcome.stderr ?? '');
      }
      return undefined as any;
    },
  );
};

// Shorthand: tools-available probe passes (which plutil + which sips both 0).
const respondToolsAvailable = () => {
  // /usr/bin/which plutil
  respondExec({ binary: '/usr/bin/which' }, { stdout: '/usr/bin/plutil\n' });
  // /usr/bin/which sips
  respondExec({ binary: '/usr/bin/which' }, { stdout: '/usr/bin/sips\n' });
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedAccess.mockReset();
  mockedMkdtemp.mockReset();
  mockedReadFile.mockReset();
  mockedUnlink.mockReset();
  mockedExecFile.mockReset();
  mockedUnlink.mockResolvedValue(undefined);
  __resetForTest();
});

describe('extractAppIcon', () => {
  it('returns a data URL when plutil + sips succeed on darwin', async () => {
    respondToolsAvailable();
    mockedAccess.mockResolvedValueOnce(undefined); // bundle exists
    // plutil CFBundleIconFile lookup
    respondExec({ binary: 'plutil' }, { stdout: 'Code.icns\n' });
    mockedAccess.mockResolvedValueOnce(undefined); // .icns exists
    mockedMkdtemp.mockResolvedValueOnce('/tmp/lobehub-openinapp-test');
    // sips conversion
    respondExec({ binary: 'sips' }, { stdout: '' });
    mockedReadFile.mockResolvedValueOnce(Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG header

    const result = await extractAppIcon('vscode', 'darwin');

    expect(result).toBe(
      `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}`,
    );
  });

  it('appends .icns suffix when CFBundleIconFile has no extension', async () => {
    respondToolsAvailable();
    mockedAccess.mockResolvedValueOnce(undefined); // bundle exists
    respondExec({ binary: 'plutil' }, { stdout: 'Terminal\n' });
    mockedAccess.mockImplementationOnce(async (p: any) => {
      // .icns existence check — verify suffix appended
      if (typeof p === 'string' && p.endsWith('Terminal.icns')) return undefined;
      throw new Error('wrong path: ' + String(p));
    });
    mockedMkdtemp.mockResolvedValueOnce('/tmp/lobehub-openinapp-test');
    respondExec({ binary: 'sips' }, { stdout: '' });
    mockedReadFile.mockResolvedValueOnce(Buffer.from([0x89, 0x50]));

    const result = await extractAppIcon('terminal', 'darwin');

    expect(result).toBeDefined();
    expect(result!.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('falls back to the next path when the first bundle does not exist', async () => {
    respondToolsAvailable();
    // terminal has two candidate paths; first fails, second succeeds.
    mockedAccess.mockRejectedValueOnce(new Error('missing'));
    mockedAccess.mockResolvedValueOnce(undefined);
    respondExec({ binary: 'plutil' }, { stdout: 'Terminal\n' });
    mockedAccess.mockResolvedValueOnce(undefined);
    mockedMkdtemp.mockResolvedValueOnce('/tmp/lobehub-openinapp-test');
    respondExec({ binary: 'sips' }, { stdout: '' });
    mockedReadFile.mockResolvedValueOnce(Buffer.from([0xff]));

    const result = await extractAppIcon('terminal', 'darwin');

    expect(result).toBeDefined();
  });

  it('returns undefined when no bundle path exists', async () => {
    respondToolsAvailable();
    mockedAccess.mockRejectedValue(new Error('missing'));

    const result = await extractAppIcon('vscode', 'darwin');

    expect(result).toBeUndefined();
  });

  it('returns undefined when plutil cannot read CFBundleIconFile', async () => {
    respondToolsAvailable();
    mockedAccess.mockResolvedValueOnce(undefined);
    respondExec({ binary: 'plutil' }, { error: new Error('plutil: not found') });

    const result = await extractAppIcon('vscode', 'darwin');

    expect(result).toBeUndefined();
  });

  it('returns undefined when the resolved .icns is missing', async () => {
    respondToolsAvailable();
    mockedAccess.mockResolvedValueOnce(undefined); // bundle exists
    respondExec({ binary: 'plutil' }, { stdout: 'Code.icns\n' });
    mockedAccess.mockRejectedValueOnce(new Error('missing icns')); // .icns missing

    const result = await extractAppIcon('vscode', 'darwin');

    expect(result).toBeUndefined();
  });

  it('returns undefined when sips fails', async () => {
    respondToolsAvailable();
    mockedAccess.mockResolvedValueOnce(undefined);
    respondExec({ binary: 'plutil' }, { stdout: 'Code.icns\n' });
    mockedAccess.mockResolvedValueOnce(undefined);
    mockedMkdtemp.mockResolvedValueOnce('/tmp/lobehub-openinapp-test');
    respondExec({ binary: 'sips' }, { error: new Error('sips error') });

    const result = await extractAppIcon('vscode', 'darwin');

    expect(result).toBeUndefined();
  });

  it('returns undefined when the produced PNG is empty', async () => {
    respondToolsAvailable();
    mockedAccess.mockResolvedValueOnce(undefined);
    respondExec({ binary: 'plutil' }, { stdout: 'Code.icns\n' });
    mockedAccess.mockResolvedValueOnce(undefined);
    mockedMkdtemp.mockResolvedValueOnce('/tmp/lobehub-openinapp-test');
    respondExec({ binary: 'sips' }, { stdout: '' });
    mockedReadFile.mockResolvedValueOnce(Buffer.alloc(0));

    const result = await extractAppIcon('vscode', 'darwin');

    expect(result).toBeUndefined();
  });

  it('returns undefined when registry has no darwin entry for the app', async () => {
    respondToolsAvailable();
    const result = await extractAppIcon('explorer', 'darwin');
    expect(result).toBeUndefined();
    expect(mockedAccess).not.toHaveBeenCalled();
  });

  it('returns undefined on win32 (extractor is macOS-only)', async () => {
    const result = await extractAppIcon('vscode', 'win32');
    expect(result).toBeUndefined();
    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it('returns undefined on linux (extractor is macOS-only)', async () => {
    const result = await extractAppIcon('vscode', 'linux');
    expect(result).toBeUndefined();
    expect(mockedExecFile).not.toHaveBeenCalled();
  });
});

describe('extractAllIcons', () => {
  it('returns a map of only AppIds with successfully extracted icons', async () => {
    respondToolsAvailable();

    // vscode succeeds
    mockedAccess.mockResolvedValueOnce(undefined); // bundle
    respondExec({ binary: 'plutil' }, { stdout: 'Code.icns\n' });
    mockedAccess.mockResolvedValueOnce(undefined); // .icns
    mockedMkdtemp.mockResolvedValueOnce('/tmp/lobehub-openinapp-test');
    respondExec({ binary: 'sips' }, { stdout: '' });
    mockedReadFile.mockResolvedValueOnce(Buffer.from('vscode'));

    // cursor fails at bundle access (try all paths fail)
    mockedAccess.mockRejectedValue(new Error('missing'));

    // xcode succeeds — reset access for it
    // (subsequent calls to mockedAccess will keep returning rejection)
    // So this test exercises: success, fail-no-bundle.

    const map = await extractAllIcons(['vscode', 'cursor'], 'darwin');

    expect(map.has('vscode')).toBe(true);
    expect(map.has('cursor')).toBe(false);
  });

  it('returns empty map when input list is empty', async () => {
    const map = await extractAllIcons([], 'darwin');
    expect(map.size).toBe(0);
  });

  it('does not throw when extraction errors', async () => {
    respondToolsAvailable();
    mockedAccess.mockResolvedValueOnce(undefined);
    respondExec({ binary: 'plutil' }, { error: new Error('boom') });

    const map = await extractAllIcons(['vscode'], 'darwin');

    expect(map.size).toBe(0);
  });

  it('skips all when tools are unavailable', async () => {
    // /usr/bin/which plutil fails
    respondExec({ binary: '/usr/bin/which' }, { error: new Error('not found') });

    const map = await extractAllIcons(['vscode', 'terminal'], 'darwin');

    expect(map.size).toBe(0);
  });
});
