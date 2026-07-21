import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import {
  assertWorkspaceRowManageable,
  isWorkspaceNonOwner,
  shouldRestrictBulkDeleteToCreator,
} from './assertWorkspaceRowManageable';

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

describe('isWorkspaceNonOwner', () => {
  it('restricts workspace members but not owners or personal callers', () => {
    expect(isWorkspaceNonOwner({ workspaceId: 'ws1', workspaceRole: 'member' })).toBe(true);
    expect(isWorkspaceNonOwner({ workspaceId: 'ws1', workspaceRole: 'owner' })).toBe(false);
    expect(isWorkspaceNonOwner({ workspaceId: null, workspaceRole: 'member' })).toBe(false);
  });
});

describe('shouldRestrictBulkDeleteToCreator', () => {
  it('keeps own scope caller-scoped for members, owners, and personal callers', () => {
    expect(
      shouldRestrictBulkDeleteToCreator({ workspaceId: 'ws1', workspaceRole: 'member' }, 'own'),
    ).toBe(true);
    expect(
      shouldRestrictBulkDeleteToCreator({ workspaceId: 'ws1', workspaceRole: 'owner' }, 'own'),
    ).toBe(true);
    expect(shouldRestrictBulkDeleteToCreator({ workspaceId: null }, 'own')).toBe(true);
  });

  it('allows workspace scope only for workspace owners', () => {
    expect(
      shouldRestrictBulkDeleteToCreator(
        { workspaceId: 'ws1', workspaceRole: 'owner' },
        'workspace',
      ),
    ).toBe(false);
    expect(() =>
      shouldRestrictBulkDeleteToCreator(
        { workspaceId: 'ws1', workspaceRole: 'member' },
        'workspace',
      ),
    ).toThrow(TRPCError);
    expect(() => shouldRestrictBulkDeleteToCreator({ workspaceId: null }, 'workspace')).toThrow(
      TRPCError,
    );
  });
});
