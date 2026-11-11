import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { handoffDigest, requireArtifact, validateRecord } from './record.mjs';

export async function releaseStatus(record, directory) {
  const blockers = validateRecord(record, directory);
  let artifact = 'ABSENT';
  try {
    requireArtifact(record, directory);
    artifact = ['build', 'tarball', 'smoke'].every(
      (id) =>
        record.gates?.[id]?.status === 'PASS' &&
        !blockers.some((error) => error.startsWith(`${id}:`)),
    )
      ? 'VALIDATED'
      : 'BUILT';
  } catch {
    if (record.artifact?.path) artifact = 'INVALID';
  }
  let seal = 'ABSENT';
  let handoffText;
  try {
    handoffText = await readFile(path.join(directory, 'handoff.json'), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (handoffText !== undefined) {
    try {
      if (JSON.parse(handoffText).digest !== handoffDigest(record, directory))
        throw new Error('Handoff changed');
      seal = 'MATCHED';
    } catch (error) {
      seal = 'INVALID';
      blockers.push(`seal: ${error.message}`);
    }
  }
  let publication = 'NOT_OBSERVED';
  let verificationRecord = null;
  try {
    const files = (await readdir(path.join(directory, 'verification')))
      .filter((name) => /^\d+.*\.json$/.test(name))
      .sort();
    const last = files.at(-1);
    if (last) {
      verificationRecord = `verification/${last}`;
      const result = JSON.parse(await readFile(path.join(directory, verificationRecord), 'utf8'));
      publication =
        result.expectedIntegrity === record.artifact?.integrity &&
        result.version === record.version &&
        result.tag === record.tag
          ? result.state
          : 'UNKNOWN';
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!verificationRecord) {
    try {
      const attempt = JSON.parse(
        await readFile(path.join(directory, 'publish-attempt.json'), 'utf8'),
      );
      publication = attempt.integrity === record.artifact?.integrity ? 'UNCONFIRMED' : 'UNKNOWN';
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const recovery = {
    VERIFIED:
      'Registry identity verified; report remaining preparation risks separately. Repository synchronization requires authorization.',
    PENDING:
      'Resume read-only verify for this artifact; do not rebuild or publish again while registry visibility is pending.',
    UNCONFIRMED:
      'Resume read-only verify for this artifact; a publication attempt is not proof of availability. Do not republish.',
    UNKNOWN:
      'Resolve registry query or identity-record errors, then resume read-only verify. Do not infer absence or republish.',
    MISMATCH:
      'Investigate the integrity mismatch; preserve the artifact and observations. Do not republish or change tags.',
    CHANNEL_CHANGED:
      'Investigate the changed channel; preserve the artifact and observations. Do not republish or change tags.',
  };
  return {
    package: record.package,
    version: record.version,
    tag: record.tag,
    artifact,
    preparation: blockers.length ? 'BLOCKED' : 'READY_FOR_HANDOFF',
    seal,
    blockers,
    comparison: record.comparison ?? null,
    historicalProvenance: record.gates?.baseline?.status ?? 'UNKNOWN',
    publication,
    verificationRecord,
    repositorySync: record.repositorySync?.state ?? 'NOT_REQUESTED',
    nextAction:
      recovery[publication] ??
      (blockers.length
        ? 'Resolve the listed release conditions; independent preparation work may continue. Do not print a publication command.'
        : seal === 'MATCHED'
          ? 'Await the human publication attempt, then run read-only verify.'
          : 'Run handoff to seal the verified artifact and print the human-only command.'),
  };
}
