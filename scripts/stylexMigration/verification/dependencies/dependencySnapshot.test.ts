// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  childEnvironment,
  fingerprintInstalledDependencies,
  restoreDependencies,
  validateDependencyLock,
} from './dependencySnapshot';

const owned: string[] = [];
const directory = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stylex-dependency-test-'));
  owned.push(root);
  return root;
};
afterEach(async () => {
  for (const root of owned.splice(0)) await rm(root, { force: true, recursive: true });
});

describe('immutable dependency evidence', () => {
  it('requires a complete graph and registry integrity rather than accepting module metadata alone', () => {
    expect(() => validateDependencyLock('nodeLinker: isolated')).toThrow(
      'DEPENDENCY_LOCK_GRAPH_MISSING',
    );
    expect(() =>
      validateDependencyLock(
        'lockfileVersion: "9.0"\nimporters: {.: {}}\npackages: {x@1.0.0: {resolution: {}}}',
      ),
    ).toThrow('DEPENDENCY_INTEGRITY_MISSING');
    const sri = 'sha512-' + Buffer.alloc(64).toString('base64');
    expect(
      validateDependencyLock(
        `lockfileVersion: "9.0"\nimporters: {.: {}}\npackages: {x@1.0.0: {resolution: {integrity: "${sri}"}}}`,
      ),
    ).toMatchObject({ importers: ['.'], packageCount: 1 });
  });

  it('does not inherit authentication, Node hooks, home or npm configuration', () => {
    const env = childEnvironment('/task');
    expect(env).not.toHaveProperty('HOME');
    expect(env).not.toHaveProperty('GH_TOKEN');
    expect(env).not.toHaveProperty('NODE_OPTIONS');
    expect(env).not.toHaveProperty('npm_config_userconfig');
    expect(env.XDG_CONFIG_HOME).toBe('/task/.stylex-tools/config');
  });

  it('hashes actual installed bytes and rejects links outside the snapshot', async () => {
    const root = await directory();
    const modules = path.join(root, 'node_modules/package');
    await mkdir(modules, { recursive: true });
    await writeFile(path.join(modules, 'index.js'), 'export const x=1');
    const first = await fingerprintInstalledDependencies(root);
    await writeFile(path.join(modules, 'index.js'), 'export const x=2');
    expect((await fingerprintInstalledDependencies(root)).sha256).not.toBe(first.sha256);
    await symlink(tmpdir(), path.join(root, 'node_modules/escape'));
    await expect(fingerprintInstalledDependencies(root)).rejects.toThrow('DEPENDENCY_LINK_ESCAPE');
  });
});

describe('real offline pnpm restore', () => {
  const fixture = async () => {
    const root = await directory();
    await mkdir(path.join(root, 'packages/local'), { recursive: true });
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        dependencies: { 'stylex-local-fixture': 'workspace:*' },
        name: 'verification-root',
        packageManager: 'pnpm@12.4.1',
        private: true,
        scripts: { postinstall: 'touch MUST_NOT_RUN' },
      }),
    );
    await writeFile(
      path.join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\nlockfile: false\n',
    );
    await writeFile(
      path.join(root, 'packages/local/package.json'),
      JSON.stringify({
        bin: { 'stylex-local-cli': 'cli.js' },
        main: 'index.js',
        name: 'stylex-local-fixture',
        version: '1.0.0',
      }),
    );
    await writeFile(path.join(root, 'packages/local/index.js'), 'module.exports=42');
    await writeFile(
      path.join(root, 'packages/local/cli.js'),
      '#!/usr/bin/env node\nconsole.log(42);',
    );
    return root;
  };
  const inputs = ['package.json', 'pnpm-workspace.yaml', 'packages/local/package.json'];

  it('generates a temporary lock then restores both sides frozen without running lifecycle scripts', async () => {
    const base = await fixture();
    const candidate = await fixture();
    const store = await directory();
    const options = { allowNetwork: false, pnpm: 'pnpm', store };
    const first = await restoreDependencies(base, inputs, options);
    const second = await restoreDependencies(candidate, inputs, options, first.lock);
    expect(second.snapshot.lockHash).toBe(first.snapshot.lockHash);
    expect(second.snapshot.content.sha256).toBe(first.snapshot.content.sha256);
    expect(second.snapshot.content.rawSha256).not.toBe(first.snapshot.content.rawSha256);
    expect(
      second.snapshot.content.normalizations.some(
        (entry) => entry.kind === 'pnpm-generated-launcher-location',
      ),
    ).toBe(true);
    expect(second.snapshot.snapshotHash).toBe(first.snapshot.snapshotHash);
    await expect(readFile(path.join(base, 'MUST_NOT_RUN'))).rejects.toThrow();
    expect(
      await readFile(path.join(candidate, 'node_modules/stylex-local-fixture/index.js'), 'utf8'),
    ).toContain('42');
  }, 30_000);

  it('refuses mismatched package-manager versions and executable config dependencies', async () => {
    const root = await fixture();
    await writeFile(
      path.join(root, 'pnpm-workspace.yaml'),
      'configDependencies: {"malicious": "1.0.0"}\n',
    );
    await expect(
      restoreDependencies(root, inputs, { allowNetwork: false, pnpm: 'pnpm', store: root }),
    ).rejects.toThrow('DEPENDENCY_CONFIG_UNSUPPORTED');
  });

  it('does not turn a pre-existing node_modules into trusted dependency evidence', async () => {
    const root = await fixture();
    await mkdir(path.join(root, 'node_modules'));
    await expect(
      restoreDependencies(root, inputs, { allowNetwork: false, pnpm: 'pnpm', store: root }),
    ).rejects.toThrow('DEPENDENCY_TARGET_NOT_CLEAN');
  });

  it('rejects non-registry specifiers even in overrides before invoking pnpm', async () => {
    const root = await fixture();
    await writeFile(
      path.join(root, 'pnpm-workspace.yaml'),
      'overrides:\n  x: github:someone/private\n',
    );
    await expect(
      restoreDependencies(root, inputs, { allowNetwork: false, pnpm: 'pnpm', store: root }),
    ).rejects.toThrow('DEPENDENCY_PROTOCOL_UNSUPPORTED');
  });

  it('keeps offline cache misses as errors and saves the failed resolution log', async () => {
    const root = await fixture();
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    manifest.dependencies = { 'stylex-verifier-offline-cache-miss-fixture': '0.0.0' };
    await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
    await expect(
      restoreDependencies(root, inputs, {
        allowNetwork: false,
        pnpm: 'pnpm',
        store: await directory(),
      }),
    ).rejects.toThrow('DEPENDENCY_RESOLVE_FAILED');
    expect(await readFile(path.join(root, '.stylex-tools/resolve.log'), 'utf8')).toContain(
      'stylex-verifier-offline-cache-miss-fixture',
    );
  });

  it('validates root manifest overrides before allowing registry resolution', async () => {
    const root = await fixture();
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    manifest.overrides = { x: 'https://example.invalid/package.tgz' };
    await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
    await expect(
      restoreDependencies(root, inputs, {
        allowNetwork: false,
        pnpm: 'pnpm',
        store: root,
      }),
    ).rejects.toThrow('DEPENDENCY_PROTOCOL_UNSUPPORTED');
  });

  it('does not let a snapshot select a different package-manager executable version', async () => {
    const root = await fixture();
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    manifest.packageManager = 'pnpm@10.0.0';
    await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
    await expect(
      restoreDependencies(root, inputs, { allowNetwork: false, pnpm: 'pnpm', store: root }),
    ).rejects.toThrow('PNPM_ADAPTER_VERSION_UNSUPPORTED');
  });
});
