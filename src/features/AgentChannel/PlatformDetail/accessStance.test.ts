import { describe, expect, it } from 'vitest';

import {
  accessIssues,
  applyDmStance,
  countListed,
  deriveDmStance,
  dropHiddenIncompleteRows,
} from './accessStance';

const listed = [{ id: '1' }, { id: ' ' }, { id: '2', name: 'Ada' }];

describe('countListed', () => {
  it('counts only rows that carry an ID', () => {
    expect(countListed(listed)).toBe(2);
    expect(countListed(undefined)).toBe(0);
    expect(countListed('1,2')).toBe(0);
  });
});

describe('deriveDmStance', () => {
  it.each([
    [{ dmPolicy: 'pairing' }, 'approval'],
    [{ dmPolicy: 'disabled' }, 'closed'],
    [{ dmPolicy: 'allowlist' }, 'listed'],
    [{ dmPolicy: 'open', allowFrom: [] }, 'everyone'],
    [{}, 'everyone'],
  ])('reads %j as %s', (settings, stance) => {
    expect(deriveDmStance(settings)).toBe(stance);
  });

  it('reads an open policy with a filled list as listed people only, because the list gates everyone', () => {
    expect(deriveDmStance({ allowFrom: listed, dmPolicy: 'open' })).toBe('listed');
  });

  it('keeps pairing and closed even when a list exists', () => {
    expect(deriveDmStance({ allowFrom: listed, dmPolicy: 'pairing' })).toBe('approval');
    expect(deriveDmStance({ allowFrom: listed, dmPolicy: 'disabled' })).toBe('closed');
  });
});

describe('applyDmStance', () => {
  it('sets only the policy for approval, listed and closed, and keeps the list', () => {
    expect(applyDmStance('approval', { allowFrom: listed })).toEqual({
      dropped: 0,
      patch: { dmPolicy: 'pairing' },
    });
    expect(applyDmStance('listed', {}).patch).toEqual({ dmPolicy: 'allowlist' });
    expect(applyDmStance('closed', {}).patch).toEqual({ dmPolicy: 'disabled' });
  });

  it('clears the list for everyone and says how many people that drops', () => {
    expect(applyDmStance('everyone', { allowFrom: listed })).toEqual({
      dropped: 2,
      patch: { allowFrom: [], dmPolicy: 'open' },
    });
    expect(applyDmStance('everyone', {}).dropped).toBe(0);
  });

  it('round-trips: the stance applied is the stance read back', () => {
    for (const stance of ['approval', 'closed', 'everyone', 'listed'] as const) {
      const { patch } = applyDmStance(stance, { allowFrom: listed });
      const next = { allowFrom: patch.allowFrom ?? listed, dmPolicy: patch.dmPolicy };
      expect(deriveDmStance(next)).toBe(stance);
    }
  });
});

describe('accessIssues', () => {
  it('flags pairing without an owner ID, which the server refuses to save', () => {
    expect(accessIssues({ dmPolicy: 'pairing' })).toEqual(['approverMissing']);
    expect(accessIssues({ dmPolicy: 'pairing', userId: ' 88 ' })).toEqual([]);
  });

  it('flags empty lists that fail closed', () => {
    expect(accessIssues({ dmPolicy: 'allowlist', userId: '1' })).toEqual(['listEmpty']);
    expect(accessIssues({ groupAllowFrom: [], groupPolicy: 'allowlist' })).toEqual([
      'groupListEmpty',
    ]);
  });

  it('is quiet for the default setup', () => {
    expect(accessIssues({ dmPolicy: 'open', groupPolicy: 'open' })).toEqual([]);
  });
});

describe('dropHiddenIncompleteRows', () => {
  it('drops a half-added device row once devices are back to the owner only', () => {
    expect(
      dropHiddenIncompleteRows({
        deviceAllowFrom: [{ id: '7' }, { id: '' }],
        devicePolicy: 'owner',
      }),
    ).toEqual({ deviceAllowFrom: [{ id: '7' }] });
  });

  it('keeps an incomplete device row while the device list is shown', () => {
    expect(
      dropHiddenIncompleteRows({ deviceAllowFrom: [{ id: '' }], devicePolicy: 'allowlist' }),
    ).toEqual({});
  });

  it('drops a half-added group row once groups are no longer limited to a list', () => {
    expect(
      dropHiddenIncompleteRows({
        groupAllowFrom: [{ id: '42' }, { id: '' }],
        groupPolicy: 'open',
      }),
    ).toEqual({ groupAllowFrom: [{ id: '42' }] });
  });

  it('keeps an incomplete group row while the group list is still shown', () => {
    expect(
      dropHiddenIncompleteRows({ groupAllowFrom: [{ id: '' }], groupPolicy: 'allowlist' }),
    ).toEqual({});
  });

  it('drops a half-added person row when the people list is hidden', () => {
    expect(dropHiddenIncompleteRows({ allowFrom: [{ id: '  ' }], dmPolicy: 'disabled' })).toEqual({
      allowFrom: [],
    });
  });

  it('leaves the people list alone while it is shown', () => {
    expect(dropHiddenIncompleteRows({ allowFrom: [{ id: '' }], dmPolicy: 'pairing' })).toEqual({});
    expect(
      dropHiddenIncompleteRows({ allowFrom: [{ id: '7' }, { id: '' }], dmPolicy: 'disabled' }),
    ).toEqual({});
  });
});
