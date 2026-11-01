import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const stageMaps = {
  'gate': {
    'checkout': 'checkout-failed',
    'server': 'server-config-failed',
    'base': 'base-fetch-failed',
    'gate': 'abi-compute-failed',
    'version': 'core-version-failed',
    'cloud-ref': 'cloud-ref-failed',
  },
  'core-build': {
    setup: 'environment-setup-failed',
    app_version: 'app-version-failed',
    build: 'core-build-failed',
    previous: 'previous-manifest-failed',
    core: 'core-release-failed',
    upload: 'artifact-upload-failed',
  },
  'core-publish': {
    collect: 'artifact-download-failed',
    publish: 'upload-failed',
  },
  'build': {
    setup: 'environment-setup-failed',
    app_version: 'app-version-failed',
    build_macos: 'desktop-build-failed',
    build_windows: 'desktop-build-failed',
    build_linux: 'desktop-build-failed',
    upload: 'artifact-preparation-failed',
  },
  'release': {
    setup: 'environment-setup-failed',
    installers: 'installer-upload-failed',
    shell: 'shell-json-failed',
    base: 'core-r0-upload-failed',
  },
};

export function classifyResult(steps, kind = 'gate', jobStatus = '') {
  const result = (outcome, reason, requiresFullRelease = false) => ({
    outcome,
    reason,
    requiresFullRelease,
    published: outcome === 'published',
    version: outcome === 'published' ? (steps.version?.outputs?.version ?? '') : '',
  });
  const stages = stageMaps[kind] ?? stageMaps.gate;
  for (const [id, reason] of Object.entries(stages)) {
    if (steps[id]?.outcome === 'failure') {
      if (kind === 'gate' && id === 'base' && steps.base.outputs?.reason === 'base-invalid')
        return result('failed', 'base-invalid');
      return result('failed', reason);
    }
  }
  if (
    jobStatus === 'cancelled' ||
    Object.values(steps).some((step) => step.outcome === 'cancelled')
  ) {
    return result('skipped', 'cancelled');
  }
  switch (kind) {
    case 'release': {
      if (steps.base?.outcome === 'success' && steps.base.outputs?.published === 'true')
        return result('published', 'published');
      return result('skipped', steps.base?.outputs?.reason || 'release-incomplete');
    }
    case 'build': {
      if (jobStatus === 'failure') return result('failed', 'build-job-failed');
      return steps.upload?.outcome === 'success'
        ? result('built', 'artifacts-ready')
        : result('skipped', 'build-incomplete');
    }
    case 'core-build': {
      if (steps.core?.outputs?.skipped === 'true') return result('skipped', 'core-unchanged');
      return steps.upload?.outcome === 'success'
        ? result('built', 'core-ready')
        : result('failed', 'pipeline-incomplete');
    }
    case 'core-publish': {
      if (steps.publish?.outputs?.published === 'true') return result('published', 'published');
      if (steps.collect?.outputs?.skipped === 'true') return result('skipped', 'core-unchanged');
      return result('failed', 'pipeline-incomplete');
    }
    default: {
      const base = steps.base?.outputs ?? {};
      if (steps.base?.outcome === 'success' && base.found === 'false') {
        return base.reason === 'base-missing'
          ? result('skipped', 'base-missing', true)
          : result('failed', 'base-unavailable');
      }
      if (steps.gate?.outcome === 'success' && steps.gate.outputs?.allowed === 'false')
        return result('skipped', steps.gate.outputs.reason || 'abi-changed', true);
      if (steps.gate?.outcome === 'success' && steps.version?.outcome === 'success')
        return result('gated', 'core-allowed');
      return result('failed', 'pipeline-incomplete');
    }
  }
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
  let pnpmVersion = null;
  try {
    pnpmVersion = (await exec('pnpm', ['--version'], { timeout: 5000, cwd: root })).stdout.trim();
  } catch {
    /* Setup may have failed before pnpm was installed; preserve the diagnostic anyway. */
  }
  const report = {
    ...result,
    version: result.published ? env.APP_VERSION || result.version : result.version,
    kind: env.DIAGNOSTIC_KIND || 'gate',
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
    shellAbi: steps.gate?.outputs?.shell_abi || null,
    baseShellAbi: steps.base?.outputs?.shell_abi || null,
    stages: Object.fromEntries(
      Object.entries(steps).map(([id, step]) => [id, step.outcome ?? 'unknown']),
    ),
  };
  const dir = path.join(root, 'desktop-ota-diagnostics');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  const summary = [
    '## Desktop OTA diagnostics',
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
