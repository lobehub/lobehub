import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { createRecord, digest } from './record.mjs';
import { releaseStatus } from './status.mjs';

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function preparation() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'release-status-'));
  directories.push(directory);
  const bytes = Buffer.from('artifact');
  const record = createRecord();
  record.version = '0.0.76';
  record.tag = 'latest';
  Object.assign(record.artifact, {
    path: 'cli.tgz',
    sha256: digest(bytes),
    integrity: `sha512-${digest(bytes, 'sha512', 'base64')}`,
    size: bytes.length,
    node: process.version,
    platform: process.platform,
  });
  await writeFile(path.join(directory, 'cli.tgz'), bytes);
  return { directory, record };
}

it('separates a built artifact from unresolved publication conditions', async () => {
  const { directory, record } = await preparation();
  const result = await releaseStatus(record, directory);
  expect(result).toMatchObject({
    artifact: 'BUILT',
    preparation: 'BLOCKED',
    publication: 'NOT_OBSERVED',
    repositorySync: 'NOT_REQUESTED',
  });
  expect(result.blockers).toContain('acceptance: Gate is UNKNOWN');
});

it('can report registry success while preparation risks and repository sync remain pending', async () => {
  const { directory, record } = await preparation();
  await mkdir(path.join(directory, 'verification'));
  await writeFile(
    path.join(directory, 'verification/100.json'),
    JSON.stringify({
      version: record.version,
      tag: record.tag,
      expectedIntegrity: record.artifact.integrity,
      state: 'VERIFIED',
    }),
  );
  expect(await releaseStatus(record, directory)).toMatchObject({
    preparation: 'BLOCKED',
    publication: 'VERIFIED',
    repositorySync: 'NOT_REQUESTED',
  });
});

it('does not call an artifact validated when PASS labels have no inspected evidence', async () => {
  const { directory, record } = await preparation();
  for (const id of ['build', 'tarball', 'smoke']) record.gates[id] = { status: 'PASS' };
  expect(await releaseStatus(record, directory)).toMatchObject({ artifact: 'BUILT' });
});

it.each(['PENDING', 'UNCONFIRMED', 'UNKNOWN', 'MISMATCH', 'CHANNEL_CHANGED'])(
  'prioritizes recovery for %s over unresolved preparation gates',
  async (state) => {
    const { directory, record } = await preparation();
    await mkdir(path.join(directory, 'verification'));
    await writeFile(
      path.join(directory, 'verification/100.json'),
      JSON.stringify({
        version: record.version,
        tag: record.tag,
        expectedIntegrity: record.artifact.integrity,
        state,
      }),
    );
    const result = await releaseStatus(record, directory);
    expect(result.preparation).toBe('BLOCKED');
    expect(result.nextAction).toMatch(/read-only|Investigate/);
    expect(result.nextAction).not.toContain('Resolve the listed release conditions');
  },
);

it('directs a recorded publish attempt to verification rather than another handoff', async () => {
  const { directory, record } = await preparation();
  await writeFile(
    path.join(directory, 'publish-attempt.json'),
    JSON.stringify({
      state: 'SUBMITTED',
      integrity: record.artifact.integrity,
    }),
  );
  expect(await releaseStatus(record, directory)).toMatchObject({
    publication: 'UNCONFIRMED',
    nextAction: expect.stringContaining('read-only'),
  });
});

it('rejects an existing seal whose local evidence is missing instead of treating it as absent', async () => {
  const { directory, record } = await preparation();
  await writeFile(path.join(directory, 'handoff.json'), '{"digest":"wrong"}');
  expect(await releaseStatus(record, directory)).toMatchObject({
    preparation: 'BLOCKED',
    seal: 'INVALID',
  });
});
