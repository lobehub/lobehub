import { replicaKeys } from 'local-replica';
import { unstable_serialize } from 'swr';
import { describe, expect, it } from 'vitest';

import { documentCommentKeys, isDocumentCommentKeyForEvent, recentKeys, workKeys } from './keys';
import { CACHE_TIERS } from './localStorageProvider';

describe('recentKeys', () => {
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

describe('replica sync keys', () => {
  it('keeps SWR orchestration entries out of the persistence tiers', () => {
    for (const key of [
      // Replicas persist through their own storage, never through the SWR tiers.
      replicaKeys.sync('agentList', 1, 'user-1:personal', 'sidebar', {}),
      replicaKeys.sync('agentConfig', 1, 'user-1:personal', 'agent-1', { agentId: 'agent-1' }),
    ]) {
      const serialized = unstable_serialize(key);
      expect(
        [...CACHE_TIERS.idb, ...CACHE_TIERS.local].some((pattern) => serialized.includes(pattern)),
      ).toBe(false);
    }
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
