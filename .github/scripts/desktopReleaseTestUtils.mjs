import { createServer } from 'node:http';

export const fixtureOss = '483c4a343e437bf6e812b5f71a9a47ce7b5c7be4';
export const fixtureCloud = 'bae4221819d5d3090a606610e6af3c28715749aa';
export const fixtureNextOss = '90659e0ed1327cd9bccb065d30b8edd09a8e9064';
export const fixtureNextCloud = '1df42564c5b35f21b24bcca164d71183b0619525';
export const fixtureSources = {
  schemaVersion: 1,
  channel: 'stable',
  version: '2.2.21',
  ossSha: fixtureOss,
  cloudSha: fixtureCloud,
  selection: 'latest',
  baseVersion: null,
  evidence: { runId: '40841847688', runAttempt: 1 },
};

// A real HTTP boundary shared by the GitHub adapter and CLI process tests.
export async function startGithubFixture() {
  const releases = new Map();
  const assets = new Map();
  const commits = new Map([
    ['v2.2.21', fixtureOss],
    ['v2.2.22', fixtureNextOss],
    ['main', fixtureNextOss],
  ]);
  let serial = 100;
  const state = { cloud: fixtureNextCloud, error: null, rejectHead: false, intercept: null };
  const json = (response, status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (state.intercept?.(request, response, url)) return;
    if (state.error) return json(response, state.error, { message: 'GitHub test error' });
    const route = url.pathname.replace('/repos/example/lobehub', '');
    if (url.pathname.startsWith('/repos/example/cloud/commits/')) {
      if (request.headers.authorization !== 'Bearer cloud-test-token')
        return json(response, 403, { message: 'wrong Cloud token' });
      const ref = url.pathname.split('/').pop();
      if (ref === 'HEAD' && state.rejectHead)
        return json(response, 500, { message: 'HEAD forbidden' });
      return json(response, 200, { sha: ref === 'HEAD' ? state.cloud : ref });
    }
    if (route.startsWith('/commits/')) {
      const sha = commits.get(decodeURIComponent(route.slice('/commits/'.length)));
      return json(response, sha ? 200 : 404, sha ? { sha } : { message: 'not found' });
    }
    if (route.startsWith('/actions/runs/'))
      return json(response, 200, { id: 40841847688, head_sha: fixtureOss, run_attempt: 1 });
    if (route === '/releases')
      return json(
        response,
        200,
        [...releases.values()].map((release) => ({ ...release, assets: undefined })),
      );
    if (route.startsWith('/compare/'))
      return json(
        response,
        200,
        state.comparison || { status: 'identical', total_commits: 0, files: [] },
      );
    if (route.startsWith('/releases/tags/')) {
      const release = releases.get(route.slice('/releases/tags/v'.length));
      return json(
        response,
        release ? 200 : 404,
        release ? { ...release, assets: undefined } : { message: 'not found' },
      );
    }
    if (route.startsWith('/releases/assets/')) {
      const asset = assets.get(Number(route.split('/').pop()));
      if (!asset) return json(response, 404, { message: 'not found' });
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return response.end(asset.content);
    }
    const match = route.match(/^\/(?:uploads|releases)\/(\d+)\/assets$/);
    if (match) {
      const release = [...releases.values()].find((entry) => entry.id === Number(match[1]));
      if (!release) return json(response, 404, { message: 'not found' });
      if (request.method === 'POST') {
        const name = url.searchParams.get('name');
        if (release.assets.some((asset) => asset.name === name))
          return json(response, 422, { errors: [{ code: 'already_exists', field: 'name' }] });
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const asset = addAsset(release.tag_name.slice(1), name, Buffer.concat(chunks).toString());
        return json(response, 201, asset);
      }
      const start = (Number(url.searchParams.get('page') || 1) - 1) * 100;
      return json(response, 200, release.assets.slice(start, start + 100));
    }
    if (route.startsWith('/pulls/')) {
      const pr = state.pullRequest;
      return json(response, pr ? 200 : 404, pr || { message: 'not found' });
    }
    return json(response, 404, { message: `Unknown fixture route ${route}` });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  function addRelease(version) {
    releases.set(version, {
      id: ++serial,
      tag_name: `v${version}`,
      draft: false,
      prerelease: false,
      upload_url: `${apiUrl}/repos/example/lobehub/uploads/${serial}/assets{?name,label}`,
      assets: [],
    });
  }
  function addAsset(version, name, content) {
    const asset = { id: ++serial, name, state: 'uploaded', size: Buffer.byteLength(content) };
    assets.set(asset.id, { ...asset, content });
    releases.get(version).assets.push(asset);
    return asset;
  }
  addRelease('2.2.21');
  addRelease('2.2.22');
  return {
    apiUrl,
    state,
    releases,
    commits,
    assets,
    addAsset,
    addRelease,
    options: {
      apiUrl,
      repository: 'example/lobehub',
      token: 'oss-test-token',
      cloudRepository: 'example/cloud',
      cloudToken: 'cloud-test-token',
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
