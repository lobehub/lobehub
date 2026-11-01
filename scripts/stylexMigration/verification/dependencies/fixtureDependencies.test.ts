// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';
import { parse } from 'yaml';

import { prepareFixtureDependencies } from './fixtureDependencies';

const owned: string[] = [];
afterEach(async () => {
  for (const root of owned.splice(0)) await rm(root, { force: true, recursive: true });
});

const fixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stylex-capsule-test-'));
  owned.push(root);
  const dependencies = Object.fromEntries(
    [
      '@lobehub/ui',
      '@rolldown/plugin-transform-imports',
      '@stylexjs/stylex',
      '@stylexjs/unplugin',
      '@vitejs/plugin-react',
      'motion',
      'i18next',
      'react',
      'react-dom',
      'react-i18next',
      'vite',
    ].map((name) => [name, '1.0.0']),
  );
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      dependencies,
      packageManager: 'pnpm@12.4.1',
    }),
  );
  await writeFile(
    path.join(root, 'pnpm-workspace.yaml'),
    'packages: [packages/*]\noverrides: {react: 1.0.0}\npatchedDependencies: {react: patches/react.patch}\n',
  );
  await mkdir(path.join(root, 'patches'));
  await writeFile(path.join(root, 'patches/react.patch'), 'reviewed patch');
  await mkdir(path.join(root, 'packages/unrelated'), { recursive: true });
  await writeFile(
    path.join(root, 'packages/unrelated/package.json'),
    JSON.stringify({ dependencies: { xlsx: 'https://example.invalid/unrelated.tgz' } }),
  );
  return root;
};
const inputs = [
  'package.json',
  'pnpm-workspace.yaml',
  'patches/react.patch',
  'packages/unrelated/package.json',
];

it('preserves source inputs and resolution policy, excludes unrelated importers and records the peer-context gap', async () => {
  const root = await fixture();
  const original = await readFile(path.join(root, 'package.json'), 'utf8');
  const result = await prepareFixtureDependencies(root, inputs, 'LiteTable');
  const config = parse(await readFile(path.join(result.directory, 'pnpm-workspace.yaml'), 'utf8'));
  expect(config).toMatchObject({ overrides: { react: '1.0.0' }, packages: ['.'] });
  expect(await readFile(path.join(result.directory, 'patches/react.patch'), 'utf8')).toBe(
    'reviewed patch',
  );
  expect(result.evidence.reasonCodes).toContain('FIXTURE_CAPSULE_WORKSPACE_PEER_CONTEXT_UNPROVEN');
  expect(result.evidence.gateEligible).toBe(false);
  expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(original);
  const second = await fixture();
  expect((await prepareFixtureDependencies(second, inputs, 'LiteTable')).hash).toBe(result.hash);
});

it('does not silently discard root package-manager config', async () => {
  const root = await fixture();
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  manifest.pnpm = { hooks: {} };
  await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
  await expect(prepareFixtureDependencies(root, inputs, 'LiteTable')).rejects.toThrow(
    'ROOT_PNPM_CONFIG',
  );
});

it('unions only selected fixture roots and preserves source versions deterministically', async () => {
  const single = await fixture();
  const singleResult = await prepareFixtureDependencies(single, inputs, 'LiteTable');
  expect(Object.keys(singleResult.evidence.roots)).toHaveLength(9);
  const first = await fixture();
  const result = await prepareFixtureDependencies(first, inputs, ['StatusBar', 'DotsLoading']);
  expect(result.evidence.fixtureIds).toEqual(['DotsLoading', 'StatusBar']);
  expect(result.evidence.roots.i18next).toBe('1.0.0');
  expect(result.evidence.roots['react-i18next']).toBe('1.0.0');
  expect(Object.keys(result.evidence.roots)).toHaveLength(11);
  const second = await fixture();
  expect(
    (await prepareFixtureDependencies(second, inputs, ['DotsLoading', 'StatusBar'])).hash,
  ).toBe(result.hash);
});

it('rejects empty, duplicate or undeclared dependency selections', async () => {
  const root = await fixture();
  await expect(prepareFixtureDependencies(root, inputs, [])).rejects.toThrow(
    'INVALID_FIXTURE_SELECTION',
  );
  await expect(
    prepareFixtureDependencies(root, inputs, ['LiteTable', 'LiteTable']),
  ).rejects.toThrow('INVALID_FIXTURE_SELECTION');
  await expect(
    prepareFixtureDependencies(root, inputs, ['DotsLoading', 'OptionCard']),
  ).rejects.toThrow('FIXTURE_DEPENDENCY_DECLARATION_MISSING:lucide-react');
});

it('rejects unknown adapters and patches escaping the exported tree', async () => {
  const root = await fixture();
  await expect(prepareFixtureDependencies(root, inputs, 'Other')).rejects.toThrow(
    'ADAPTER_UNAVAILABLE',
  );
  await writeFile(
    path.join(root, 'pnpm-workspace.yaml'),
    'patchedDependencies: {react: ../outside.patch}\n',
  );
  await expect(prepareFixtureDependencies(root, inputs, 'LiteTable')).rejects.toThrow(
    'PATCH_ESCAPE',
  );
});
