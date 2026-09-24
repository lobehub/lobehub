import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveAssigneeUserId } from './assignee';

vi.mock('../../api/workspace', () => ({ resolveWorkspaceId: vi.fn() }));

const { resolveWorkspaceId } = await import('../../api/workspace');

const members = [
  { user: { email: 'neko@ayaka.moe', username: 'neko' }, userId: 'user_neko' },
  { user: { email: 'arvin@lobehub.com', username: 'arvinxx' }, userId: 'user_arvin' },
];

const clientWith = (list = members) => {
  const query = vi.fn().mockResolvedValue(list);
  return { client: { workspaceMember: { list: { query } } } as never, query };
};

describe('resolveAssigneeUserId', () => {
  afterEach(() => {
    vi.mocked(resolveWorkspaceId).mockReset();
  });

  it('passes a raw user id through without a member lookup', async () => {
    const { client, query } = clientWith();

    await expect(resolveAssigneeUserId(client, 'user_neko')).resolves.toBe('user_neko');
    expect(query).not.toHaveBeenCalled();
  });

  it('resolves a member by email or username, case-insensitively', async () => {
    vi.mocked(resolveWorkspaceId).mockReturnValue('ws-1');
    const { client } = clientWith();

    await expect(resolveAssigneeUserId(client, 'Neko@Ayaka.moe')).resolves.toBe('user_neko');
    await expect(resolveAssigneeUserId(client, 'arvinxx')).resolves.toBe('user_arvin');
  });

  it('refuses a non-id value outside a workspace scope', async () => {
    vi.mocked(resolveWorkspaceId).mockReturnValue(undefined);
    const { client, query } = clientWith();

    await expect(resolveAssigneeUserId(client, 'neko')).rejects.toThrow(/outside a workspace/);
    expect(query).not.toHaveBeenCalled();
  });

  it('reports no match and ambiguous matches instead of guessing', async () => {
    vi.mocked(resolveWorkspaceId).mockReturnValue('ws-1');

    await expect(resolveAssigneeUserId(clientWith().client, 'ghost')).rejects.toThrow(
      /No workspace member/,
    );

    const dup = [...members, { user: { email: 'x@y.z', username: 'neko' }, userId: 'user_other' }];
    await expect(resolveAssigneeUserId(clientWith(dup).client, 'neko')).rejects.toThrow(
      /matches 2 members/,
    );
  });
});
