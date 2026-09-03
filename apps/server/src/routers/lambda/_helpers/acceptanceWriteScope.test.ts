// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canManageAcceptance, filterManageableAcceptances } from './acceptanceWriteScope';

const getMember = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: class {
    getMember = getMember;
  },
}));

const db = {} as never;
const row = (userId: string, workspaceId: string | null) =>
  ({ userId, workspaceId }) as { userId: string; workspaceId: string | null };

beforeEach(() => {
  getMember.mockReset();
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

  it('does not let an ordinary member write a teammate delivery', async () => {
    getMember.mockResolvedValue({ role: 'member' });

    await expect(
      canManageAcceptance({ serverDB: db, userId: 'me' }, row('teammate', 'ws_a')),
    ).resolves.toBe(false);
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
    getMember.mockImplementation(async (workspaceId: string) =>
      workspaceId === 'ws_owned' ? { role: 'owner' } : { role: 'member' },
    );

    const rows = [
      row('me', null),
      row('me', 'ws_member'),
      row('teammate', 'ws_owned'),
      row('teammate', 'ws_member'),
      row('teammate', null),
    ];
    await expect(
      filterManageableAcceptances({ serverDB: db, userId: 'me' }, rows),
    ).resolves.toEqual([row('me', null), row('me', 'ws_member'), row('teammate', 'ws_owned')]);
  });

  it('looks membership up once per distinct workspace, not once per row', async () => {
    getMember.mockResolvedValue({ role: 'owner' });

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
    expect(getMember).toHaveBeenCalledTimes(2);
  });

  it('returns nothing for an anonymous caller', async () => {
    await expect(filterManageableAcceptances({ serverDB: db }, [row('me', null)])).resolves.toEqual(
      [],
    );
    expect(getMember).not.toHaveBeenCalled();
  });
});
