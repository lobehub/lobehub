import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const patchStages = {
  checkout: 'checkout-failed',
  server: 'server-config-failed',
  base: 'base-fetch-failed',
  setup: 'environment-setup-failed',
  app_version: 'app-version-failed',
  gate: 'hash-compute-failed',
  version: 'patch-version-failed',
  renderer: 'renderer-build-failed',
  sign: 'manifest-sign-failed',
  publish: 'upload-failed',
};
const buildStages = {
  setup: 'environment-setup-failed',
  app_version: 'app-version-failed',
  build_macos: 'desktop-build-failed',
  build_windows: 'desktop-build-failed',
  build_linux: 'desktop-build-failed',
  upload: 'artifact-preparation-failed',
};

const releaseStages = {
  setup: 'environment-setup-failed',
  validate: 'baseline-validation-failed',
  installers: 'installer-upload-failed',
  base: 'renderer-base-upload-failed',
};

export function classifyResult(steps, kind = 'patch', jobStatus = '') {
  const result = (outcome, reason, requiresFullRelease = false) => ({
    outcome,
    reason,
    requiresFullRelease,
    published: outcome === 'published',
    version: outcome === 'published' ? (steps.version?.outputs?.version ?? '') : '',
  });
  for (const [id, reason] of Object.entries(
    kind === 'patch' ? patchStages : kind === 'release' ? releaseStages : buildStages,
  )) {
    if (steps[id]?.outcome === 'failure') {
      if (kind === 'patch' && id === 'base' && steps.base.outputs?.reason === 'base-invalid')
        return result('failed', 'base-invalid');
      return result(
        'failed',
        id === 'gate' && steps.gate.outputs?.main_hash ? 'hash-comparison-failed' : reason,
      );
    }
  }
  if (
    kind === 'release' &&
    steps.base?.outcome === 'success' &&
    steps.base.outputs?.published === 'true'
  )
    return result('published', 'published');
  if (kind === 'patch' && steps.publish?.outcome === 'success')
    return result('published', 'published');
  if (
    jobStatus === 'cancelled' ||
    Object.values(steps).some((step) => step.outcome === 'cancelled')
  ) {
    return result('skipped', 'cancelled');
  }
  if (kind === 'release')
    return result('skipped', steps.base?.outputs?.reason || 'release-incomplete');
  if (kind === 'build') {
    if (jobStatus === 'failure') return result('failed', 'build-job-failed');
    return steps.upload?.outcome === 'success'
      ? result('built', 'artifacts-ready')
      : result('skipped', 'build-incomplete');
  }
  const base = steps.base?.outputs ?? {};
  if (steps.base?.outcome === 'success' && base.found === 'false') {
    if (['base-missing', 'unsupported-base'].includes(base.reason))
      return result('skipped', base.reason, true);
    return result('failed', 'base-unavailable');
  }
  if (steps.gate?.outcome === 'success' && steps.gate.outputs?.allowed === 'false') {
    return steps.gate.outputs.reason === 'main-changed'
      ? result('skipped', 'main-changed', true)
      : result('failed', 'hash-comparison-failed');
  }
  return result('failed', 'pipeline-incomplete');
}

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writeDiagnostics({ root = process.cwd(), env = process.env } = {}) {
  const steps = JSON.parse(env.STEPS_JSON || '{}');
  const result = classifyResult(steps, env.DIAGNOSTIC_KIND, env.JOB_STATUS);
  const lock = await readOptional(path.join(root, 'apps/desktop/pnpm-lock.yaml'));
  const packageJson = await readOptional(path.join(root, 'apps/desktop/package.json'));
  const releaseDir = env.DIAGNOSTIC_KIND === 'release' ? 'release' : 'apps/desktop/release';
  const inputText = await readOptional(
    path.join(root, releaseDir, 'renderer-mainhash-inputs.json'),
  );
  let inputs;
  let inputManifestStatus = 'missing';
  if (inputText) {
    try {
      inputs = JSON.parse(inputText);
      inputManifestStatus = 'available';
    } catch {
      inputManifestStatus = 'invalid';
    }
  }
  let pnpmVersion = null;
  try {
    pnpmVersion = (await exec('pnpm', ['--version'], { timeout: 5000, cwd: root })).stdout.trim();
  } catch {
    /* Setup may have failed before pnpm was installed; preserve the diagnostic anyway. */
  }
  const report = {
    ...result,
    version:
      result.published && env.DIAGNOSTIC_KIND === 'release'
        ? env.APP_VERSION || ''
        : result.version,
    kind: env.DIAGNOSTIC_KIND || 'patch',
    channel: env.CHANNEL || null,
    appVersion:
      env.APP_VERSION ||
      steps.base?.outputs?.app_version ||
      (packageJson ? JSON.parse(packageJson).version : null),
    commit: env.GITHUB_SHA || null,
    cloudRef: env.CLOUD_REF || steps.base?.outputs?.cloud_ref || null,
    runId: env.GITHUB_RUN_ID || null,
    runAttempt: env.GITHUB_RUN_ATTEMPT || null,
    job: env.GITHUB_JOB || null,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    pnpmVersion,
    lockSha256: lock
      ? createHash('sha256').update(lock.replaceAll('\r\n', '\n')).digest('hex')
      : null,
    algorithm: inputs?.algorithm || null,
    mainHash: steps.gate?.outputs?.main_hash || inputs?.mainHash || null,
    baseMainHash: steps.base?.outputs?.main_hash || null,
    inputManifestStatus,
    inputCount: Array.isArray(inputs?.inputs) ? inputs.inputs.length : null,
    stages: Object.fromEntries(
      Object.entries(steps).map(([id, step]) => [id, step.outcome ?? 'unknown']),
    ),
  };
  const dir = path.join(root, 'renderer-ota-diagnostics');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  const summary = [
    '## Renderer OTA diagnostics',
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...Object.entries(report).map(
      ([key, value]) => `| ${key} | ${JSON.stringify(value).replaceAll('|', '\\|')} |`,
    ),
    '',
  ].join('\n');
  await writeFile(path.join(dir, 'summary.md'), summary);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary);
  if (env.GITHUB_OUTPUT)
    await appendFile(
      env.GITHUB_OUTPUT,
      `published=${result.published}\nreason=${result.reason}\nrequires_full_release=${result.requiresFullRelease}\nversion=${report.version}\n`,
    );
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeDiagnostics();
}
