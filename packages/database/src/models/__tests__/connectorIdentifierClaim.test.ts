import { describe, expect, it } from 'vitest';

import { baseIdentifierLockKey } from '../connectorIdentifierClaim';

describe('baseIdentifierLockKey', () => {
  it('gives every spelling of one workspace the same lock', () => {
    const key = baseIdentifierLockKey({ userId: 'u1', workspaceId: 'ws-1' }, 'notion');

    expect(baseIdentifierLockKey({ userId: 'u1', workspaceId: ' ws-1 ' }, 'notion')).toBe(key);
    expect(baseIdentifierLockKey({ userId: 'u2', workspaceId: 'ws-1\n' }, 'notion')).toBe(key);
  });

  it('locks a blank workspace id as the personal scope it writes to', () => {
    const personal = baseIdentifierLockKey({ userId: 'u1' }, 'notion');

    expect(baseIdentifierLockKey({ userId: 'u1', workspaceId: '' }, 'notion')).toBe(personal);
    expect(baseIdentifierLockKey({ userId: 'u1', workspaceId: '   ' }, 'notion')).toBe(personal);
    expect(baseIdentifierLockKey({ userId: 'u2' }, 'notion')).not.toBe(personal);
  });

  it('keeps identifiers and scopes apart', () => {
    const key = baseIdentifierLockKey({ userId: 'u1', workspaceId: 'ws-1' }, 'notion');

    expect(baseIdentifierLockKey({ userId: 'u1', workspaceId: 'ws-1' }, 'linear')).not.toBe(key);
    expect(baseIdentifierLockKey({ userId: 'u1', workspaceId: 'ws-2' }, 'notion')).not.toBe(key);
    expect(baseIdentifierLockKey({ userId: 'u1' }, 'notion')).not.toBe(key);
  });
});
