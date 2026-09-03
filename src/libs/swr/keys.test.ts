import { unstable_serialize } from 'swr';
import { describe, expect, it } from 'vitest';

import {
  agentBuilderKeys,
  documentCommentKeys,
  isAcceptanceListKey,
  isDocumentCommentKeyForEvent,
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

describe('isAcceptanceListKey', () => {
  it('matches every Acceptance list variant without matching detail keys', () => {
    expect(isAcceptanceListKey(['verify:acceptances', '', '', 'active'])).toBe(true);
    expect(isAcceptanceListKey(['verify:acceptances', '100', 'needle', 'all', 'workspace-1'])).toBe(
      true,
    );
    expect(isAcceptanceListKey(['verify:acceptanceBundle', 'acceptance-1'])).toBe(false);
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

describe('isDocumentCommentKeyForEvent', () => {
  const event = {
    documentId: 'document-1',
    rootCommentId: 'root-1',
    workspaceId: 'workspace-1',
  };

  it('matches the affected summary, thread pages, and reply thread', () => {
    expect(isDocumentCommentKeyForEvent(documentCommentKeys.summary('document-1'), event)).toBe(
      true,
    );
    expect(
      isDocumentCommentKeyForEvent(
        documentCommentKeys.threads('workspace-1', 'document-1', 'cursor'),
        event,
      ),
    ).toBe(true);
    expect(
      isDocumentCommentKeyForEvent(
        documentCommentKeys.replies('workspace-1', 'root-1', 'cursor'),
        event,
      ),
    ).toBe(true);
    // Pinned deep-link details revalidate on any comment event in the workspace.
    expect(
      isDocumentCommentKeyForEvent(documentCommentKeys.detail('workspace-1', 'reply-9'), event),
    ).toBe(true);
  });

  it('does not invalidate other documents, workspaces, or reply threads', () => {
    expect(
      isDocumentCommentKeyForEvent(documentCommentKeys.detail('workspace-2', 'root-1'), event),
    ).toBe(false);
    expect(
      isDocumentCommentKeyForEvent(documentCommentKeys.threads('workspace-2', 'document-1'), event),
    ).toBe(false);
    expect(isDocumentCommentKeyForEvent(documentCommentKeys.summary('document-2'), event)).toBe(
      false,
    );
    expect(
      isDocumentCommentKeyForEvent(documentCommentKeys.replies('workspace-1', 'root-2'), event),
    ).toBe(false);
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
