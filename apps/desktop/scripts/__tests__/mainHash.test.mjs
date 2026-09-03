import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { discoverFirstPartyNativeAddons } from '../../native-deps.config.mjs';
import {
  computeExternalModulesHash,
  createMainHash,
  createMainHashFromProbes,
} from '../mainHash.mjs';

const desktopRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

describe('mainHash', () => {
  it('creates the lineage hash from all platform probes without running builds', () => {
    const calls = [];
    const runProbe = (flag, platform, target) => {
      calls.push([flag, platform, target]);
      return sha256(`${platform}/${target}/bundle-v1`);
    };
    const before = createMainHashFromProbes({
      cloudRef: 'a'.repeat(40),
      publicKey: 'key-a',
      runProbe,
      version: '1.0.0',
    });

    expect(calls).toEqual([
      ['--bundle-probe', 'darwin', 'main'],
      ['--bundle-probe', 'darwin', 'preload'],
      ['--externals-probe', 'darwin', 'externals'],
      ['--bundle-probe', 'linux', 'main'],
      ['--bundle-probe', 'linux', 'preload'],
      ['--externals-probe', 'linux', 'externals'],
      ['--bundle-probe', 'win32', 'main'],
      ['--bundle-probe', 'win32', 'preload'],
      ['--externals-probe', 'win32', 'externals'],
    ]);
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    expect(
      createMainHashFromProbes({
        cloudRef: 'a'.repeat(40),
        publicKey: 'key-a',
        runProbe: (flag, platform, target) =>
          flag === '--bundle-probe' && platform === 'darwin' && target === 'main'
            ? sha256(`${platform}/${target}/bundle-v2`)
            : sha256(`${platform}/${target}/bundle-v1`),
        version: '1.0.0',
      }),
    ).not.toBe(before);
  });

  it('tracks externalized first-party native addon sources', async () => {
    process.env.npm_config_platform = 'darwin';
    const [addon] = discoverFirstPartyNativeAddons();
    delete process.env.npm_config_platform;

    const addonDir = realpathSync(path.join(desktopRoot, 'node_modules', addon.name));
    const probe = path.join(addonDir, `__mainhash-probe-${randomUUID()}.js`);
    const before = await computeExternalModulesHash('darwin');

    writeFileSync(probe, 'module.exports = {};\n');
    try {
      expect(await computeExternalModulesHash('darwin')).not.toBe(before);
    } finally {
      rmSync(probe, { force: true });
    }
    expect(await computeExternalModulesHash('darwin')).toBe(before);
  });

  it('tracks nested external dependency instances by resolved path', async () => {
    const id = randomUUID();
    const addonName = `@lobechat/mainhash-probe-${id}`;
    const dependencyName = `mainhash-probe-dep-${id}`;
    const addonDir = path.join(desktopRoot, 'node_modules', ...addonName.split('/'));
    const nestedDependencyDir = path.join(addonDir, 'node_modules', dependencyName);
    const rootDependencyDir = path.join(desktopRoot, 'node_modules', dependencyName);

    const writePackageJson = (dir, packageJson) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(packageJson)}\n`);
    };

    writePackageJson(addonDir, {
      dependencies: { [dependencyName]: '^2.0.0' },
      name: addonName,
      version: '1.0.0',
    });
    writeFileSync(path.join(addonDir, 'binding.gyp'), '{}\n');
    writePackageJson(rootDependencyDir, { name: dependencyName, version: '1.0.0' });
    writePackageJson(nestedDependencyDir, { name: dependencyName, version: '2.0.0' });

    try {
      const before = await computeExternalModulesHash('linux');

      writePackageJson(nestedDependencyDir, { name: dependencyName, version: '2.0.1' });
      expect(await computeExternalModulesHash('linux')).not.toBe(before);

      writePackageJson(nestedDependencyDir, { name: dependencyName, version: '2.0.0' });
      writePackageJson(rootDependencyDir, { name: dependencyName, version: '1.0.1' });
      expect(await computeExternalModulesHash('linux')).toBe(before);
    } finally {
      rmSync(addonDir, { force: true, recursive: true });
      rmSync(rootDependencyDir, { force: true, recursive: true });
    }
  });

  it('starts a new lineage when bundle metadata changes', () => {
    const base = {
      bundleHashes: [{ hash: 'a'.repeat(64), platform: 'darwin', target: 'main' }],
      cloudRef: 'a'.repeat(40),
      publicKey: 'key-a',
      version: '1.0.0',
    };
    const before = createMainHash(base);

    expect(createMainHash({ ...base, cloudRef: 'b'.repeat(40) })).not.toBe(before);
    expect(createMainHash({ ...base, publicKey: 'key-b' })).not.toBe(before);
    expect(createMainHash({ ...base, version: '1.0.1' })).not.toBe(before);
    expect(
      createMainHash({
        ...base,
        bundleHashes: [{ ...base.bundleHashes[0], hash: 'b'.repeat(64) }],
      }),
    ).not.toBe(before);
  });
});
