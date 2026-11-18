import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

import { REGISTRY } from './record.mjs';

export function parseRegistryResult(result, missingVersion) {
  if (result.error) throw result.error;
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    throw new Error('Registry did not return JSON; check network and npm configuration');
  }
  if (result.status !== 0) {
    if (
      missingVersion &&
      value?.error?.code === 'E404' &&
      value.error.summary === `No match found for version ${missingVersion}`
    )
      return null;
    throw new Error(`Registry lookup failed: ${value?.error?.code ?? result.status}`);
  }
  if (value === null || value?.error)
    throw new Error('Registry returned an empty or error payload');
  return value;
}

export function queryRegistry(spec, fields, missingVersion) {
  return parseRegistryResult(
    spawnSync(
      'npm',
      [
        'view',
        spec,
        ...fields,
        '--json',
        `--registry=${REGISTRY}`,
        '--fetch-retries=0',
        '--fetch-timeout=25000',
      ],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 },
    ),
    missingVersion,
  );
}

export function assertUnpublished(record, query = queryRegistry) {
  const tags = query(record.package, ['dist-tags']);
  if (!tags || typeof tags !== 'object' || typeof tags.latest !== 'string')
    throw new Error('Invalid registry dist-tags');
  if ((tags[record.tag] ?? null) !== record.baseline.channelVersion) {
    throw new Error('Selected channel changed; stop and repeat preparation');
  }
  const version = query(`${record.package}@${record.version}`, ['version'], record.version);
  if (version !== null)
    throw new Error(
      'Target is already published or its availability is unconfirmed; never overwrite or republish',
    );
}

export function publicationState(record, query = queryRegistry) {
  const version = query(
    `${record.package}@${record.version}`,
    ['version', 'dist.integrity'],
    record.version,
  );
  const tags = query(record.package, ['dist-tags']);
  if (!tags || typeof tags !== 'object' || typeof tags.latest !== 'string')
    throw new Error('Invalid registry dist-tags');
  const channel = tags[record.tag] ?? null;
  if (
    version !== null &&
    (typeof version.version !== 'string' ||
      typeof (version['dist.integrity'] ?? version.dist?.integrity) !== 'string')
  ) {
    throw new Error('Invalid registry version/integrity response');
  }
  if (
    version !== null &&
    (version.version !== record.version ||
      (version['dist.integrity'] ?? version.dist?.integrity) !== record.artifact.integrity)
  ) {
    return { state: 'MISMATCH', version, tags };
  }
  if (channel !== record.version && channel !== record.baseline.channelVersion) {
    return { state: 'CHANNEL_CHANGED', version, tags };
  }
  return {
    state: version !== null && channel === record.version ? 'VERIFIED' : 'PENDING',
    version,
    tags,
  };
}

export async function waitForPublication(
  record,
  {
    query = queryRegistry,
    sleep = setTimeout,
    delays = [0, 10000, 20000, 40000, 60000, 90000, 120000, 120000],
    onAttempt = () => {},
  } = {},
) {
  const attempts = [];
  const deadline = Date.now() + 10 * 60 * 1000;
  for (const delay of delays) {
    if (Date.now() + delay >= deadline) break;
    if (delay) await sleep(delay);
    let result;
    try {
      result = publicationState(record, query);
    } catch (error) {
      result = { state: 'UNKNOWN', error: error.message };
    }
    attempts.push({ at: new Date().toISOString(), ...result });
    onAttempt({ ...result, attempts });
    if (result.state !== 'PENDING') return { ...result, attempts };
  }
  return { state: 'UNCONFIRMED', attempts };
}
