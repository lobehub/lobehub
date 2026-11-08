import { describe, expect, it } from 'vitest';

import { pickKeywords, resolveDmOutcome, resolveGroupOutcome, resolveScenes } from './previewModel';

const people = [{ id: '1' }];

describe('resolveGroupOutcome', () => {
  it('answers in any group by default', () => {
    expect(resolveGroupOutcome({})).toEqual({ kind: 'answer' });
    expect(resolveGroupOutcome({ groupPolicy: 'open' })).toEqual({ kind: 'answer' });
  });

  it('tells the sender when group replies are off, instead of staying silent', () => {
    expect(resolveGroupOutcome({ groupPolicy: 'disabled' })).toEqual({
      kind: 'notice',
      noticeKey: 'group.disabled',
    });
  });

  it('answers with a scope note when only listed groups are enabled', () => {
    expect(
      resolveGroupOutcome({ groupAllowFrom: [{ id: '1' }], groupPolicy: 'allowlist' }),
    ).toEqual({ kind: 'answer', scopeNote: 'groupAllowlist' });
  });

  it('fails closed with a notice on an empty group list', () => {
    expect(resolveGroupOutcome({ groupAllowFrom: [], groupPolicy: 'allowlist' })).toEqual({
      kind: 'notice',
      noticeKey: 'group.allowlist',
    });
    expect(resolveGroupOutcome({ groupPolicy: 'allowlist' }).kind).toBe('notice');
  });

  it('lets the global people list turn a stranger away first, whatever the group policy', () => {
    for (const groupPolicy of ['open', 'allowlist', 'disabled']) {
      expect(resolveGroupOutcome({ allowFrom: people, groupPolicy })).toEqual({
        kind: 'notice',
        noticeKey: 'sender.rejected',
      });
    }
  });

  it('applies the people list in groups even under pairing', () => {
    expect(resolveGroupOutcome({ allowFrom: people, dmPolicy: 'pairing' }).noticeKey).toBe(
      'sender.rejected',
    );
  });
});

describe('resolveDmOutcome', () => {
  it('answers anyone when DMs are open and the list is empty', () => {
    expect(resolveDmOutcome({ allowFrom: [], dmPolicy: 'open' })).toEqual({ kind: 'answer' });
    expect(resolveDmOutcome({})).toEqual({ kind: 'answer' });
  });

  it.each([
    ['allowlist', 'dm.allowlist'],
    ['disabled', 'dm.disabled'],
  ])('tells a stranger what %s means', (dmPolicy, noticeKey) => {
    expect(resolveDmOutcome({ dmPolicy })).toEqual({ kind: 'notice', noticeKey });
  });

  it('offers a pairing code even when the list is already filled', () => {
    expect(resolveDmOutcome({ allowFrom: people, dmPolicy: 'pairing' })).toEqual({
      kind: 'notice',
      noticeKey: 'dm.pairing',
    });
  });

  it('turns a stranger away when an open policy sits behind a filled list', () => {
    expect(resolveDmOutcome({ allowFrom: people, dmPolicy: 'open' })).toEqual({
      kind: 'notice',
      noticeKey: 'dm.allowlist',
    });
    expect(resolveDmOutcome({ allowFrom: people, dmPolicy: 'disabled' }).noticeKey).toBe(
      'dm.allowlist',
    );
  });
});

describe('resolveScenes', () => {
  it('adds the DM scene only when the platform has a DM policy', () => {
    expect(resolveScenes(['dmPolicy', 'groupPolicy'])).toEqual(['group', 'dm']);
    expect(resolveScenes(['displayToolCalls'])).toEqual(['group']);
  });
});

describe('pickKeywords', () => {
  it('keeps the first three non-empty keywords, trimmed', () => {
    expect(
      pickKeywords([
        { keyword: ' bug ' },
        { keyword: '' },
        { keyword: 'urgent' },
        { keyword: 'a' },
        { keyword: 'b' },
      ]),
    ).toEqual(['bug', 'urgent', 'a']);
  });

  it('ignores anything that is not a keyword list', () => {
    expect(pickKeywords(undefined)).toEqual([]);
    expect(pickKeywords('bug')).toEqual([]);
    expect(pickKeywords([null, 3])).toEqual([]);
  });
});
