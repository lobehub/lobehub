import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createInputManifest, MAIN_HASH_ALGORITHM } from './mainHash.mjs';

export function diffInputs(before, after) {
  const left = new Map(
    before.inputs.map((input) => [input.path, `${input.group}:${input.sha256}`]),
  );
  const right = new Map(
    after.inputs.map((input) => [input.path, `${input.group}:${input.sha256}`]),
  );
  const changes = [...new Set([...left.keys(), ...right.keys()])]
    .sort()
    .filter((file) => left.get(file) !== right.get(file))
    .map(
      (file) => `${file}: ${left.get(file) ?? '(missing)'} -> ${right.get(file) ?? '(missing)'}`,
    );
  if (before.algorithm !== after.algorithm)
    changes.unshift(`algorithm: ${before.algorithm} -> ${after.algorithm}`);
  return changes;
}

export function validateInputManifest(manifest) {
  if (
    manifest.algorithm !== MAIN_HASH_ALGORITHM ||
    !Array.isArray(manifest.inputs) ||
    !manifest.inputs.length
  ) {
    throw new Error('Unsupported or empty renderer main hash inputs; full release required');
  }
  for (const input of manifest.inputs) {
    if (
      typeof input.path !== 'string' ||
      typeof input.group !== 'string' ||
      !/^[0-9a-f]{64}$/.test(input.sha256)
    ) {
      throw new Error('Invalid renderer main hash input');
    }
  }
  if (createInputManifest(manifest.inputs).mainHash !== manifest.mainHash) {
    throw new Error('Renderer main hash does not match its input manifest');
  }
}

export async function validateReleaseInputs(releaseDir, expectedArtifacts) {
  if (!expectedArtifacts.length) throw new Error('Expected build artifacts are required');
  const inputDir = path.join(releaseDir, 'renderer-mainhash');
  const actual = (await readdir(inputDir)).filter((file) => file.endsWith('.json')).sort();
  const expected = expectedArtifacts.map((artifact) => `${artifact}.json`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Renderer hash artifacts differ: expected ${expected.join(', ')}, received ${actual.join(', ')}`,
    );
  }
  const manifests = await Promise.all(
    actual.map(async (file) => {
      const manifest = JSON.parse(await readFile(path.join(inputDir, file), 'utf8'));
      validateInputManifest(manifest);
      return manifest;
    }),
  );
  const [base] = manifests;
  for (const [index, manifest] of manifests.entries()) {
    if (base.mainHash !== manifest.mainHash) {
      throw new Error(
        `Renderer main hash differs: ${actual[0]} vs ${actual[index]}\n${diffInputs(base, manifest).join('\n')}`,
      );
    }
  }
  await writeFile(path.join(releaseDir, 'renderer-mainhash.txt'), `${base.mainHash}\n`);
  await writeFile(
    path.join(releaseDir, 'renderer-mainhash-inputs.json'),
    `${JSON.stringify(base, null, 2)}\n`,
  );
  return base;
}

export async function validateRendererBase(releaseDir, channel, appVersion) {
  const inputs = JSON.parse(
    await readFile(path.join(releaseDir, 'renderer-mainhash-inputs.json'), 'utf8'),
  );
  validateInputManifest(inputs);
  const embedded = (await readFile(path.join(releaseDir, 'renderer-mainhash.txt'), 'utf8')).trim();
  if (inputs.mainHash !== embedded) throw new Error('Renderer baseline differs from packaged hash');
  const root = path.join(releaseDir, 'renderer-ota', channel, appVersion, 'renderer/v2');
  for (const file of ['latest.json', 'versions/r0.json']) {
    const manifest = JSON.parse(await readFile(path.join(root, file), 'utf8'));
    if (
      manifest.mainHash !== embedded ||
      manifest.appVersion !== appVersion ||
      manifest.version !== 'r0' ||
      manifest.schemaVersion !== 2
    ) {
      throw new Error(`Renderer r0 does not match the full release: ${file}`);
    }
    if (!/^packs\/[0-9a-f]{64}\.zip$/.test(manifest.full?.path))
      throw new Error('Invalid r0 pack path');
    await access(path.join(root, manifest.full.path));
  }
  return inputs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, ...expected] = process.argv.slice(2);
  const operation =
    dir === '--base'
      ? validateRendererBase(...expected)
      : validateReleaseInputs(path.resolve(dir ?? 'release'), expected);
  operation.then(
    (manifest) => console.log(`Validated ${expected.length} platform hashes: ${manifest.mainHash}`),
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
