import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readUserDisplaySnapshot, writeUserDisplaySnapshot } from './displaySnapshot';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('user display snapshot', () => {
  it('keeps the avatar and preference isolated by exact user id', () => {
    writeUserDisplaySnapshot('user-a', {
      avatar: '',
      preference: { lab: { enableProjects: true } },
    });

    expect(readUserDisplaySnapshot('user-a')).toEqual({
      avatar: '',
      preference: { lab: { enableProjects: true } },
    });
    expect(readUserDisplaySnapshot('user-b')).toBeUndefined();
  });

  it('merges partial writes without dropping the other display field', () => {
    writeUserDisplaySnapshot('user-a', {
      avatar: 'avatar-a',
    });
    writeUserDisplaySnapshot('user-a', {
      preference: { lab: { enableProjects: true } },
    });

    expect(readUserDisplaySnapshot('user-a')).toEqual({
      avatar: 'avatar-a',
      preference: { lab: { enableProjects: true } },
    });
  });

  it('ignores malformed persisted data', () => {
    vi.spyOn(localStorage, 'getItem').mockReturnValue('{malformed');

    expect(readUserDisplaySnapshot('user-a')).toBeUndefined();
  });

  it('does not throw when localStorage is unavailable', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    expect(() =>
      writeUserDisplaySnapshot('user-a', {
        avatar: 'avatar-a',
      }),
    ).not.toThrow();
  });
});
