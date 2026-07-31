import { unstable_serialize } from 'swr';
import { describe, expect, it } from 'vitest';

import {
  agentBuilderKeys,
  agentKeys,
  entityDataKeys,
  homeKeys,
  recentKeys,
  resourceKeys,
  taskKeys,
  workKeys,
} from './keys';
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
});

describe('workKeys', () => {
  it('keeps the Resources Private and Workspace galleries in separate cache entries', () => {
    expect(workKeys.workspace('workspace-1', 'all', null, 'private')).not.toEqual(
      workKeys.workspace('workspace-1', 'all', null, 'public'),
    );
  });

  it('keeps non-Resources callers on the unfiltered cache entry', () => {
    expect(workKeys.workspace('workspace-1', 'project:project-1')).toEqual([
      'work:workspace',
      'workspace-1',
      'project:project-1',
      null,
      null,
    ]);
  });
});

describe('resourceKeys', () => {
  it('keeps Private and Workspace recent sections in separate cache entries', () => {
    expect(resourceKeys.recentPages('workspace-1', 'private')).not.toEqual(
      resourceKeys.recentPages('workspace-1', 'public'),
    );
    expect(resourceKeys.recentFiles('workspace-1', 'private')).not.toEqual(
      resourceKeys.recentFiles('workspace-1', 'public'),
    );
  });

  // Regression: without the workspace in the key, switching workspaces served
  // the previous workspace's rows out of cache before revalidation landed.
  it('keeps every Resources cache entry scoped to its workspace', () => {
    expect(resourceKeys.recentFiles('workspace-1', 'public')).not.toEqual(
      resourceKeys.recentFiles('workspace-2', 'public'),
    );
    expect(resourceKeys.recentPages('workspace-1', 'public')).not.toEqual(
      resourceKeys.recentPages('workspace-2', 'public'),
    );
    expect(resourceKeys.recentFiles(null, undefined)).not.toEqual(
      resourceKeys.recentFiles('workspace-1', undefined),
    );
    expect(resourceKeys.search({ q: 'report' }, 'workspace-1')).not.toEqual(
      resourceKeys.search({ q: 'report' }, 'workspace-2'),
    );
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

describe('homeKeys', () => {
  it('isolates daily briefs by user without changing the original request identity', () => {
    expect(homeKeys.dailyBrief('user-1')).toEqual(['home:dailyBrief', 'user-1']);
    expect(homeKeys.dailyBrief('user-1')).not.toEqual(homeKeys.dailyBrief('user-2'));
  });
});

describe('entityDataKeys', () => {
  it('isolates normalized Home requests by entity scope', () => {
    expect(entityDataKeys.sidebar('user-1:workspace-1')).not.toEqual(
      entityDataKeys.sidebar('user-1:workspace-2'),
    );
  });

  it('keeps the mine and team views of the Home recent topics feed isolated', () => {
    expect(entityDataKeys.recentTopics('user-1:workspace-1', 9, 'mine')).not.toEqual(
      entityDataKeys.recentTopics('user-1:workspace-1', 9, 'team'),
    );
  });

  it('retires the legacy full sidebar response from SWR persistence', () => {
    const serialized = unstable_serialize(agentKeys.list(true));

    expect(
      [...CACHE_TIERS.idb, ...CACHE_TIERS.local].some((pattern) => serialized.includes(pattern)),
    ).toBe(false);
  });

  it('keeps request markers outside every SWR persistence tier', () => {
    const serializedKeys = [
      entityDataKeys.sidebar('scope-1'),
      entityDataKeys.recentTopics('scope-1', 9, 'mine'),
      entityDataKeys.inboxTopics('scope-1'),
      entityDataKeys.tasks('scope-1'),
      entityDataKeys.briefs('scope-1'),
    ].map(unstable_serialize);

    for (const serialized of serializedKeys) {
      expect(
        [...CACHE_TIERS.idb, ...CACHE_TIERS.local].some((pattern) => serialized.includes(pattern)),
      ).toBe(false);
    }
  });
});
