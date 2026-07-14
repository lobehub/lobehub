import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { assertWorkspaceRowManageable } from './assertWorkspaceRowManageable';

describe('assertWorkspaceRowManageable', () => {
  it('passes through in personal mode regardless of row creator', () => {
    expect(() =>
      assertWorkspaceRowManageable({ userId: 'me' }, 'someone-else', 'connector'),
    ).not.toThrow();
  });

  it('allows a workspace owner to mutate any row', () => {
    expect(() =>
      assertWorkspaceRowManageable(
        { userId: 'me', workspaceId: 'ws1', workspaceRole: 'owner' },
        'someone-else',
        'connector',
      ),
    ).not.toThrow();
  });

  it('allows a member to mutate their own row', () => {
    expect(() =>
      assertWorkspaceRowManageable(
        { userId: 'me', workspaceId: 'ws1', workspaceRole: 'member' },
        'me',
        'skill',
      ),
    ).not.toThrow();
  });

  it('rejects a member mutating another creator’s row with FORBIDDEN', () => {
    try {
      assertWorkspaceRowManageable(
        { userId: 'me', workspaceId: 'ws1', workspaceRole: 'member' },
        'someone-else',
        'skill',
      );
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe('FORBIDDEN');
    }
  });

  it('rejects when the row has no creator recorded', () => {
    expect(() =>
      assertWorkspaceRowManageable(
        { userId: 'me', workspaceId: 'ws1', workspaceRole: 'member' },
        null,
        'connector',
      ),
    ).toThrow(TRPCError);
  });
});
