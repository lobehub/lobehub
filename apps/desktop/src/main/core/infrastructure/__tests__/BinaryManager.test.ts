import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App as AppCore } from '../../App';
import type { BinarySpec, BinaryStatus } from '../BinaryManager';

const { mockUserDataDir, setUserDataDir } = vi.hoisted(() => {
  const ref = { current: '' };
  return {
    mockUserDataDir: ref,
    setUserDataDir: (dir: string) => {
      ref.current = dir;
    },
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => {
      if (key === 'userData') return mockUserDataDir.current;
      throw new Error(`unexpected app.getPath('${key}') in test`);
    },
  },
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Import AFTER the mocks so the singleton logger and electron stub are wired.
const { BinaryManager, defineCommandBinary } = await import('../BinaryManager');

const stubApp = {} as AppCore;

const writeInstalledMarker = async (
  cacheRoot: string,
  name: string,
  version: string,
  fileContent = 'fake-binary',
) => {
  const dir = path.join(cacheRoot, name, version);
  await mkdir(dir, { recursive: true });
  const fileName = process.platform === 'win32' ? `${name}.exe` : name;
  await writeFile(path.join(dir, fileName), fileContent, 'utf8');
  await writeFile(path.join(cacheRoot, name, '.installed'), version, 'utf8');
  return path.join(dir, fileName);
};

let workspace: string;
let cacheRoot: string;
let originalPath: string | undefined;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'binmgr-'));
  cacheRoot = path.join(workspace, 'bin');
  setUserDataDir(workspace);
  originalPath = process.env.PATH;
});

afterEach(async () => {
  process.env.PATH = originalPath;
  await rm(workspace, { force: true, recursive: true });
});

describe('BinaryManager', () => {
  describe('register / getRegistered / isRegistered', () => {
    it('records specs and categories, surfaces manageable flag', () => {
      const mgr = new BinaryManager(stubApp);
      const a: BinarySpec = {
        detect: async () => ({ available: false }),
        name: 'a',
      };
      const b: BinarySpec = {
        detect: async () => ({ available: false }),
        manage: { pinnedVersion: '1.0.0', release: () => 'https://example.com/b' },
        name: 'b',
      };
      mgr.register(a, 'content-search');
      mgr.register(b, 'browser-automation');

      expect(mgr.getRegistered()).toEqual(['a', 'b']);
      expect(mgr.isRegistered('a')).toBe(true);
      expect(mgr.isRegistered('missing')).toBe(false);
      expect(mgr.getCategories()).toEqual(['content-search', 'browser-automation']);
      expect(mgr.getInCategory('browser-automation').map((s) => s.name)).toEqual(['b']);
    });
  });

  describe('detect', () => {
    it('caches detect() and stamps `source: system` for PATH-resolved binaries', async () => {
      const mgr = new BinaryManager(stubApp);
      const detect = vi.fn<() => Promise<BinaryStatus>>().mockResolvedValue({
        available: true,
        path: '/usr/local/bin/foo',
        version: '1.0',
      });
      mgr.register({ detect, name: 'foo' }, 'content-search');

      const first = await mgr.detect('foo');
      const second = await mgr.detect('foo');

      expect(first.source).toBe('system');
      expect(first.manageable).toBe(false);
      expect(detect).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it('prefers the managed cache over the spec detect() result', async () => {
      const installedPath = await writeInstalledMarker(cacheRoot, 'foo', '2.3.4');
      const mgr = new BinaryManager(stubApp);
      const detect = vi.fn<() => Promise<BinaryStatus>>().mockResolvedValue({
        available: true,
        path: '/usr/local/bin/foo',
        version: '1.0.0',
      });
      mgr.register(
        {
          detect,
          manage: { pinnedVersion: '2.3.4', release: () => 'https://example.com/foo' },
          name: 'foo',
        },
        'browser-automation',
      );

      const status = await mgr.detect('foo');

      expect(status.available).toBe(true);
      expect(status.source).toBe('managed');
      expect(status.path).toBe(installedPath);
      expect(status.version).toBe('2.3.4');
      expect(status.manageable).toBe(true);
      // Managed cache shortcut means we never bothered the spec's detect().
      expect(detect).not.toHaveBeenCalled();
    });

    it('marks unavailable + manageable when neither managed cache nor PATH has the binary', async () => {
      const mgr = new BinaryManager(stubApp);
      mgr.register(
        {
          detect: async () => ({ available: false }),
          manage: { pinnedVersion: '1.0.0', release: () => 'https://example.com/foo' },
          name: 'foo',
        },
        'browser-automation',
      );

      const status = await mgr.detect('foo');

      expect(status.available).toBe(false);
      expect(status.manageable).toBe(true);
      expect(status.source).toBeUndefined();
    });
  });

  describe('findManagedPath / readInstalledVersion', () => {
    it('reads back the latest installed marker', async () => {
      const expected = await writeInstalledMarker(cacheRoot, 'foo', '9.9.9');
      const mgr = new BinaryManager(stubApp);
      mgr.register({ detect: async () => ({ available: false }), name: 'foo' });

      await expect(mgr.findManagedPath('foo')).resolves.toBe(expected);
      await expect(mgr.readInstalledVersion('foo')).resolves.toBe('9.9.9');
    });

    it('returns null when the marker points at a missing file', async () => {
      const dir = path.join(cacheRoot, 'foo', '1.0.0');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(cacheRoot, 'foo', '.installed'), '1.0.0', 'utf8');
      // intentionally do NOT create the executable file

      const mgr = new BinaryManager(stubApp);
      mgr.register({ detect: async () => ({ available: false }), name: 'foo' });

      await expect(mgr.findManagedPath('foo')).resolves.toBeNull();
    });

    it('returns null when no install marker exists', async () => {
      const mgr = new BinaryManager(stubApp);
      mgr.register({ detect: async () => ({ available: false }), name: 'foo' });

      await expect(mgr.findManagedPath('foo')).resolves.toBeNull();
      await expect(mgr.readInstalledVersion('foo')).resolves.toBeNull();
    });
  });

  describe('augmentPath', () => {
    it('appends each installed managed dir to PATH, idempotent across runs', async () => {
      const installed = await writeInstalledMarker(cacheRoot, 'foo', '1.2.3');
      const mgr = new BinaryManager(stubApp);
      mgr.register({ detect: async () => ({ available: false }), name: 'foo' });
      mgr.register({ detect: async () => ({ available: false }), name: 'bar' }); // no install

      const before = process.env.PATH ?? '';
      await mgr.augmentPath();

      const sep = process.platform === 'win32' ? ';' : ':';
      const installDir = path.dirname(installed);
      expect((process.env.PATH ?? '').split(sep)).toContain(installDir);

      // Second call must not duplicate the entry.
      await mgr.augmentPath();
      const segments = (process.env.PATH ?? '').split(sep);
      expect(segments.filter((s) => s === installDir)).toHaveLength(1);
      expect(process.env.PATH).toContain(before);
    });
  });

  describe('ensure', () => {
    it('returns the managed path when one is already installed', async () => {
      const installed = await writeInstalledMarker(cacheRoot, 'foo', '0.1.0');
      const mgr = new BinaryManager(stubApp);
      mgr.register(
        {
          detect: async () => ({ available: false }),
          manage: { pinnedVersion: '0.1.0', release: () => 'https://example.com/foo' },
          name: 'foo',
        },
        'browser-automation',
      );

      await expect(mgr.ensure('foo')).resolves.toBe(installed);
    });

    it('returns the system PATH path when no managed copy exists', async () => {
      const mgr = new BinaryManager(stubApp);
      mgr.register(
        {
          detect: async () => ({ available: true, path: '/usr/bin/foo', version: '1.0' }),
          manage: { pinnedVersion: '2.0.0', release: () => 'https://example.com/foo' },
          name: 'foo',
        },
        'browser-automation',
      );

      await expect(mgr.ensure('foo')).resolves.toBe('/usr/bin/foo');
    });

    it('throws when the binary is unavailable AND has no manage spec', async () => {
      const mgr = new BinaryManager(stubApp);
      mgr.register(
        {
          detect: async () => ({ available: false }),
          name: 'foo',
        },
        'content-search',
      );

      await expect(mgr.ensure('foo')).rejects.toThrow(
        /not available on the system PATH and does not opt into management/i,
      );
    });

    it('de-dupes concurrent ensure() calls into a single install', async () => {
      const mgr = new BinaryManager(stubApp);
      const install = vi
        .spyOn(mgr, 'install')
        .mockImplementation(async (name: string) => `/managed/${name}`);

      mgr.register(
        {
          detect: async () => ({ available: false }),
          manage: { pinnedVersion: '1.0.0', release: () => 'https://example.com/foo' },
          name: 'foo',
        },
        'browser-automation',
      );

      const [a, b, c] = await Promise.all([
        mgr.ensure('foo'),
        mgr.ensure('foo'),
        mgr.ensure('foo'),
      ]);

      expect(a).toBe('/managed/foo');
      expect(b).toBe(a);
      expect(c).toBe(a);
      expect(install).toHaveBeenCalledTimes(1);
    });
  });

  describe('install', () => {
    it('throws for unmanageable binaries', async () => {
      const mgr = new BinaryManager(stubApp);
      mgr.register({ detect: async () => ({ available: false }), name: 'foo' });
      await expect(mgr.install('foo')).rejects.toThrow(/not manageable/i);
    });
  });

  describe('upgrade', () => {
    it('no-ops when the requested version matches the installed marker', async () => {
      const installed = await writeInstalledMarker(cacheRoot, 'foo', '5.5.5');
      const mgr = new BinaryManager(stubApp);
      const installSpy = vi.spyOn(mgr, 'install');
      mgr.register(
        {
          detect: async () => ({ available: false }),
          manage: { pinnedVersion: '5.5.5', release: () => 'https://example.com/foo' },
          name: 'foo',
        },
        'browser-automation',
      );

      await expect(mgr.upgrade('foo', '5.5.5')).resolves.toBe(installed);
      expect(installSpy).not.toHaveBeenCalled();
    });
  });
});

describe('defineCommandBinary', () => {
  it('passes manage spec through unchanged', () => {
    const manage = {
      pinnedVersion: '1.0.0',
      release: () => 'https://example.com',
    };
    const spec = defineCommandBinary('demo', { description: 'demo', manage, priority: 7 });
    expect(spec.name).toBe('demo');
    expect(spec.description).toBe('demo');
    expect(spec.priority).toBe(7);
    expect(spec.manage).toBe(manage);
  });
});
