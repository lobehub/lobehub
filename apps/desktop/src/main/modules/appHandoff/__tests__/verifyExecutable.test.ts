import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { macBundlePath, verifyExecutable } from '../verifyExecutable';

const requirement =
  'anchor apple generic and identifier "com.example.native" and certificate leaf[subject.OU] = "TEAMID"';

describe('macOS', () => {
  it('finds the bundle of an executable', () => {
    expect(macBundlePath('/Applications/Native.app/Contents/MacOS/Native')).toBe(
      '/Applications/Native.app',
    );
    expect(macBundlePath('/usr/local/bin/native')).toBeUndefined();
  });

  it('accepts a bundle codesign verifies against the requirement', async () => {
    const run = vi.fn(async () => '');

    await expect(
      verifyExecutable(
        '/Applications/Native.app/Contents/MacOS/Native',
        { mac: { designatedRequirement: requirement } },
        { platform: 'darwin', run },
      ),
    ).resolves.toBe(true);
    expect(run).toHaveBeenCalledWith('codesign', [
      '--verify',
      '--strict',
      `-R=${requirement}`,
      '/Applications/Native.app',
    ]);
  });

  it('rejects when codesign fails, or outside a bundle', async () => {
    const run = vi.fn(async () => {
      throw new Error('code object is not signed at all');
    });
    const verification = { mac: { designatedRequirement: requirement } };

    await expect(
      verifyExecutable('/Applications/Native.app/Contents/MacOS/Native', verification, {
        platform: 'darwin',
        run,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyExecutable('/tmp/native', verification, { platform: 'darwin', run }),
    ).resolves.toBe(false);
  });
});

describe('Windows', () => {
  const verification = { win: { signerSubject: 'CN=Example Ltd, O=Example Ltd, C=US' } };

  it('accepts a valid signature from the listed signer', async () => {
    const run = async () => '{"status":"Valid","subject":"CN=Example Ltd, O=Example Ltd, C=US"}';
    await expect(
      verifyExecutable('C:\\Program Files\\Native\\native.exe', verification, {
        platform: 'win32',
        run,
      }),
    ).resolves.toBe(true);
  });

  it.each([
    ['another signer', '{"status":"Valid","subject":"CN=Someone Else"}'],
    [
      'an invalid signature',
      '{"status":"HashMismatch","subject":"CN=Example Ltd, O=Example Ltd, C=US"}',
    ],
    ['an unsigned file', '{"status":"NotSigned","subject":null}'],
  ])('rejects %s', async (_label, output) => {
    await expect(
      verifyExecutable('C:\\x.exe', verification, { platform: 'win32', run: async () => output }),
    ).resolves.toBe(false);
  });
});

describe.runIf(process.platform === 'linux')('Linux', () => {
  it('accepts an executable in a root-owned, non-writable install directory', async () => {
    await expect(
      verifyExecutable('/usr/bin/env', { linux: { exeDirs: ['/usr/bin'] } }),
    ).resolves.toBe(true);
  });

  it('rejects a user-writable copy even when its directory is listed', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'handoff-'));
    const exe = path.join(dir, 'native');
    await writeFile(exe, '#!/bin/sh\n', { mode: 0o755 });

    await expect(verifyExecutable(exe, { linux: { exeDirs: [dir] } })).resolves.toBe(false);
  });

  it('rejects an executable outside the listed directories', async () => {
    await expect(
      verifyExecutable('/usr/bin/env', { linux: { exeDirs: ['/opt/Native'] } }),
    ).resolves.toBe(false);
  });
});

it('cannot verify without metadata for this platform', async () => {
  await expect(
    verifyExecutable(
      '/usr/bin/env',
      { mac: { designatedRequirement: requirement } },
      { platform: 'linux' },
    ),
  ).resolves.toBe(false);
  await expect(verifyExecutable(undefined, { linux: { exeDirs: ['/usr/bin'] } })).resolves.toBe(
    false,
  );
});
