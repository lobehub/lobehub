// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { GitHub } from '@/server/modules/GitHub';
import { redisService } from '@/server/services/redis';

import { GitHubSkillRepository } from './githubRepository';

const info = { branch: 'HEAD', owner: 'owner', repo: 'private' };
const commit = 'a'.repeat(40);
const signed = 'https://codeload.github.com/owner/private/zip/' + commit + '?token=temporary';
const snapshot = { data: { repository: { object: { oid: commit, zipballUrl: signed } } } };
const proxy = vi.fn();
const source = () => new GitHubSkillRepository(new GitHub(), proxy);
const missing = () => new Response(null, { status: 404 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  proxy.mockReset();
});

it('resolves a private HEAD with the connector and downloads the pinned archive without credentials', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(missing()).mockResolvedValueOnce(new Response('zip'));
  vi.stubGlobal('fetch', fetch);
  const record = vi.spyOn(redisService.gitHubRefs, 'record');
  proxy.mockResolvedValue({ data: snapshot, status: 200 });
  const repo = source();
  expect(await repo.resolveCommit(info)).toEqual({ commit, public: false });
  expect(await repo.downloadCommitZip(info, commit)).toEqual(Buffer.from('zip'));
  expect(record).not.toHaveBeenCalled();
  expect(proxy).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        variables: { owner: 'owner', repo: 'private', ref: 'HEAD' },
      }),
      endpoint: '/graphql',
      provider: 'github',
    }),
  );
  expect(fetch.mock.calls[1]).toEqual([
    signed,
    { redirect: 'manual', signal: expect.any(AbortSignal) },
  ]);
});

it('checks connector access again on a new pinned batch request', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(missing()));
  proxy.mockResolvedValue({ data: { error: { code: 'NOT_CONNECTED' } }, status: 403 });
  await expect(source().downloadCommitZip(info, commit)).rejects.toMatchObject({
    code: 'CONNECT_GITHUB',
  });
});

it('distinguishes an inaccessible repository from an unconnected account', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(missing()));
  proxy.mockResolvedValue({ data: { errors: [{ type: 'NOT_FOUND' }] }, status: 200 });
  await expect(source().resolveCommit(info)).rejects.toMatchObject({ code: 'GITHUB_ACCESS' });
});

it('does not consult the connector for a public commit', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(commit)));
  vi.spyOn(redisService.gitHubRefs, 'record').mockResolvedValue();
  expect(await source().resolveCommit(info)).toEqual({ commit, public: true });
  expect(proxy).not.toHaveBeenCalled();
});

it('rejects an archive redirect outside GitHub before issuing another request', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(missing())
    .mockResolvedValueOnce(
      new Response(null, { headers: { location: 'https://example.org/archive' }, status: 302 }),
    );
  vi.stubGlobal('fetch', fetch);
  proxy.mockResolvedValue({ data: snapshot, status: 200 });
  await expect(source().downloadCommitZip(info, commit)).rejects.toThrow(
    'Invalid GitHub archive location',
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('rejects a connector snapshot that does not match the selected commit', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(missing()));
  proxy.mockResolvedValue({ data: snapshot, status: 200 });
  await expect(source().downloadCommitZip(info, 'b'.repeat(40))).rejects.toThrow(
    'different commit',
  );
});

const token = 'ghp_vaulttoken';
const vaultSource = (vaultToken = vi.fn().mockResolvedValue(token)) =>
  new GitHubSkillRepository(new GitHub(), proxy, vaultToken);
const authOf = (init?: RequestInit) => new Headers(init?.headers).get('authorization');

it('resolves a private ref with the Vault token before asking the connector', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(missing())
    .mockResolvedValueOnce(new Response(commit));
  vi.stubGlobal('fetch', fetch);
  const record = vi.spyOn(redisService.gitHubRefs, 'record');
  expect(await vaultSource().resolveCommit(info)).toEqual({ commit, public: false });
  expect(authOf(fetch.mock.calls[0][1])).toBeNull();
  expect(fetch.mock.calls[1][0]).toBe('https://api.github.com/repos/owner/private/commits/HEAD');
  expect(authOf(fetch.mock.calls[1][1])).toBe(`Bearer ${token}`);
  expect(record).not.toHaveBeenCalled();
  expect(proxy).not.toHaveBeenCalled();
});

it('does not cache a token-resolved ref for everyone in update checks', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce(missing()).mockResolvedValueOnce(new Response(commit)),
  );
  const remember = vi
    .spyOn(redisService.gitHubRefs, 'remember')
    .mockImplementation(async (_info, resolve) => resolve());
  expect(await vaultSource().resolveCommit(info, true)).toEqual({ commit, public: false });
  expect(remember).toHaveBeenCalledTimes(1);
});

it('sends the Vault token only to api.github.com when downloading a private archive', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(missing())
    .mockResolvedValueOnce(new Response(null, { headers: { location: signed }, status: 302 }))
    .mockResolvedValueOnce(new Response('zip'));
  vi.stubGlobal('fetch', fetch);
  expect(await vaultSource().downloadCommitZip(info, commit)).toEqual(Buffer.from('zip'));
  expect(fetch.mock.calls[1][0]).toBe(
    `https://api.github.com/repos/owner/private/zipball/${commit}`,
  );
  expect(authOf(fetch.mock.calls[1][1])).toBe(`Bearer ${token}`);
  expect(fetch.mock.calls[2][0]).toBe(signed);
  expect(authOf(fetch.mock.calls[2][1])).toBeNull();
  expect(proxy).not.toHaveBeenCalled();
});

it('falls through to the connector when GitHub rejects the Vault token', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(missing())
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  proxy.mockResolvedValue({ data: snapshot, status: 200 });
  const vaultToken = vi.fn().mockResolvedValue(token);
  const repo = vaultSource(vaultToken);
  expect(await repo.resolveCommit(info)).toEqual({ commit, public: false });
  expect(proxy).toHaveBeenCalledTimes(1);

  // A rejected token is not retried for the rest of the request.
  fetch.mockResolvedValueOnce(missing());
  proxy.mockResolvedValue({ data: snapshot, status: 200 });
  await repo.resolveCommit(info);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(vaultToken).toHaveBeenCalledTimes(1);
});

it('falls through to the connector when the Vault token cannot read the repository', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(missing()));
  proxy.mockResolvedValue({ data: { error: { code: 'NOT_CONNECTED' } }, status: 403 });
  await expect(vaultSource().resolveCommit(info)).rejects.toMatchObject({
    code: 'CONNECT_GITHUB',
    message: expect.stringContaining('GITHUB_TOKEN'),
  });
});

it('does not ask the Vault for a missing ref', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 422 })));
  const vaultToken = vi.fn();
  await expect(vaultSource(vaultToken).resolveCommit(info)).rejects.toMatchObject({ status: 422 });
  expect(vaultToken).not.toHaveBeenCalled();
});
