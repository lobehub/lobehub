import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findCheck, makeContext, runCheck } from '../testUtils';
import { runtimeChecks } from './runtime';

const home = vi.hoisted(() => ({ dir: '' }));
const pkg = vi.hoisted(() => ({ engine: '>=22.15' as string | undefined }));
const zlib = vi.hoisted(() => ({ hasZstd: true }));
const latest = vi.hoisted(() => ({ value: '0.0.55' as string | Error }));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, default: { ...actual, homedir: () => home.dir }, homedir: () => home.dir };
});

// Getters, not values: the factory runs once, but each test flips `hasZstd`.
vi.mock('node:zlib', () => ({
  default: {
    get zstdDecompress() {
      return zlib.hasZstd ? () => {} : undefined;
    },
  },
}));

vi.mock('../../pkg', () => ({
  get cliNodeEngine() {
    return pkg.engine;
  },
  cliPackageName: '@lobehub/cli',
  cliVersion: '0.0.55',
}));

vi.mock('../../commands/update', () => ({
  detectPackageManager: () => 'npm',
  fetchLatestVersion: async () => {
    if (latest.value instanceof Error) throw latest.value;
    return latest.value;
  },
  isNewerVersion: (a: string, b: string) => a !== b,
}));

vi.mock('../../auth/source', () => ({
  credentialsPath: () => path.join(home.dir, '.lobehub', 'credentials.json'),
}));
vi.mock('../../constants/identity', () => ({ resolveCliDirName: () => '.lobehub' }));

describe('runtime.node', () => {
  beforeEach(() => {
    pkg.engine = '>=22.15';
    zlib.hasZstd = true;
  });

  it('fails a node older than the CLI can run on', async () => {
    pkg.engine = '>=999.0.0';

    const outcome = await runCheck(runtimeChecks, 'runtime.node');

    expect(outcome.status).toBe('fail');
    expect(outcome.fix).toContain('nvm install 22');
  });

  it('fails a node that satisfies the range but lacks the zlib API the CLI imports', async () => {
    zlib.hasZstd = false;

    const outcome = await runCheck(runtimeChecks, 'runtime.node');

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('zlib.zstdDecompress');
  });

  it('passes on a supported node', async () => {
    const outcome = await runCheck(runtimeChecks, 'runtime.node');

    expect(outcome.status).toBe('ok');
    expect(outcome.evidence).toMatchObject({ hasZstd: true });
  });
});

describe('runtime.home', () => {
  beforeEach(() => {
    home.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-home-'));
  });

  afterEach(() => {
    fs.rmSync(home.dir, { force: true, recursive: true });
  });

  it('accepts a home that does not exist yet', async () => {
    const outcome = await runCheck(runtimeChecks, 'runtime.home');

    expect(outcome.status).toBe('ok');
    expect(outcome.detail).toContain('does not exist yet');
  });

  it('fails an unparseable settings.json and moves it aside under --fix', async () => {
    const dir = path.join(home.dir, '.lobehub');
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json', { mode: 0o600 });

    const check = findCheck(runtimeChecks, 'runtime.home');
    const outcome = await runCheck(runtimeChecks, 'runtime.home');
    expect(outcome.status).toBe('fail');

    await check.repair!(makeContext({ fix: true }), {
      ...outcome,
      durationMs: 0,
      group: 'runtime',
      id: 'runtime.home',
      title: '',
    });

    expect(fs.existsSync(path.join(dir, 'settings.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'settings.json.bak'))).toBe(true);
  });

  it('does not offer to move aside a settings file it merely cannot read', async () => {
    // Unreadable is not corrupt — the content may be perfectly valid.
    if (process.getuid?.() === 0) return; // root reads mode-000 files
    const dir = path.join(home.dir, '.lobehub');
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'settings.json'), '{"serverUrl":"https://lobe.internal"}', {
      mode: 0o000,
    });

    const outcome = await runCheck(runtimeChecks, 'runtime.home');

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('cannot be read');
    expect(outcome.evidence?.repairable).toBeUndefined();
    fs.chmodSync(path.join(dir, 'settings.json'), 0o600);
  });

  it('warns about a world-readable config directory', async () => {
    fs.mkdirSync(path.join(home.dir, '.lobehub'), { mode: 0o755 });

    const outcome = await runCheck(runtimeChecks, 'runtime.home');

    expect(outcome.status).toBe('warn');
    expect(outcome.fix).toContain('chmod go-rwx');
  });
});

describe('runtime.latest budget', () => {
  it('always gives the runner more time than its own registry deadline', () => {
    // Otherwise a stalled registry becomes a runner failure instead of a warning.
    const check = findCheck(runtimeChecks, 'runtime.latest');
    for (const timeoutMs of [50, 1000, 300_000])
      expect(check.budgetMs!(makeContext({ timeoutMs }).options)).toBeGreaterThan(timeoutMs);
  });
});

describe('runtime.latest', () => {
  beforeEach(() => {
    home.dir = os.tmpdir();
  });

  it('warns about a newer published version without failing', async () => {
    latest.value = '0.0.99';

    const outcome = await runCheck(runtimeChecks, 'runtime.latest');

    expect(outcome.status).toBe('warn');
    expect(outcome.fix).toBe('lh update');
  });

  it('degrades to a warning when the registry is unreachable', async () => {
    latest.value = new Error('ENOTFOUND registry.npmjs.org');

    const outcome = await runCheck(runtimeChecks, 'runtime.latest');

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('Could not reach the npm registry');
  });
});
