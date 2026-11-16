import { afterEach, describe, expect, it, vi } from 'vitest';

import { TfsClient } from './client';
import { requestTfs } from './transport';

vi.mock('./transport', () => ({ requestTfs: vi.fn() }));
const client = new TfsClient('https://tfs.example.com/Collection', {
  authType: 'pat',
  secret: 'test-only-token',
  username: '',
});
const json = (data: unknown, continuation?: string) => ({
  body: Buffer.from(JSON.stringify(data)),
  continuation,
});
afterEach(() => vi.resetAllMocks());

describe('TFS read results', () => {
  it('preserves branch pagination and normalizes Git branch refs', async () => {
    vi.mocked(requestTfs).mockResolvedValue(
      json({ value: [{ name: 'refs/heads/feature/a' }] }, 'next'),
    );
    await expect(client.branches('Project', 'repo')).resolves.toEqual({
      items: [{ name: 'feature/a' }],
      next: 'next',
    });
  });

  it('distinguishes missing checks from checks that could not be read', async () => {
    vi.mocked(requestTfs).mockImplementation(async (_base, _credentials, path) => {
      if (path.endsWith('/statuses')) throw new Error('forbidden');
      if (path.endsWith('/1'))
        return json({
          status: 'active',
          repository: { project: { id: 'project-id', name: 'Project' } },
        });
      return json({ value: [] });
    });
    const failed = await client.detail('Project', 'prs', 1, 'repo');
    expect(failed.items.map((r) => r.id)).toContain('checks-unavailable');
    expect(failed.items.map((r) => r.id)).not.toContain('no-checks');
    vi.mocked(requestTfs).mockImplementation(async (_base, _credentials, path) =>
      path.endsWith('/1')
        ? json({ status: 'active', repository: { project: { id: 'project-id', name: 'Project' } } })
        : json({ value: [] }),
    );
    const empty = await client.detail('Project', 'prs', 1, 'repo');
    expect(empty.items.map((r) => r.id)).toContain('no-checks');
    expect(empty.items.every((r) => r.state !== 'succeeded')).toBe(true);
  });

  it('does not treat a completed failed build as successful', async () => {
    vi.mocked(requestTfs).mockResolvedValue(
      json({
        records: [{ id: 'job', name: 'Test', result: 'failed', state: 'completed', type: 'Job' }],
      }),
    );
    expect((await client.detail('Project', 'builds', 1)).items[0].state).toBe('failed');
  });

  it('rejects TFVC paths outside the project before requesting a file', async () => {
    for (const path of [
      '$/Other/file',
      '$/Project/../Other/file',
      '$/Project/a\\b',
      '$/Project/a\0b',
    ])
      await expect(client.tfvcFile('Project', path, 10)).rejects.toThrow('TFS_INVALID_TFVC_PATH');
    expect(requestTfs).not.toHaveBeenCalled();
  });

  it('bounds build logs to one hundred returned lines', async () => {
    vi.mocked(requestTfs).mockResolvedValue({
      body: Buffer.from(Array.from({ length: 200 }, (_, i) => String(i)).join('\n')),
    });
    expect((await client.log('Project', 1, 1, 0)).split('\n')).toHaveLength(100);
  });
});
