import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRecord, digest, validateRecord } from './record.mjs';

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function candidate() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'release-record-'));
  directories.push(directory);
  const bytes = Buffer.from('tested artifact');
  await Promise.all([
    writeFile(path.join(directory, 'cli.tgz'), bytes),
    writeFile(path.join(directory, 'release-input.patch'), ''),
    writeFile(path.join(directory, 'evidence.log'), 'inspected'),
    writeFile(
      path.join(directory, 'run.json'),
      JSON.stringify({
        command: ['check'],
        exitCode: 0,
        log: 'evidence.log',
      }),
    ),
  ]);
  const record = createRecord();
  Object.assign(record, {
    schemaVersion: 2,
    version: '0.0.76',
    tag: 'latest',
    baseline: {
      version: '0.0.75',
      stableVersion: '0.0.75',
      channelVersion: '0.0.75',
      sourceSha: '',
      provenance: '',
    },
    comparison: {
      sourceSha: 'a'.repeat(40),
      kind: 'repository-reference',
      reason: 'Version-sync commit; old npm source is unknown.',
    },
    source: { sha: 'b'.repeat(40), patch: 'release-input.patch' },
    artifact: {
      path: 'cli.tgz',
      sha256: digest(bytes),
      integrity: `sha512-${digest(bytes, 'sha512', 'base64')}`,
      size: bytes.length,
      node: process.version,
      platform: process.platform,
    },
  });
  for (const id of Object.keys(record.gates)) {
    if (id === 'baseline') continue;
    record.gates[id] = {
      status: 'PASS',
      checkedAt: new Date().toISOString(),
      evidence: [{ ref: 'evidence.log', note: 'Inspected fixture evidence.' }],
      runs: ['run.json'],
    };
  }
  return { directory, record };
}

describe('readiness with an explicit repository comparison', () => {
  it('allows a verified candidate without inventing provenance for the previous npm package', async () => {
    const { directory, record } = await candidate();
    expect(validateRecord(record, directory)).toEqual([]);
    expect(record.gates.baseline.status).toBe('UNKNOWN');
    expect(record.baseline.sourceSha).toBe('');
  });

  it('requires the comparison limitation to be explained', async () => {
    const { directory, record } = await candidate();
    record.comparison.reason = '';
    expect(validateRecord(record, directory).join('\n')).toMatch(/comparison/i);
  });

  it.each(['acceptance', 'backend', 'types', 'scope', 'smoke'])(
    'still blocks missing %s evidence',
    async (gate) => {
      const { directory, record } = await candidate();
      record.gates[gate] = { status: 'UNKNOWN' };
      expect(validateRecord(record, directory).join('\n')).toContain(`${gate}: Gate is UNKNOWN`);
    },
  );

  it('does not treat a repository reference as verified published provenance', async () => {
    const { directory, record } = await candidate();
    record.comparison.kind = 'verified-release';
    expect(validateRecord(record, directory).join('\n')).toMatch(/baseline/);
  });

  it('does not waive a known historical provenance conflict', async () => {
    const { directory, record } = await candidate();
    record.gates.baseline = { status: 'FAIL', reason: 'Conflicting source evidence.' };
    expect(validateRecord(record, directory).join('\n')).toContain('baseline: Gate is FAIL');
  });

  it('accepts evidenced published provenance when comparison and baseline agree', async () => {
    const { directory, record } = await candidate();
    record.comparison.kind = 'verified-release';
    record.baseline.sourceSha = record.comparison.sourceSha;
    record.baseline.provenance = 'release-record';
    record.gates.baseline = record.gates.scope;
    expect(validateRecord(record, directory)).toEqual([]);
  });

  it('preserves schema 1 readiness rules for existing sealed records', async () => {
    const { directory, record } = await candidate();
    record.schemaVersion = 1;
    delete record.comparison;
    expect(validateRecord(record, directory).join('\n')).toContain('baseline: Gate is UNKNOWN');
    record.baseline.sourceSha = 'a'.repeat(40);
    record.baseline.provenance = 'release-record';
    record.gates.baseline = record.gates.scope;
    expect(validateRecord(record, directory)).toEqual([]);
  });
});
