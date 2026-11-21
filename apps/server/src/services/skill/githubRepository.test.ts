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
