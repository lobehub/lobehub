// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RuntimeConfigModule from '@/server/runtimeConfig';

/**
 * The `bot_wake` flag through the real flag service: the merge of schema defaults, the published
 * global snapshot, the environment and a per-user override, as a bot owner's rollout will see it.
 * Only the Redis-backed provider is replaced, by a fake that serves whatever the test published.
 */
const published = vi.hoisted(() => ({
  global: null as { data: Record<string, unknown> } | null,
  users: {} as Record<string, { data: Record<string, boolean> }>,
}));

vi.mock('@/server/runtimeConfig', async (importActual) => {
  const actual = await importActual<typeof RuntimeConfigModule>();

  class FakeRedisRuntimeConfigProvider {
    constructor(public domain: { key: string }) {}

    isEnabled = () => true;

    getSnapshot = async (selector?: { id?: string; scope: string }) => {
      const snapshot =
        this.domain.key === 'feature-flags-user-overrides'
          ? published.users[selector?.id ?? '']
          : published.global;

      return snapshot ? { ...snapshot, updatedAt: '2026-10-25T00:00:00Z', version: 1 } : null;
    };
  }

  return { ...actual, RedisRuntimeConfigProvider: FakeRedisRuntimeConfigProvider };
});

const botWakeFor = async (userId: string) => {
  const { getServerFeatureFlagsStateFromRuntimeConfig } = await import('./index');

  return (await getServerFeatureFlagsStateFromRuntimeConfig(userId)).enableBotWake;
};

describe('bot_wake rollout through the flag service', () => {
  beforeEach(() => {
    vi.resetModules();
    published.global = null;
    published.users = {};
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off for every bot owner when nothing is published', async () => {
    expect(await botWakeFor('owner-1')).toBe(false);
  });

  it('turns on for the owners on a published allowlist only', async () => {
    published.global = { data: { bot_wake: ['owner-1'] } };

    expect(await botWakeFor('owner-1')).toBe(true);
    expect(await botWakeFor('owner-2')).toBe(false);
  });

  it('turns on for everyone once published as true', async () => {
    published.global = { data: { bot_wake: true } };

    expect(await botWakeFor('owner-2')).toBe(true);
  });

  it('turns on for a single owner through a per-user override while it is off for the rest', async () => {
    published.users['owner-1'] = { data: { bot_wake: true } };

    expect(await botWakeFor('owner-1')).toBe(true);
    expect(await botWakeFor('owner-2')).toBe(false);
  });

  it('turns off for a single owner through a per-user override while it is on for the rest', async () => {
    published.global = { data: { bot_wake: true } };
    published.users['owner-1'] = { data: { bot_wake: false } };

    expect(await botWakeFor('owner-1')).toBe(false);
    expect(await botWakeFor('owner-2')).toBe(true);
  });

  it('turns on for everyone from the FEATURE_FLAGS environment variable', async () => {
    vi.stubEnv('FEATURE_FLAGS', '+bot_wake');

    expect(await botWakeFor('owner-1')).toBe(true);
  });
});
