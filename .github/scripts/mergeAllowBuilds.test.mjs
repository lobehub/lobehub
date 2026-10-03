import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { mergeAllowBuilds, mergeAllowBuildsFiles, parseAllowBuilds } from './mergeAllowBuilds.mjs';

const overlayWorkspace = `packages:
  - packages/**
  - lobehub

allowBuilds:
  esbuild: false
  sharp: false
`;

const innerWorkspace = `allowBuilds:
  '@google/genai': true
  '@mongodb-js/zstd': false
  esbuild: true
  node-liblzma: false
`;

test('parseAllowBuilds reads quoted scoped packages and booleans', () => {
  assert.deepEqual(parseAllowBuilds(innerWorkspace), {
    '@google/genai': true,
    '@mongodb-js/zstd': false,
    'esbuild': true,
    'node-liblzma': false,
  });
});

test('mergeAllowBuilds copies inner decisions the overlay has not recorded', () => {
  const merged = mergeAllowBuilds({
    extraTexts: [innerWorkspace],
    rootText: overlayWorkspace,
  });

  assert.deepEqual(parseAllowBuilds(merged), {
    '@google/genai': true,
    '@mongodb-js/zstd': false,
    'esbuild': false,
    'node-liblzma': false,
    'sharp': false,
  });
  assert.match(merged, /'@mongodb-js\/zstd': false/);
  assert.match(merged, /node-liblzma: false/);
  assert.match(merged, /esbuild: false/);
});

test('mergeAllowBuildsFiles writes only when the overlay is missing keys', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'merge-allow-builds-'));
  const rootFile = path.join(dir, 'pnpm-workspace.yaml');
  const extraFile = path.join(dir, 'inner.yaml');
  await writeFile(rootFile, overlayWorkspace);
  await writeFile(extraFile, innerWorkspace);

  mergeAllowBuildsFiles({ extraFiles: [extraFile, path.join(dir, 'missing.yaml')], rootFile });

  const written = await readFile(rootFile, 'utf8');
  assert.equal(
    written,
    mergeAllowBuilds({ extraTexts: [innerWorkspace], rootText: overlayWorkspace }),
  );
});

test('mergeAllowBuilds throws when the overlay has no allowBuilds block', () => {
  assert.throws(
    () => mergeAllowBuilds({ extraTexts: [innerWorkspace], rootText: 'packages:\n  - .\n' }),
    /missing an allowBuilds block/,
  );
});
