import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const builderRequire = createRequire(
  createRequire(require.resolve('electron-builder')).resolve('app-builder-lib'),
);
const { SnapCoreLegacy } = builderRequire('./targets/snap/coreLegacy');
const builderUtil = builderRequire('builder-util');
const electronGet = builderRequire('./util/electronGet');

it('keeps the shared Linux sandbox intact while excluding it from the template Snap', async () => {
  // Exercise the installed packager, not a version/source-string assertion. Older
  // builders deleted this shared file while AppImage/deb/rpm were still using it.
  const dir = await mkdtemp(path.join(tmpdir(), 'linux-packaging-'));
  const appOutDir = path.join(dir, 'linux-unpacked');
  const stageDir = path.join(dir, 'snap-stage');
  const templateDir = path.join(dir, 'snap-template');
  const sandboxPath = path.join(appOutDir, 'chrome-sandbox');
  const executablePath = path.join(appOutDir, 'lobehub');
  const compressor = path.join(dir, 'mksquashfs');

  try {
    await Promise.all([appOutDir, stageDir, templateDir].map((directory) => mkdir(directory)));
    await writeFile(sandboxPath, 'sandbox fixture', { mode: 0o755 });
    await writeFile(executablePath, 'app fixture');
    await writeFile(path.join(templateDir, 'desktop-init.sh'), '#!/bin/sh\n');
    const originalMode = (await stat(sandboxPath)).mode;

    // Only external downloads and process execution are stubbed. Staging,
    // filtering and all filesystem mutations use the real upstream code.
    vi.spyOn(electronGet, 'downloadBuilderToolset').mockResolvedValue(templateDir);
    vi.stubEnv('MKSQUASHFS_PATH', compressor);
    const compressionInputs = [];
    vi.spyOn(builderUtil, 'exec').mockImplementation(async (command, args) => {
      if (command === 'chmod') return '';
      expect(command).toBe(compressor);
      compressionInputs.push(args);
      // Other targets must still be able to read the helper at this point.
      expect(await readFile(sandboxPath, 'utf8')).toBe('sandbox fixture');
      return '';
    });

    const snap = new SnapCoreLegacy({ executableName: 'lobehub' }, {}, {});
    await snap.buildWithTemplate({
      appOutDir,
      artifactPath: path.join(dir, 'lobehub.snap'),
      compression: 'xz',
      extraAppArgs: [],
      snapArch: builderUtil.Arch.x64,
      stageDir,
    });

    expect(compressionInputs).toHaveLength(1);
    expect(compressionInputs[0]).toContain(executablePath);
    expect(compressionInputs[0]).not.toContain(sandboxPath);
    expect(await readFile(sandboxPath, 'utf8')).toBe('sandbox fixture');
    expect((await stat(sandboxPath)).mode).toBe(originalMode);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});
