import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const REGISTRY = 'https://registry.npmjs.org';
export const GATES = [
  'baseline',
  'version',
  'scope',
  'lintTests',
  'types',
  'bundleTests',
  'acceptance',
  'backend',
  'build',
  'tarball',
  'smoke',
];
const COMMAND_GATES = new Set(['lintTests', 'types', 'bundleTests', 'build', 'smoke']);
const EXEMPTIBLE = new Set(['acceptance', 'backend']);

export function createRecord() {
  return {
    schemaVersion: 1,
    package: '@lobehub/cli',
    registry: REGISTRY,
    version: '',
    tag: '',
    baseline: {
      version: '',
      channelVersion: null,
      stableVersion: '',
      sourceSha: '',
      provenance: '',
    },
    source: { sha: '', patch: 'release-input.patch' },
    artifact: { path: '', sha256: '', integrity: '', size: 0, platform: '', node: '' },
    gates: Object.fromEntries(GATES.map((id) => [id, { status: 'UNKNOWN', evidence: [] }])),
    repositorySync: { state: 'NOT_REQUESTED', pr: null },
  };
}

function parseVersion(value) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(
      value,
    );
  if (!match) throw new Error(`Invalid SemVer: ${value}`);
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((part) => /^0\d+$/.test(part))) throw new Error(`Invalid SemVer: ${value}`);
  return { core: match.slice(1, 4).map(BigInt), prerelease };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return Math.sign(b.prerelease.length) - Math.sign(a.prerelease.length);
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn !== yn) return xn ? -1 : 1;
    return (xn ? BigInt(x) > BigInt(y) : x > y) ? 1 : -1;
  }
  return 0;
}

export function digest(bytes, algorithm = 'sha256', encoding = 'hex') {
  return createHash(algorithm).update(bytes).digest(encoding);
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function localFile(directory, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
    throw new Error('Expected a release-directory-relative path');
  }
  const file = path.resolve(directory, relative);
  if (!file.startsWith(`${path.resolve(directory)}${path.sep}`))
    throw new Error('Path escapes release directory');
  return file;
}

function readableFile(directory, ref, allowEmpty = false) {
  const file = localFile(directory, ref);
  const info = statSync(file);
  if (!info.isFile() || (!allowEmpty && !info.size))
    throw new Error(`Missing or empty file: ${ref}`);
  return file;
}

export function validateRecord(record, directory) {
  const errors = [];
  const check = (label, fn) => {
    try {
      fn();
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  };
  check('release', () => {
    if (
      record.schemaVersion !== 1 ||
      record.package !== '@lobehub/cli' ||
      record.registry !== REGISTRY
    ) {
      throw new Error('Unsupported schema, package or registry');
    }
    if (!['latest', 'next', 'beta'].includes(record.tag))
      throw new Error('Confirm latest, next or beta');
    const version = parseVersion(record.version);
    if (version.prerelease.length && record.tag === 'latest')
      throw new Error('Prerelease cannot use latest');
    const baseline = record.baseline?.channelVersion ?? record.baseline?.stableVersion;
    if (compareVersions(record.version, baseline) <= 0)
      throw new Error('Target must be newer than channel baseline');
    parseVersion(record.baseline?.version);
    parseVersion(record.baseline?.stableVersion);
  });
  check('baseline provenance', () => {
    if (
      !['npm-gitHead', 'release-record', 'verified-release-ref'].includes(
        record.baseline?.provenance,
      )
    ) {
      throw new Error(
        'Require npm gitHead, a verified release record or a verified release reference; never a guessed bump commit',
      );
    }
    if (!/^[\da-f]{40}$/.test(record.baseline?.sourceSha))
      throw new Error('Missing baseline source SHA');
  });
  check('source', () => {
    if (!/^[\da-f]{40}$/.test(record.source?.sha)) throw new Error('Missing candidate source SHA');
    readableFile(directory, record.source?.patch, true);
  });
  for (const id of GATES) {
    check(id, () => {
      const gate = record.gates?.[id];
      if (gate?.status === 'EXEMPT' && EXEMPTIBLE.has(id) && gate.reason?.trim()) return;
      if (gate?.status !== 'PASS') throw new Error(`Gate is ${gate?.status ?? 'missing'}`);
      if (!gate.checkedAt || !Number.isFinite(Date.parse(gate.checkedAt)))
        throw new Error('Missing inspection time');
      if (!Array.isArray(gate.evidence) || !gate.evidence.length)
        throw new Error('Missing inspected evidence');
      for (const evidence of gate.evidence) {
        if (!evidence.note?.trim()) throw new Error('Explain what the inspected evidence proves');
        if (evidence.ref.startsWith('https://')) {
          const url = new URL(evidence.ref);
          if (url.username || url.password) throw new Error('Credential-bearing evidence URL');
        } else {
          readableFile(directory, evidence.ref);
        }
      }
      if (COMMAND_GATES.has(id)) {
        if (!Array.isArray(gate.runs) || !gate.runs.length)
          throw new Error('Missing command receipts');
        for (const ref of gate.runs) {
          const run = readJson(readableFile(directory, ref));
          if (run.exitCode !== 0 || !run.command?.length)
            throw new Error(`Unsuccessful command receipt: ${ref}`);
          readableFile(directory, run.log, true);
        }
      }
    });
  }
  check('artifact', () => {
    const artifact = record.artifact;
    const bytes = readFileSync(readableFile(directory, artifact?.path));
    if (
      artifact.sha256 !== digest(bytes) ||
      artifact.integrity !== `sha512-${digest(bytes, 'sha512', 'base64')}` ||
      artifact.size !== bytes.length
    ) {
      throw new Error('Tarball checksum, integrity or size changed');
    }
    if (!artifact.node || !artifact.platform) throw new Error('Missing tested runtime/platform');
  });
  return errors;
}

export function requireReady(record, directory) {
  const errors = validateRecord(record, directory);
  if (errors.length) throw new Error(`BLOCKED\n${errors.join('\n')}`);
}

export function handoffDigest(record, directory) {
  const { repositorySync: _repositorySync, ...preparation } = record;
  const refs = new Set([
    record.source.patch,
    record.artifact.path,
    'report.md',
    'tools/humanPublish.mjs',
    'tools/record.mjs',
    'tools/registry.mjs',
  ]);
  for (const gate of Object.values(record.gates)) {
    for (const evidence of gate.evidence ?? []) {
      if (!evidence.ref.startsWith('https://')) refs.add(evidence.ref);
    }
    for (const ref of gate.runs ?? []) {
      refs.add(ref);
      refs.add(readJson(localFile(directory, ref)).log);
    }
  }
  const files = Object.fromEntries(
    [...refs].sort().map((ref) => [ref, digest(readFileSync(localFile(directory, ref)))]),
  );
  return digest(JSON.stringify({ preparation, files }));
}
