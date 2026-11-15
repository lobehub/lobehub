import { describe, expect, it } from 'vitest';

import { documentCommentKeys, isDocumentCommentKeyForEvent, workKeys } from './keys';

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
