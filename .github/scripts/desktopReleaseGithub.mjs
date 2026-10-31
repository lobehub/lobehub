import {
  assertSha,
  deliveredBaseline,
  normalizeVersion,
  publicationAssetName,
  sourceAssetName,
} from './desktopReleaseSources.mjs';

const repositoryPath = (value) => {
  if (typeof value !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(value))
    throw new Error('A GitHub owner/repository is required');
  return `repos/${value}`;
};

export function createGithubStore(options) {
  const apiUrl = (options.apiUrl || 'https://api.github.com').replace(/\/$/, '');
  const root = repositoryPath(options.repository);
  const releaseCache = new Map();

  async function request(route, { token = options.token, accept, ...init } = {}) {
    const url = route.startsWith('http') ? route : `${apiUrl}/${route}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        'Accept': accept || 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'lobehub-desktop-release',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const error = new Error(
        `GitHub request failed (${response.status}): ${new URL(url).pathname}`,
      );
      error.status = response.status;
      try {
        error.details = await response.json();
      } catch {
        /* Non-JSON errors retain their HTTP status. */
      }
      throw error;
    }
    return response;
  }

  async function release(version, required = true) {
    const normalized = normalizeVersion(version);
    if (releaseCache.has(normalized)) return releaseCache.get(normalized);
    try {
      const result = await (await request(`${root}/releases/tags/v${normalized}`)).json();
      if (result.tag_name !== `v${normalized}`) throw new Error('Release tag mismatch');
      releaseCache.set(normalized, result);
      return result;
    } catch (error) {
      if (!required && error.status === 404) return null;
      throw error;
    }
  }

  async function listAssets(version) {
    const target = await release(version, false);
    if (!target) return [];
    const assets = [];
    for (let page = 1; ; page++) {
      const batch = await (
        await request(`${root}/releases/${target.id}/assets?per_page=100&page=${page}`)
      ).json();
      if (!Array.isArray(batch)) throw new Error('Invalid GitHub asset list');
      assets.push(...batch);
      if (batch.length < 100) return assets;
    }
  }

  async function readAsset(version, name) {
    const matches = (await listAssets(version)).filter((asset) => asset.name === name);
    if (matches.length > 1) throw new Error(`Duplicate release asset: ${name}`);
    if (!matches.length) return null;
    if (matches[0].state !== 'uploaded') throw new Error(`Release asset is not ready: ${name}`);
    const response = await request(`${root}/releases/assets/${matches[0].id}`, {
      accept: 'application/octet-stream',
    });
    try {
      return JSON.parse(await response.text());
    } catch {
      throw new Error(`Invalid JSON in release asset ${name}`);
    }
  }

  async function createAsset(version, name, value) {
    if (!options.token)
      throw new Error('A repository write token is required to save release metadata');
    const target = await release(version);
    const url = new URL(target.upload_url.replace(/\{.*$/, ''));
    const allowed =
      new URL(apiUrl).hostname === 'api.github.com'
        ? 'https://uploads.github.com'
        : new URL(apiUrl).origin;
    if (url.origin !== allowed) throw new Error('Unexpected GitHub upload origin');
    url.searchParams.set('name', name);
    try {
      await request(url.href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: `${JSON.stringify(value, null, 2)}\n`,
      });
      return true;
    } catch (error) {
      if (
        error.status === 422 &&
        error.details?.errors?.some((entry) => entry.code === 'already_exists')
      )
        return false;
      throw error;
    }
  }

  async function resolveCommit(ref) {
    if (typeof ref !== 'string' || !ref || ref.length > 250)
      throw new Error('A source_ref is required');
    const commit = await (await request(`${root}/commits/${encodeURIComponent(ref)}`)).json();
    return assertSha(commit.sha, 'Resolved OSS');
  }

  // PR base.sha is a historical snapshot, not necessarily the merge's first parent.
  async function resolvePrBase(pr) {
    if (pr.base?.ref !== 'main') throw new Error('Release PR must target main');
    if (pr.merged !== true) return resolveCommit('main');
    const mergeSha = assertSha(pr.merge_commit_sha, 'Release merge');
    const commit = await (await request(`${root}/commits/${mergeSha}`)).json();
    if (commit.sha !== mergeSha) throw new Error('Release merge commit SHA mismatch');
    return assertSha(commit.parents?.[0]?.sha, 'Actual merge parent');
  }

  async function cloudCommit(ref) {
    if (!options.cloudToken) throw new Error('A Cloud read token is required');
    const cloud = repositoryPath(options.cloudRepository);
    const commit = await (
      await request(`${cloud}/commits/${encodeURIComponent(ref)}`, { token: options.cloudToken })
    ).json();
    return assertSha(commit.sha, 'Resolved Cloud');
  }

  const store = {
    release,
    listAssets,
    resolveCommit,
    resolvePrBase,
    readSources: (version) => readAsset(version, sourceAssetName),
    createSources: (version, record) => createAsset(version, sourceAssetName, record),
    readPublication: (version) => readAsset(version, publicationAssetName),
    createPublication: (version, receipt) => createAsset(version, publicationAssetName, receipt),
    latestCloud: () => cloudCommit('HEAD'),
    async assertInstallerAssets(version) {
      const target = await release(version);
      if (target.draft || target.prerelease)
        throw new Error('Installer release is not publicly published');
      const assets = (await listAssets(version)).filter(
        (asset) => asset.state === 'uploaded' && asset.size > 0,
      );
      const names = assets.map((asset) => asset.name);
      for (const name of [
        'latest.yml',
        'latest-linux.yml',
        'latest-mac-arm64.yml',
        'latest-mac-x64.yml',
      ])
        if (!names.includes(name)) throw new Error(`Missing installer manifest asset: ${name}`);
      for (const suffix of [
        `-${version}-arm64.dmg`,
        `-${version}-x64.dmg`,
        `-${version}-setup.exe`,
        `-${version}.AppImage`,
      ])
        if (!names.some((name) => name.endsWith(suffix)))
          throw new Error(`Missing installer asset: ${suffix}`);
    },
    async assertCloudCommit(sha) {
      if ((await cloudCommit(assertSha(sha, 'Cloud'))) !== sha)
        throw new Error('Cloud commit SHA mismatch');
    },
    async assertImportEvidence({ ossSha, evidence }) {
      const run = await (
        await request(`${root}/actions/runs/${evidence.runId}/attempts/${evidence.runAttempt}`)
      ).json();
      if (
        String(run.id) !== evidence.runId ||
        run.head_sha !== ossSha ||
        run.run_attempt !== evidence.runAttempt
      )
        throw new Error('Historical run evidence SHA/attempt mismatch');
    },
    async listDelivered() {
      const delivered = [];
      for (let page = 1; page <= 10 && delivered.length < 20; page++) {
        const batch = await (await request(`${root}/releases?per_page=100&page=${page}`)).json();
        for (const entry of batch) {
          if (entry.draft || entry.prerelease || !/^v\d+\.\d+\.\d+$/.test(entry.tag_name)) continue;
          const version = normalizeVersion(entry.tag_name);
          releaseCache.set(version, entry);
          if (!(await store.readSources(version)) || !(await store.readPublication(version)))
            continue;
          delivered.push(await deliveredBaseline(store, version));
          if (delivered.length === 20) break;
        }
        if (batch.length < 100) break;
      }
      return delivered;
    },
    async assertReleasePr(intent) {
      const pr = await (await request(`${root}/pulls/${intent.prNumber}`)).json();
      if (
        pr.number !== intent.prNumber ||
        pr.merged !== true ||
        pr.merge_commit_sha !== intent.mergeSha ||
        pr.base?.ref !== 'main' ||
        (await resolvePrBase(pr)) !== intent.prBaseSha
      )
        throw new Error('Release intent does not match the actual merged PR identity/base');
    },
    async assertHotfixBase(sources, baseSha) {
      assertSha(baseSha, 'PR base');
      if (sources.ossSha === baseSha) return;
      const comparison = await (
        await request(`${root}/compare/${sources.ossSha}...${baseSha}`)
      ).json();
      if (
        comparison.status !== 'ahead' ||
        comparison.total_commits > 250 ||
        !Array.isArray(comparison.files) ||
        comparison.files.length >= 300 ||
        comparison.files.some(
          (file) =>
            !/^(?:\.github\/(?:actions|scripts|workflows)\/|docs\/|scripts\/(?:hotfixWorkflow|releaseWorkflow)\/)/.test(
              file.filename,
            ),
        )
      )
        throw new Error(
          'main contains product changes outside the selected delivered baseline; choose the correct release path',
        );
    },
  };
  return store;
}
