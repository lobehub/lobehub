import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserModel } from '@/database/models/user';

import {
  buildConnectorOwnershipPrompt,
  collectBorrowedConnectors,
  resolveConnectorAuthorizerId,
  resolveUserDisplayMap,
} from '../connectorAttribution';

vi.mock('@/database/models/user', () => ({
  UserModel: { getDisplayInfoByIds: vi.fn() },
}));

const getDisplayInfoByIds = vi.mocked(UserModel.getDisplayInfoByIds);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveConnectorAuthorizerId', () => {
  it('prefers the Composio linker over the row creator', () => {
    const id = resolveConnectorAuthorizerId({
      metadata: { composio: { linkedByUserId: 'owner' } },
      userId: 'creator',
    });
    expect(id).toBe('owner');
  });

  it('falls back to the row creator when no linker is recorded', () => {
    expect(resolveConnectorAuthorizerId({ metadata: { composio: {} }, userId: 'creator' })).toBe(
      'creator',
    );
    expect(resolveConnectorAuthorizerId({ metadata: null, userId: 'creator' })).toBe('creator');
  });

  it('returns null when nothing is known', () => {
    expect(resolveConnectorAuthorizerId({ metadata: null, userId: null })).toBeNull();
    expect(resolveConnectorAuthorizerId({})).toBeNull();
  });
});

describe('collectBorrowedConnectors', () => {
  it('keeps only connectors authorized by someone other than the caller', () => {
    const borrowed = collectBorrowedConnectors(
      [
        { identifier: 'gmail', name: 'Gmail', userId: 'owner' },
        { identifier: 'mine', name: 'My Tool', userId: 'caller' },
      ],
      'caller',
    );
    expect(borrowed).toEqual([{ authorizerId: 'owner', identifier: 'gmail', name: 'Gmail' }]);
  });

  it('honors the Composio linker as the authorizer', () => {
    const borrowed = collectBorrowedConnectors(
      [
        {
          identifier: 'gmail',
          metadata: { composio: { linkedByUserId: 'owner' } },
          name: 'Gmail',
          userId: 'caller', // caller created the row, but owner linked the account
        },
      ],
      'caller',
    );
    expect(borrowed).toEqual([{ authorizerId: 'owner', identifier: 'gmail', name: 'Gmail' }]);
  });

  it('dedupes by identifier and falls back to identifier for the name', () => {
    const borrowed = collectBorrowedConnectors(
      [
        { identifier: 'gmail', userId: 'owner' },
        { identifier: 'gmail', name: 'Gmail', userId: 'owner' },
      ],
      'caller',
    );
    expect(borrowed).toEqual([{ authorizerId: 'owner', identifier: 'gmail', name: 'gmail' }]);
  });

  it('returns empty when the caller authorized everything (owner runs own agent)', () => {
    const borrowed = collectBorrowedConnectors(
      [{ identifier: 'gmail', name: 'Gmail', userId: 'caller' }],
      'caller',
    );
    expect(borrowed).toEqual([]);
  });
});

describe('buildConnectorOwnershipPrompt', () => {
  it('returns undefined when nothing is borrowed', () => {
    expect(buildConnectorOwnershipPrompt([], new Map())).toBeUndefined();
  });

  it('lists each borrowed tool with its authorizing member name', () => {
    const prompt = buildConnectorOwnershipPrompt(
      [{ authorizerId: 'owner', identifier: 'gmail', name: 'Gmail' }],
      new Map([['owner', { avatar: null, name: '张三' }]]),
    );
    expect(prompt).toContain('<tool_credential_ownership>');
    expect(prompt).toContain('- Gmail: authorized by 张三');
    expect(prompt).toContain('</tool_credential_ownership>');
  });

  it('falls back when the authorizer name cannot be resolved', () => {
    const prompt = buildConnectorOwnershipPrompt(
      [{ authorizerId: 'ghost', identifier: 'gmail', name: 'Gmail' }],
      new Map(),
    );
    expect(prompt).toContain('- Gmail: authorized by another member');
  });
});

describe('resolveUserDisplayMap', () => {
  it('returns an empty map without querying when there are no ids', async () => {
    const map = await resolveUserDisplayMap({} as any, [null, undefined]);
    expect(map.size).toBe(0);
    expect(getDisplayInfoByIds).not.toHaveBeenCalled();
  });

  it('dedupes ids and maps rows to display info (full name preferred)', async () => {
    getDisplayInfoByIds.mockResolvedValue([
      { avatar: 'a.png', fullName: 'Zhang San', id: 'owner', username: 'zs' },
      { avatar: null, fullName: null, id: 'member', username: 'lijian' },
    ]);
    const db = {} as any;
    const map = await resolveUserDisplayMap(db, ['owner', 'owner', 'member']);
    expect(getDisplayInfoByIds).toHaveBeenCalledWith(db, ['owner', 'member']);
    expect(map.get('owner')).toEqual({ avatar: 'a.png', name: 'Zhang San' });
    // Falls back to username when full name is absent.
    expect(map.get('member')).toEqual({ avatar: null, name: 'lijian' });
  });
});
