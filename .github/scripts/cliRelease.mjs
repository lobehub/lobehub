import { execFile } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const tagPrefix = 'cli-release/v';
const stablePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parts(version) {
  if (typeof version !== 'string' || !stablePattern.test(version)) {
    throw new Error(`Expected a stable version, got ${version}`);
  }
  return version.split('.').map(BigInt);
}

function compare(a, b) {
  const right = parts(b);
  for (const [i, left] of parts(a).entries()) {
    if (left !== right[i]) return left > right[i] ? 1 : -1;
  }
  return 0;
}

/** Pure release decisions; tags reserve versions even while npm is processing. */
export async function planRelease({ sourceVersion, metadata, reservations, sha, isAncestor }) {
  parts(sourceVersion);
  if (!metadata.versions || !metadata['dist-tags']?.latest) {
    throw new Error('Registry response is missing versions or latest');
  }
  parts(metadata['dist-tags'].latest);
  const versions = Object.keys(metadata.versions).filter((version) => stablePattern.test(version));
  if (!versions.includes(metadata['dist-tags'].latest)) {
    throw new Error('Registry latest is missing from versions');
  }
  const newest = versions.sort(compare).at(-1);
  const ordered = [...reservations].sort((a, b) => compare(b.version, a.version));
  const existing = ordered.find((entry) => entry.sha === sha);
  if (existing) {
    const published = metadata.versions[existing.version];
    if (published) {
      if (published.gitHead !== sha) throw new Error(`Source mismatch for ${existing.version}`);
      if (existing.version === newest && metadata['dist-tags'].latest !== existing.version) {
        throw new Error(
          `latest does not point to ${existing.version}; publication is not verified`,
        );
      }
      return { publish: false, reason: `${existing.version} is already published` };
    }
    if (compare(existing.version, newest) <= 0) {
      return { publish: false, reason: 'A newer version has already been published' };
    }
  }
  for (const entry of ordered) {
    if (entry.sha !== sha && (await isAncestor(sha, entry.sha))) {
      return { publish: false, reason: 'A newer source commit already has a release reservation' };
    }
    if (
      entry.sha !== sha &&
      compare(entry.version, newest) > 0 &&
      !metadata.versions[entry.version]
    ) {
      throw new Error(
        `Release ${entry.version} (${entry.sha}) is unfinished; rerun its original workflow first`,
      );
    }
  }
  if (existing) return { publish: true, version: existing.version, reserved: true };
  const next = parts(newest);
  next[2]++;
  const incremented = next.join('.');
  const version = compare(sourceVersion, incremented) > 0 ? sourceVersion : incremented;
  return { publish: true, version, reserved: false };
}

export async function readRegistry(name, request = fetch) {
  const response = await request(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Registry lookup failed: HTTP ${response.status}`);
  return response.json();
}

export async function verifyPublication({
  name,
  version,
  sha,
  read = readRegistry,
  sleep = setTimeout,
  attempts = 60,
}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const metadata = await read(name);
    const published = metadata.versions?.[version];
    if (published) {
      if (published.gitHead !== sha) throw new Error(`Source mismatch for ${name}@${version}`);
      if (metadata['dist-tags']?.latest !== version)
        throw new Error(`latest does not point to ${version}`);
      return;
    }
    if (attempt + 1 < attempts) await sleep(10_000);
  }
  throw new Error(
    `${name}@${version} is not visible yet. Its version stays reserved; rerun this workflow, not a new release`,
  );
}

async function git(...args) {
  return (await exec('git', args)).stdout.trim();
}

export async function prepareRelease({ env = process.env, read = readRegistry } = {}) {
  const packagePath = 'apps/cli/package.json';
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  const sha = await git('rev-parse', 'HEAD');
  // No forced tag updates: a collision must fail, never overwrite a reservation.
  await git('fetch', 'origin', `refs/tags/${tagPrefix}*:refs/tags/${tagPrefix}*`);
  const tags = await git(
    'for-each-ref',
    '--format=%(refname:strip=2) %(objectname)',
    `refs/tags/${tagPrefix}*`,
  );
  const reservations = tags
    ? tags.split('\n').map((line) => {
        const [tag, commit] = line.split(' ');
        return { version: tag.slice(tagPrefix.length), sha: commit };
      })
    : [];
  const plan = await planRelease({
    sourceVersion: pkg.version,
    metadata: await read(pkg.name),
    reservations,
    sha,
    isAncestor: async (ancestor, descendant) => {
      try {
        await git('merge-base', '--is-ancestor', ancestor, descendant);
        return true;
      } catch (error) {
        if (error.code === 1) return false;
        throw error;
      }
    },
  });
  if (plan.publish) {
    // npm pack receives the generated version and explicit source identity.
    // The checkout and its checked-in manual are never committed back to canary.
    pkg.version = plan.version;
    pkg.gitHead = sha;
    await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  console.log(plan.publish ? `Prepared ${pkg.name}@${plan.version} from ${sha}` : plan.reason);
  if (env.GITHUB_OUTPUT) {
    await appendFile(
      env.GITHUB_OUTPUT,
      `publish=${plan.publish}\n${plan.publish ? `version=${plan.version}\n` : ''}`,
    );
  }
  return plan;
}

export async function reserveRelease() {
  const pkg = JSON.parse(await readFile('apps/cli/package.json', 'utf8'));
  parts(pkg.version);
  const sha = await git('rev-parse', 'HEAD');
  if (pkg.gitHead !== sha) throw new Error('Prepared package does not match the checkout');
  const tag = `${tagPrefix}${pkg.version}`;
  const existing = await git('tag', '--list', tag);
  if (existing) {
    if ((await git('rev-parse', tag)) !== sha) throw new Error(`Reservation conflict for ${tag}`);
  } else {
    await git('tag', tag, sha);
  }
  await git('push', 'origin', `refs/tags/${tag}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] === 'prepare') {
    await prepareRelease();
  } else if (process.argv[2] === 'reserve') {
    await reserveRelease();
  } else if (process.argv[2] === 'verify') {
    const pkg = JSON.parse(await readFile('apps/cli/package.json', 'utf8'));
    await verifyPublication({ name: pkg.name, version: pkg.version, sha: pkg.gitHead });
    console.log(`Verified ${pkg.name}@${pkg.version} on npm latest`);
  } else {
    throw new Error('Usage: node .github/scripts/cliRelease.mjs prepare|reserve|verify');
  }
}
