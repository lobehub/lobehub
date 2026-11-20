import { describe, expect, it } from 'vitest';

import { hasPendingChanges, pickKeys, replyDiffers } from './replySettings';

const KEYS = ['displayToolCalls', 'showUsageStats', 'watchKeywords'];

describe('pickKeys', () => {
  it('takes only the keys asked for that have a value', () => {
    expect(
      pickKeys({ charLimit: 1, displayToolCalls: true, showUsageStats: undefined }, KEYS),
    ).toEqual({
      displayToolCalls: true,
    });
    expect(pickKeys(undefined, KEYS)).toEqual({});
  });
});

describe('replyDiffers', () => {
  it('is false when the form matches what is stored', () => {
    expect(
      replyDiffers({ displayToolCalls: true, watchKeywords: [] }, { displayToolCalls: true }, KEYS),
    ).toBe(false);
  });

  it('is true when a toggle differs', () => {
    expect(replyDiffers({ displayToolCalls: true }, { displayToolCalls: false }, KEYS)).toBe(true);
  });

  it('ignores a row field the form leaves empty', () => {
    const stored = { watchKeywords: [{ keyword: 'bug' }] };
    expect(
      replyDiffers({ watchKeywords: [{ instruction: '', keyword: 'bug' }] }, stored, KEYS),
    ).toBe(false);
    expect(
      replyDiffers({ watchKeywords: [{ keyword: 'bug' }, { keyword: 'x' }] }, stored, KEYS),
    ).toBe(true);
  });

  it('ignores keys that are not reply keys', () => {
    expect(replyDiffers({ charLimit: 1 }, { charLimit: 2 }, KEYS)).toBe(false);
  });
});

describe('hasPendingChanges', () => {
  const stored = {
    applicationId: '1',
    credentials: { botToken: '••••' },
    settings: { charLimit: 2000, displayToolCalls: false },
  };

  it('is false for an untouched form', () => {
    expect(hasPendingChanges(stored, stored, KEYS)).toBe(false);
  });

  it('does not count changes to the keys that save themselves', () => {
    const values = { ...stored, settings: { ...stored.settings, displayToolCalls: true } };
    expect(hasPendingChanges(values, stored, KEYS)).toBe(false);
  });

  it('counts a change to anything else, including a credential', () => {
    expect(
      hasPendingChanges(
        { ...stored, settings: { ...stored.settings, charLimit: 500 } },
        stored,
        KEYS,
      ),
    ).toBe(true);
    expect(hasPendingChanges({ ...stored, credentials: { botToken: 'new' } }, stored, KEYS)).toBe(
      true,
    );
  });

  it('goes back to clean when a change is undone', () => {
    const edited = { ...stored, settings: { ...stored.settings, charLimit: 500 } };
    expect(hasPendingChanges(edited, stored, KEYS)).toBe(true);
    expect(hasPendingChanges({ ...edited, settings: stored.settings }, stored, KEYS)).toBe(false);
  });
});
