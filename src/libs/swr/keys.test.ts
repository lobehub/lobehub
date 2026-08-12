import { unstable_serialize } from 'swr';
import { describe, expect, it } from 'vitest';

import { agentBuilderKeys, recentKeys, taskKeys } from './keys';
import { CACHE_TIERS } from './localStorageProvider';

describe('recentKeys', () => {
  it('keys the Home recent list by identity cache scope', () => {
    expect(recentKeys.list(true, 10, 'user-1:workspace-1')).toEqual([
      'recent:list',
      true,
      10,
      'user-1:workspace-1',
    ]);
  });

  it('keeps users isolated in the same workspace', () => {
    expect(recentKeys.list(true, 10, 'user-1:workspace-1')).not.toEqual(
      recentKeys.list(true, 10, 'user-2:workspace-1'),
    );
  });

  it('keeps workspaces isolated for the same user', () => {
    expect(recentKeys.allDrawer(true, 'user-1:workspace-1')).not.toEqual(
      recentKeys.allDrawer(true, 'user-1:workspace-2'),
    );
  });

  it('keys the Home topic-only list independently from mixed recents', () => {
    expect(recentKeys.topicList(9, 'user-1:workspace-1', 'mine')).toEqual([
      'recent:topicList',
      9,
      'user-1:workspace-1',
      'mine',
    ]);
  });

  it('keeps the mine and team views of the Home topic list isolated', () => {
    expect(recentKeys.topicList(9, 'user-1:workspace-1', 'mine')).not.toEqual(
      recentKeys.topicList(9, 'user-1:workspace-1', 'team'),
    );
  });

  // Regression: `recent:topicList` had no CACHE_TIERS entry of its own, and the
  // provider matches patterns as substrings — so `recent:list` never covered it.
  // The Home recents list was memory-only and flashed a skeleton on every boot.
  it('routes the Home topic-only recents key to a persisted cache tier', () => {
    const serialized = unstable_serialize(recentKeys.topicList(9, 'user-1:workspace-1', 'mine'));
    const persisted = [...CACHE_TIERS.idb, ...CACHE_TIERS.local].some((pattern) =>
      serialized.includes(pattern),
    );

    expect(persisted).toBe(true);
  });
});

describe('agentBuilderKeys', () => {
  // Regression: builder suggestion chips were memory-only (no CACHE_TIERS entry),
  // so every page load showed a skeleton and paid a fresh LLM generation. The key
  // must route to a persisted tier so revisits hydrate the last batch instead.
  it('routes the builder suggestions key to a persisted cache tier', () => {
    const serialized = unstable_serialize(
      agentBuilderKeys.suggestions('agentBuilder', 'builder-1', 'target-1', 'zh-CN'),
    );
    const persisted = [...CACHE_TIERS.idb, ...CACHE_TIERS.local].some((pattern) =>
      serialized.includes(pattern),
    );
    expect(persisted).toBe(true);
  });
});

describe('taskKeys', () => {
  // Regression for sidebar task list cache persists across navigation to skip skeleton: the sidebar task list used a `sidebar:` domain
  // key that no CACHE_TIERS pattern matched, so it was memory-only and every
  // fresh page load showed a skeleton. The key must route to a persisted tier
  // (the provider matches patterns against the serialized SWR key).
  it('routes the sidebar task-groups key to a persisted cache tier', () => {
    const serialized = unstable_serialize(taskKeys.sidebarGroups('agent-1'));
    const persisted = [...CACHE_TIERS.idb, ...CACHE_TIERS.local].some((pattern) =>
      serialized.includes(pattern),
    );
    expect(persisted).toBe(true);
  });
});
