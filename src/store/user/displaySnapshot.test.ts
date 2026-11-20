import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearUserDisplaySnapshot,
  readUserDisplaySnapshot,
  writeUserDisplaySnapshot,
} from './displaySnapshot';

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

  it('clears only the requested user snapshot', () => {
    writeUserDisplaySnapshot('user-a', { avatar: 'avatar-a' });
    writeUserDisplaySnapshot('user-b', { avatar: 'avatar-b' });

    clearUserDisplaySnapshot('user-a');

    expect(readUserDisplaySnapshot('user-a')).toBeUndefined();
    expect(readUserDisplaySnapshot('user-b')).toEqual({ avatar: 'avatar-b' });
  });

  it('keeps the profile and allowlisted settings, never secrets or entitlement', () => {
    writeUserDisplaySnapshot('user-a', {
      email: 'a@example.com',
      fullName: 'Ada',
      interests: ['ai', 3 as any],
      isFreePlan: true,
      onboarding: { finishedAt: 'x' },
      settings: {
        general: { fontSize: 15 },
        keyVaults: { openai: { apiKey: 'sk-secret' } },
        languageModel: { openai: { enabled: true } },
        market: { accessToken: 'market-token' },
        unknownSection: { token: 'x' },
      },
      subscriptionPlan: 'pro',
      username: 'ada',
    } as any);

    expect(readUserDisplaySnapshot('user-a')).toEqual({
      email: 'a@example.com',
      fullName: 'Ada',
      interests: ['ai'],
      settings: {
        general: { fontSize: 15 },
        languageModel: { openai: { enabled: true } },
      },
      username: 'ada',
    });
    const raw = JSON.stringify({ ...localStorage });
    expect(raw).not.toContain('sk-secret');
    expect(raw).not.toContain('market-token');
    expect(raw).not.toContain('subscriptionPlan');
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
