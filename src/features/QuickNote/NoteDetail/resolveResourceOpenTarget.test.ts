import type { QuickNoteResourceType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { QuickNoteResource } from '@/services/quickNote';

import { resolveQuickNoteResourceOpenTarget } from './resolveResourceOpenTarget';

const createResource = (
  resourceType: QuickNoteResourceType,
  overrides: Partial<QuickNoteResource> = {},
): QuickNoteResource => ({
  createdAt: 1,
  id: `link-${resourceType}`,
  label: `${resourceType} title`,
  resourceId: `${resourceType}-1`,
  resourceType,
  role: 'context',
  ...overrides,
});

/** @example Quick Note links select a native open surface without UI-specific branching. */
describe('resolveQuickNoteResourceOpenTarget', () => {
  /** @example Documents and Pages share the existing document preview surface. */
  it('resolves document-like resources', () => {
    /** @example A Document keeps its stable identifier for the preview modal. */
    expect(resolveQuickNoteResourceOpenTarget(createResource('document'))).toEqual({
      documentId: 'document-1',
      kind: 'document',
    });
    /** @example A Page uses the same native Document-backed preview contract. */
    expect(resolveQuickNoteResourceOpenTarget(createResource('page'))).toEqual({
      documentId: 'page-1',
      kind: 'document',
    });
  });

  /** @example Topic-like resources require their owning Agent to hydrate chat. */
  it('resolves complete topic resources and rejects incomplete ones', () => {
    /** @example The Topic drawer receives both its Topic and Agent identities. */
    expect(
      resolveQuickNoteResourceOpenTarget(createResource('topic', { agentId: 'agent-1' })),
    ).toEqual({ agentId: 'agent-1', kind: 'topic', topicId: 'topic-1' });
    /** @example A missing Agent produces no misleading open target. */
    expect(resolveQuickNoteResourceOpenTarget(createResource('topic'))).toBeUndefined();
  });

  /** @example Tasks navigate to the standalone task detail route. */
  it('resolves task resources', () => {
    /** @example The stable Task id is retained for route construction. */
    expect(resolveQuickNoteResourceOpenTarget(createResource('task'))).toEqual({
      kind: 'task',
      taskId: 'task-1',
    });
  });

  /** @example Unsupported selectors remain visible but non-interactive until their providers land. */
  it('keeps unsupported resource families non-interactive', () => {
    /** @example A Message has no native open target without Topic and selection metadata. */
    expect(resolveQuickNoteResourceOpenTarget(createResource('message'))).toBeUndefined();
  });
});
