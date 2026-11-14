import { describe, expect, it } from 'vitest';

import { contactInfoRows } from './contactInfoRows';

describe('contactInfoRows', () => {
  it('lists the handle, every live mailbox and the bio, in that order', () => {
    expect(
      contactInfoRows({
        accounts: [
          { id: 'a1', identifier: 'old@lobe.id', kind: 'mail', status: 'revoked' },
          { id: 'a2', identifier: '0xabc', kind: 'wallet', status: 'active' },
          { id: 'a3', identifier: 'pm@lobe.id', kind: 'mail', status: 'active' },
          { id: 'a4', identifier: 'new@lobe.id', kind: 'mail', status: 'provisioning' },
        ],
        description: 'Ships the lobe.id release\n',
        slug: 'lobe-id',
      }),
    ).toEqual([
      { key: 'handle', kind: 'handle', value: '@lobe-id' },
      { key: 'a3', kind: 'mail', value: 'pm@lobe.id' },
      { key: 'a4', kind: 'mail', value: 'new@lobe.id' },
      { key: 'bio', kind: 'bio', value: 'Ships the lobe.id release' },
    ]);
  });

  it('leaves out what the contact has nothing for', () => {
    // A group, or another member's agent: no handle shown and no accounts listed.
    expect(contactInfoRows({ accounts: [], description: '  ', slug: null })).toEqual([]);
    expect(contactInfoRows({})).toEqual([]);
  });
});
