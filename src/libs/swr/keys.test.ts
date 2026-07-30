import { unstable_serialize } from 'swr';
import { describe, expect, it } from 'vitest';

import { recentKeys, taskKeys } from './keys';
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
    expect(recentKeys.topicList(9, 'user-1:workspace-1')).toEqual([
      'recent:topicList',
      9,
      'user-1:workspace-1',
    ]);
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
