import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAppUrl, resolveAppUrl } from './url';

vi.mock('../../api/workspace', () => ({ resolveWorkspaceId: vi.fn() }));
vi.mock('../../settings', () => ({ resolveServerUrl: () => 'https://app.example.com' }));

const { resolveWorkspaceId } = await import('../../api/workspace');

describe('app URLs', () => {
  afterEach(() => {
    vi.mocked(resolveWorkspaceId).mockReset();
  });

  it('builds a workspace-aware URL and encodes the workspace slug', () => {
    expect(
      buildAppUrl({
        pathname: '/goal/goal-1',
        serverUrl: 'https://app.example.com',
        workspaceSlug: 'Lobe Hub',
      }),
    ).toBe('https://app.example.com/Lobe%20Hub/goal/goal-1');
  });

  it('does not fetch workspace context in personal mode', async () => {
    vi.mocked(resolveWorkspaceId).mockReturnValue(undefined);
    const query = vi.fn();

    await expect(
      resolveAppUrl({ workspace: { getById: { query } } } as never, '/project/prj-1'),
    ).resolves.toBe('https://app.example.com/project/prj-1');
    expect(query).not.toHaveBeenCalled();
  });

  it('uses the server-resolved slug in workspace mode', async () => {
    vi.mocked(resolveWorkspaceId).mockReturnValue('ws-1');
    const query = vi.fn().mockResolvedValue({ id: 'ws-1', slug: 'lobehub' });

    await expect(
      resolveAppUrl({ workspace: { getById: { query } } } as never, '/agent/agt-1'),
    ).resolves.toBe('https://app.example.com/lobehub/agent/agt-1');
  });
});
