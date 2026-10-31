import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createGithubStore } from './desktopReleaseGithub.mjs';
import {
  formatIntent,
  stripIntent,
  validatePrIntent,
  validateReleaseIntent,
} from './desktopReleaseIntent.mjs';
import {
  deliveredBaseline,
  normalizeVersion,
  recordPublication,
  resolveSources,
  sourcesHash,
} from './desktopReleaseSources.mjs';

export function storeFromEnv(env) {
  return createGithubStore({
    apiUrl: env.GITHUB_API_URL,
    repository: env.GITHUB_REPOSITORY,
    token: env.GH_TOKEN || env.GITHUB_TOKEN,
    cloudRepository: env.CLOUD_REPOSITORY,
    cloudToken: env.CLOUD_TOKEN,
  });
}

async function output(env, values) {
  if (env.GITHUB_OUTPUT)
    await appendFile(
      env.GITHUB_OUTPUT,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    );
  console.log(JSON.stringify(values));
}

export async function runReleaseCli(command, env = process.env) {
  if (command === 'verify-checkout') {
    const actual = (await promisify(execFile)('git', ['rev-parse', 'HEAD'])).stdout.trim();
    if (actual !== env.RELEASE_OSS_SHA) throw new Error('Product source SHA mismatch');
    await mkdir('desktop-ota-diagnostics', { recursive: true });
    await writeFile(
      'desktop-ota-diagnostics/sources.json',
      `${JSON.stringify(
        {
          ossSha: actual,
          cloudSha: env.CLOUD_REF,
          sourcesHash: env.SOURCES_HASH,
          toolingSha: env.DESKTOP_TOOLING_SHA,
          runId: env.GITHUB_RUN_ID,
          runAttempt: env.GITHUB_RUN_ATTEMPT,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  const store = storeFromEnv(env);
  if (command === 'check-pr' || command === 'prepare-release') {
    const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
    const pr = event.pull_request;
    if (!pr) throw new Error('A pull request event is required');
    if (command === 'prepare-release' && pr.merged !== true)
      throw new Error('Release preparation requires a merged PR');
    const intent = await validatePrIntent(pr, store);
    if (command === 'check-pr') {
      await output(env, { release_mode: intent?.mode || 'none' });
      return;
    }
    if (!intent) throw new Error('This PR has no desktop release intent');
    const bound = {
      ...intent,
      mergeSha: pr.merge_commit_sha,
      prNumber: pr.number,
      ...(['hotfix', 'recovery'].includes(intent.mode) && {
        prBaseSha: await store.resolvePrBase(pr),
      }),
    };
    const file = path.join(env.RUNNER_TEMP, 'desktop-release-body.md');
    await writeFile(
      file,
      `## Release v${normalizeVersion(env.RELEASE_VERSION)}\n\nFrom PR #${pr.number}: ${pr.html_url}\n\n${stripIntent(pr.body || '')}\n\n${formatIntent(bound)}\n`,
    );
    await output(env, { body_file: file });
    return;
  }
  if (command === 'list') {
    console.log(JSON.stringify(await store.listDelivered()));
    return;
  }
  if (command === 'baseline') {
    console.log(JSON.stringify(await deliveredBaseline(store, env.BASE_VERSION)));
    return;
  }
  if (command === 'hotfix-intent') {
    const baseline = await deliveredBaseline(store, env.BASE_VERSION);
    const cloudSha = env.CLOUD_REF || baseline.cloudSha;
    if (cloudSha !== baseline.cloudSha && !env.CLOUD_OVERRIDE_REASON?.trim())
      throw new Error('A different Cloud SHA needs a repair reason');
    console.log(
      formatIntent({
        schemaVersion: 1,
        mode: 'hotfix',
        baseVersion: baseline.version,
        cloudSha,
        baseSourcesHash: sourcesHash(baseline),
        ...(env.CLOUD_OVERRIDE_REASON && { overrideReason: env.CLOUD_OVERRIDE_REASON }),
      }),
    );
    return;
  }
  if (command === 'recovery-intent') {
    console.log(
      formatIntent({
        schemaVersion: 1,
        mode: 'recovery',
        cloudSha: env.CLOUD_REF,
        recoveryBaseSha: env.RECOVERY_BASE_SHA,
        overrideReason: env.CLOUD_OVERRIDE_REASON,
      }),
    );
    return;
  }
  const version = normalizeVersion(env.RELEASE_VERSION);
  if (command === 'publish') {
    const outcomes = JSON.parse(env.PUBLICATION_OUTCOMES || '{}');
    if (env.CORE_PUBLISHED !== 'true' || env.INSTALLERS_PUBLISHED !== 'true')
      outcomes.s3 = 'skipped';
    if (env.SPARKLE_PUBLISHED !== 'true') outcomes.sparkle = 'skipped';
    const platforms = JSON.parse(env.BUILT_PLATFORMS || '[]');
    if (
      env.RELEASE_DRY_RUN !== 'true' &&
      ['build', 'github', 's3', 'sparkle'].every((stage) => outcomes[stage] === 'success')
    )
      await store.assertInstallerAssets(version);
    const receipt = await recordPublication(
      {
        version,
        sourcesHash: env.SOURCES_HASH,
        runId: env.GITHUB_RUN_ID,
        publishedAt: new Date().toISOString(),
        outcomes,
        platforms,
        dryRun: env.RELEASE_DRY_RUN === 'true',
      },
      store,
    );
    await output(env, { published: receipt !== null });
    return;
  }
  if (command !== 'resolve') throw new Error(`Unknown release command: ${command}`);
  // Resolve through the commits API so annotated tags are peeled as well.
  const targetRelease = await store.release(version);
  const tagSha = await store.resolveCommit(`v${version}`);
  const ossSha = env.SOURCE_REF ? await store.resolveCommit(env.SOURCE_REF) : tagSha;
  if (ossSha !== tagSha)
    throw new Error(
      'source_ref does not match the target tag; a version input cannot relabel other product sources',
    );
  let mode = env.RELEASE_MODE || 'rebuild';
  let intent;
  if (mode === 'auto') {
    const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
    if (env.GITHUB_EVENT_NAME !== 'release' || event.action !== 'published')
      throw new Error('Automatic source initialization requires a published release event');
    intent = validateReleaseIntent(event.release?.body || '', ossSha);
    mode = intent?.mode || 'rebuild';
  }
  if (mode === 'hotfix' || mode === 'recovery') {
    intent ||= validateReleaseIntent(targetRelease.body || '', ossSha);
    if (intent?.mode !== mode)
      throw new Error(
        'Hotfix/recovery requires matching bound release intent metadata from its merged PR',
      );
    if (
      (env.BASE_VERSION &&
        (mode !== 'hotfix' || normalizeVersion(env.BASE_VERSION) !== intent.baseVersion)) ||
      (env.CLOUD_REF && env.CLOUD_REF !== intent.cloudSha) ||
      (env.BASE_SOURCES_HASH && env.BASE_SOURCES_HASH !== intent.baseSourcesHash) ||
      (env.CLOUD_OVERRIDE_REASON && env.CLOUD_OVERRIDE_REASON.trim() !== intent.overrideReason) ||
      (env.RECOVERY_BASE_SHA && env.RECOVERY_BASE_SHA !== intent.recoveryBaseSha)
    )
      throw new Error('Manual hotfix inputs conflict with the bound release intent');
    await store.assertReleasePr(intent);
    if (mode === 'hotfix') {
      const baseline = await deliveredBaseline(store, intent.baseVersion, intent.baseSourcesHash);
      await store.assertHotfixBase(baseline, intent.prBaseSha);
    }
  }
  const result = await resolveSources(
    {
      version,
      ossSha,
      mode,
      firstRelease: intent?.mode === 'initialize' || env.FIRST_RELEASE === 'true',
      write: env.WRITE_SOURCES === 'true',
      cloudSha: intent?.cloudSha || env.CLOUD_REF || undefined,
      baseVersion: intent?.baseVersion || env.BASE_VERSION || undefined,
      baseSourcesHash: intent?.baseSourcesHash || env.BASE_SOURCES_HASH || undefined,
      overrideReason: intent?.overrideReason || env.CLOUD_OVERRIDE_REASON || undefined,
      recoveryBaseSha: intent?.recoveryBaseSha || env.RECOVERY_BASE_SHA || undefined,
      evidence: {
        runId: mode === 'import' ? env.EVIDENCE_RUN_ID : env.GITHUB_RUN_ID,
        runAttempt: Number(mode === 'import' ? env.EVIDENCE_RUN_ATTEMPT : env.GITHUB_RUN_ATTEMPT),
      },
    },
    {
      store,
      latestCloud: store.latestCloud,
      assertCloudCommit: store.assertCloudCommit,
      assertImportEvidence: store.assertImportEvidence,
    },
  );
  const dir = env.RUNNER_TEMP || process.cwd();
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'desktop-release-sources.json'),
    `${JSON.stringify(result.sources, null, 2)}\n`,
  );
  await output(env, {
    oss_sha: result.sources.ossSha,
    cloud_sha: result.sources.cloudSha,
    sources_hash: result.hash,
    persisted: result.persisted,
    build_required: mode !== 'import',
    version,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReleaseCli(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
