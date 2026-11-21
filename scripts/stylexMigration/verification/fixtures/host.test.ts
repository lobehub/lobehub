// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, it } from 'vitest';

import { fixtureIds, getStyleFixture } from './fixtureRegistry';
import { prepareFixtureHost } from './host';

const owned: string[] = [];
afterEach(async () => {
  for (const root of owned.splice(0)) await rm(root, { force: true, recursive: true });
});
const setup = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stylex-host-test-'));
  owned.push(root);
  await mkdir(path.join(root, '.stylex-tools'));
  return root;
};
const sourceDirectory = fileURLToPath(new URL('../', import.meta.url));

it('prepares all registered hosts independently and hashes actual verifier inputs', async () => {
  const root = await setup();
  for (const id of fixtureIds) {
    const fixture = getStyleFixture(id);
    const result = await prepareFixtureHost(root, sourceDirectory, fixture, 'base');
    expect(result.relativeTools).toBe(`.stylex-tools/fixtures/${id}`);
    expect(result.fixtureHashes[fixture.host]).toMatch(/^[a-f0-9]{64}$/);
    expect(result.fixtureHashes[fixture.render]).toMatch(/^[a-f0-9]{64}$/);
    const proxy = await readFile(path.join(result.host, 'component.ts'), 'utf8');
    expect(proxy).toContain(`${fixture.component.base.exportName} as ${id}`);
    expect(proxy).toContain(fixture.component.base.source);
    const entry = await readFile(path.join(result.host, 'entry.tsx'), 'utf8');
    expect(entry).toContain(`./${fixture.render}`);
    expect(entry).toContain(JSON.stringify(fixture.containerMode));
    if (id !== 'LiteTable') expect(entry).not.toContain('LiteTable');
  }
});

it('selects the candidate export and source without changing the base', async () => {
  const root = await setup();
  const fixture = getStyleFixture('DotsLoading');
  fixture.component.candidate = { exportName: 'ChangedDots', source: 'src/changed.tsx' };
  const result = await prepareFixtureHost(root, sourceDirectory, fixture, 'candidate');
  expect(await readFile(path.join(result.host, 'component.ts'), 'utf8')).toContain(
    'ChangedDots as DotsLoading',
  );
  expect(result.componentSource).toBe('src/changed.tsx');
});

it('fails closed for injected identifiers, escaping paths and repeated namespaces', async () => {
  const root = await setup();
  const fixture = getStyleFixture('DotsLoading');
  await expect(
    prepareFixtureHost(root, sourceDirectory, { ...fixture, id: '../escape' }, 'base'),
  ).rejects.toThrow();
  await expect(
    prepareFixtureHost(root, sourceDirectory, { ...fixture, assets: ['../escape'] }, 'base'),
  ).rejects.toThrow();
  await prepareFixtureHost(root, sourceDirectory, fixture, 'base');
  await expect(prepareFixtureHost(root, sourceDirectory, fixture, 'base')).rejects.toThrow();
});

it('does not borrow missing fixture modules from the checkout or another host', async () => {
  const root = await setup();
  const source = path.join(root, 'source');
  await mkdir(source);
  await writeFile(path.join(source, 'FixtureHost.tsx'), 'export const startFixture = () => {};');
  await expect(
    prepareFixtureHost(root, source, getStyleFixture('DotsLoading'), 'base'),
  ).rejects.toThrow();
});
