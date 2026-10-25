// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canManageAcceptance, filterManageableAcceptances } from './acceptanceWriteScope';

const getMember = vi.hoisted(() => vi.fn());
const getRolesInWorkspaces = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: class {
    getMember = getMember;
    getRolesInWorkspaces = getRolesInWorkspaces;
  },
}));

const db = {} as never;
const row = (userId: string, workspaceId: string | null) =>
  ({ userId, workspaceId }) as { userId: string; workspaceId: string | null };

beforeEach(() => {
  getMember.mockReset();
  getRolesInWorkspaces.mockReset();
});

describe('canManageAcceptance', () => {
  it('always lets the creator write, without a membership lookup', async () => {
    await expect(
      canManageAcceptance({ serverDB: db, userId: 'me' }, row('me', 'ws_a')),
    ).resolves.toBe(true);
    expect(getMember).not.toHaveBeenCalled();
  });

  it("lets an owner of the acceptance's OWN workspace write a teammate's delivery", async () => {
    getMember.mockResolvedValue({ role: 'owner' });

    await expect(
      canManageAcceptance({ serverDB: db, userId: 'me' }, row('teammate', 'ws_a')),
    ).resolves.toBe(true);
    // The row's workspace, never the caller's active one — the caller is
    // routinely standing somewhere else, or nowhere.
    expect(getMember).toHaveBeenCalledWith('ws_a', 'me');
  });

  it("lets an admin of the acceptance's own workspace write a teammate's delivery", async () => {
    getMember.mockResolvedValue({ role: 'admin' });

    await expect(
      canManageAcceptance({ serverDB: db, userId: 'me' }, row('teammate', 'ws_a')),
    ).resolves.toBe(true);
    expect(getMember).toHaveBeenCalledWith('ws_a', 'me');
  });

  it('does not let a viewer write a teammate delivery', async () => {
    getMember.mockResolvedValue({ role: 'viewer' });

    await expect(
      canManageAcceptance({ serverDB: db, userId: 'me' }, row('teammate', 'ws_a')),
    ).resolves.toBe(false);
  });

  // A member holds write access, like a repository's write permission that is
  // enough to merge a pull request — only viewers are kept to comments.
  it("lets an ordinary member of the acceptance's own workspace write a teammate's delivery", async () => {
    getMember.mockResolvedValue({ role: 'member' });

    await expect(
      canManageAcceptance({ serverDB: db, userId: 'me' }, row('teammate', 'ws_a')),
    ).resolves.toBe(true);
    expect(getMember).toHaveBeenCalledWith('ws_a', 'me');
  });

  it('does not let a non-member write it', async () => {
    getMember.mockResolvedValue(undefined);

    await expect(
      canManageAcceptance({ serverDB: db, userId: 'me' }, row('teammate', 'ws_a')),
    ).resolves.toBe(false);
  });

  it('has no owner path for a personal acceptance — only its creator writes it', async () => {
    await expect(
      canManageAcceptance({ serverDB: db, userId: 'me' }, row('teammate', null)),
    ).resolves.toBe(false);
    expect(getMember).not.toHaveBeenCalled();
  });

  it('refuses an anonymous caller', async () => {
    await expect(canManageAcceptance({ serverDB: db }, row('teammate', 'ws_a'))).resolves.toBe(
      false,
    );
    expect(getMember).not.toHaveBeenCalled();
  });
});

describe('filterManageableAcceptances', () => {
  it('applies the same rule as the single-row check', async () => {
    getRolesInWorkspaces.mockResolvedValue(
      new Map([
        ['ws_owned', 'owner'],
        ['ws_admin', 'admin'],
        ['ws_member', 'member'],
        ['ws_viewer', 'viewer'],
      ]),
    );

    const rows = [
      row('me', null),
      row('me', 'ws_member'),
      row('teammate', 'ws_owned'),
      row('teammate', 'ws_admin'),
      row('teammate', 'ws_member'),
      row('teammate', 'ws_viewer'),
      row('teammate', null),
    ];
    await expect(
      filterManageableAcceptances({ serverDB: db, userId: 'me' }, rows),
    ).resolves.toEqual([
      row('me', null),
      row('me', 'ws_member'),
      row('teammate', 'ws_owned'),
      row('teammate', 'ws_admin'),
      row('teammate', 'ws_member'),
    ]);
  });

  it('reads roles for every distinct foreign workspace in one query', async () => {
    getRolesInWorkspaces.mockResolvedValue(
      new Map([
        ['ws_a', 'owner'],
        ['ws_b', 'owner'],
      ]),
    );

    const rows = [
      row('teammate', 'ws_a'),
      row('teammate', 'ws_a'),
      row('teammate', 'ws_a'),
      row('teammate', 'ws_b'),
      // Creator rows and personal rows need no lookup at all.
      row('me', 'ws_c'),
      row('teammate', null),
    ];
    await expect(
      filterManageableAcceptances({ serverDB: db, userId: 'me' }, rows),
    ).resolves.toHaveLength(5);
    expect(getRolesInWorkspaces).toHaveBeenCalledOnce();
    expect(getRolesInWorkspaces).toHaveBeenCalledWith(['ws_a', 'ws_b'], 'me');
    expect(getMember).not.toHaveBeenCalled();
  });

  it('returns nothing for an anonymous caller', async () => {
    await expect(filterManageableAcceptances({ serverDB: db }, [row('me', null)])).resolves.toEqual(
      [],
    );
    expect(getRolesInWorkspaces).not.toHaveBeenCalled();
  });
});
