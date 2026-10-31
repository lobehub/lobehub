import { createHash } from 'node:crypto';

export const sourceAssetName = 'desktop-sources.v1.json';
export const publicationAssetName = 'desktop-published.v1.json';
export const stablePlatforms = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'];

export function normalizeVersion(value) {
  if (
    typeof value !== 'string' ||
    !/^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value)
  )
    throw new Error('A stable version such as 2.2.21 is required');
  return value.replace(/^v/, '');
}

export function assertSha(value, name = 'commit') {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value))
    throw new Error(`${name} must be a full lowercase commit SHA`);
  return value;
}

const assertHash = (value) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new Error('Invalid source record hash');
  return value;
};

const validateEvidence = (value) => {
  if (
    !value ||
    typeof value.runId !== 'string' ||
    !/^\d+$/.test(value.runId) ||
    !Number.isSafeInteger(value.runAttempt) ||
    value.runAttempt < 1
  )
    throw new Error('Source evidence requires a run ID and positive run attempt');
  return { runId: value.runId, runAttempt: value.runAttempt };
};

export function validateSources(value) {
  if (!value || value.schemaVersion !== 1 || value.channel !== 'stable')
    throw new Error('Unsupported stable source record schema/channel');
  if (!['latest', 'inherit', 'historical-import'].includes(value.selection))
    throw new Error('Invalid source selection');
  const record = {
    schemaVersion: 1,
    channel: 'stable',
    version: normalizeVersion(value.version),
    ossSha: assertSha(value.ossSha, 'OSS'),
    cloudSha: assertSha(value.cloudSha, 'Cloud'),
    selection: value.selection,
    baseVersion: value.baseVersion === null ? null : normalizeVersion(value.baseVersion),
    evidence: validateEvidence(value.evidence),
  };
  if (record.selection === 'inherit') {
    if (!record.baseVersion || record.baseVersion === record.version)
      throw new Error('A hotfix must reference a different base version');
    record.baseSourcesHash = assertHash(value.baseSourcesHash);
    if (value.overrideReason !== undefined) {
      if (
        typeof value.overrideReason !== 'string' ||
        !value.overrideReason.trim() ||
        value.overrideReason.length > 500
      )
        throw new Error('A Cloud override requires a concise reason');
      record.overrideReason = value.overrideReason.trim();
    }
  } else if (record.baseVersion !== null) {
    throw new Error('Only a hotfix may have a base version');
  }
  return record;
}

export function sourcesHash(record) {
  return createHash('sha256')
    .update(JSON.stringify(validateSources(record)))
    .digest('hex');
}

const assertIdentity = (record, input) => {
  if (record.version !== normalizeVersion(input.version) || record.ossSha !== input.ossSha)
    throw new Error('Source record version/OSS SHA mismatch');
  if (input.cloudSha && record.cloudSha !== input.cloudSha)
    throw new Error('Cloud SHA conflicts with the immutable source record');
  if (input.baseVersion && record.baseVersion !== normalizeVersion(input.baseVersion))
    throw new Error('Hotfix base version conflicts with the source record');
  if (input.baseSourcesHash && record.baseSourcesHash !== input.baseSourcesHash)
    throw new Error('Hotfix baseline hash conflicts with the source record');
};

export function validatePublication(value, sources) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.channel !== 'stable' ||
    normalizeVersion(value.version) !== sources.version ||
    value.sourcesHash !== sourcesHash(sources) ||
    value.ossSha !== sources.ossSha ||
    value.cloudSha !== sources.cloudSha ||
    !stablePlatforms.every((platform) => value.platforms?.includes(platform)) ||
    !['github', 's3', 'sparkle'].every((surface) => value.surfaces?.includes(surface)) ||
    typeof value.runId !== 'string' ||
    !/^\d+$/.test(value.runId) ||
    typeof value.publishedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.publishedAt))
  )
    throw new Error('Publication proof is missing or does not match the source hash');
  return value;
}

export async function deliveredBaseline(store, version, expectedHash) {
  const normalized = normalizeVersion(version);
  const raw = await store.readSources(normalized);
  if (!raw) throw new Error(`Missing sources for baseline v${normalized}`);
  const sources = validateSources(raw);
  if (sources.version !== normalized) throw new Error('Baseline version mismatch');
  if (expectedHash && sourcesHash(sources) !== expectedHash)
    throw new Error('Baseline source hash mismatch');
  const receipt = await store.readPublication(normalized);
  if (!receipt) throw new Error(`Baseline v${normalized} has not been published/delivered`);
  validatePublication(receipt, sources);
  return sources;
}

// Storage has create-only semantics. A failed matrix never deletes this lock.
export async function resolveSources(input, dependencies) {
  const version = normalizeVersion(input.version);
  const ossSha = assertSha(input.ossSha, 'OSS');
  if (input.cloudSha) assertSha(input.cloudSha, 'Cloud');
  if (!['initialize', 'rebuild', 'hotfix', 'import'].includes(input.mode))
    throw new Error('An explicit release mode is required');
  const stored = await dependencies.store.readSources(version);
  if (stored !== null) {
    const sources = validateSources(stored);
    assertIdentity(sources, input);
    return { sources, hash: sourcesHash(sources), persisted: true };
  }
  if (input.mode === 'rebuild')
    throw new Error(`Missing source record for v${version}; use an explicit historical import`);

  const evidence = validateEvidence(input.evidence);
  if (input.mode !== 'import' && evidence.runAttempt !== 1)
    throw new Error(
      'Missing source record: only the first attempt may initialize; use an explicit historical import',
    );
  let cloudSha;
  let selection;
  let baseVersion = null;
  let baseSourcesHash;
  let overrideReason;
  if (input.mode === 'initialize') {
    if (input.firstRelease !== true || evidence.runAttempt !== 1)
      throw new Error('Missing record: only the initial release attempt may initialize sources');
    if (input.cloudSha || input.baseVersion)
      throw new Error(
        'Ordinary initialization selects Cloud HEAD; explicit sources require import/hotfix',
      );
    cloudSha = await dependencies.latestCloud();
    selection = 'latest';
  } else if (input.mode === 'hotfix') {
    const baseline = await deliveredBaseline(
      dependencies.store,
      input.baseVersion,
      input.baseSourcesHash,
    );
    baseVersion = baseline.version;
    if (baseVersion === version) throw new Error('A hotfix needs a new version');
    baseSourcesHash = sourcesHash(baseline);
    cloudSha = input.cloudSha || baseline.cloudSha;
    if (cloudSha !== baseline.cloudSha) {
      if (!input.overrideReason?.trim())
        throw new Error('A different Cloud SHA requires an override reason');
      overrideReason = input.overrideReason;
    }
    selection = 'inherit';
  } else {
    cloudSha = assertSha(input.cloudSha, 'Cloud');
    await dependencies.assertImportEvidence({ ...input, version, ossSha, evidence });
    selection = 'historical-import';
  }
  assertSha(cloudSha, 'Cloud');
  await dependencies.assertCloudCommit(cloudSha);
  const candidate = validateSources({
    schemaVersion: 1,
    channel: 'stable',
    version,
    ossSha,
    cloudSha,
    selection,
    baseVersion,
    evidence,
    ...(baseSourcesHash && { baseSourcesHash }),
    ...(overrideReason && { overrideReason }),
  });
  if (!input.write) return { sources: candidate, hash: sourcesHash(candidate), persisted: false };
  await dependencies.store.createSources(version, candidate);
  const winner = await dependencies.store.readSources(version);
  if (!winner) throw new Error('Source record was not persisted');
  const sources = validateSources(winner);
  assertIdentity(sources, { version, ossSha, cloudSha, baseVersion, baseSourcesHash });
  if (sources.selection !== selection || sources.overrideReason !== candidate.overrideReason)
    throw new Error('Concurrent source initialization conflict');
  return { sources, hash: sourcesHash(sources), persisted: true };
}

export async function recordPublication(input, store) {
  if (
    input.dryRun ||
    !stablePlatforms.every((platform) => input.platforms?.includes(platform)) ||
    !['build', 'github', 's3', 'sparkle'].every((stage) => input.outcomes?.[stage] === 'success')
  )
    return null;
  const raw = await store.readSources(normalizeVersion(input.version));
  if (!raw) throw new Error('Cannot publish proof without a source record');
  const sources = validateSources(raw);
  if (input.sourcesHash !== sourcesHash(sources)) throw new Error('Published source hash mismatch');
  const existing = await store.readPublication(sources.version);
  if (existing) return validatePublication(existing, sources);
  const receipt = validatePublication(
    {
      schemaVersion: 1,
      channel: 'stable',
      version: sources.version,
      sourcesHash: sourcesHash(sources),
      ossSha: sources.ossSha,
      cloudSha: sources.cloudSha,
      publishedAt: input.publishedAt,
      runId: input.runId,
      platforms: [...stablePlatforms],
      surfaces: ['github', 's3', 'sparkle'],
    },
    sources,
  );
  await store.createPublication(sources.version, receipt);
  const winner = await store.readPublication(sources.version);
  return validatePublication(winner, sources);
}
