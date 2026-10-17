/**
 * Guards the migration's cross-layer wiring: a notebook document write must
 * revalidate the topic's documents, which now live in a replica (`replica:sync`
 * keys) instead of the `notebook:documents` SWR entry.
 */
import { describe, expect, it, vi } from 'vitest';

import { invalidateDocumentMutation } from '@/services/document/invalidation';

vi.mock('@/libs/swr', () => ({ mutate: vi.fn() }));

const functionKeys = async () => {
  const { mutate } = await import('@/libs/swr');
  return vi
    .mocked(mutate)
    .mock.calls.map(([key]) => key)
    .filter((key): key is (queryKey: unknown) => boolean => typeof key === 'function');
};

describe('notebook documents invalidation wiring', () => {
  it('revalidates the notebook documents replica for the mutated topic only', async () => {
    const { cacheScope } = await import('@/libs/replica');
    const scope = cacheScope.get();

    await invalidateDocumentMutation({
      cause: 'notebook',
      documentId: 'doc-1',
      topicId: 'topic-1',
    });

    const matchers = await functionKeys();
    const matches = (key: unknown) => matchers.some((matcher) => matcher(key));

    expect(matches(['replica:sync', 'notebookDocuments', 1, scope, 'topic-1', 'topic-1'])).toBe(
      true,
    );
    expect(matches(['replica:sync', 'notebookDocuments', 1, scope, 'topic-2', 'topic-2'])).toBe(
      false,
    );
  });

  it('does not touch the notebook documents when no topic is involved', async () => {
    await invalidateDocumentMutation({ documentId: 'page-doc-1' });

    const matchers = await functionKeys();
    const { cacheScope } = await import('@/libs/replica');
    const scope = cacheScope.get();

    expect(
      matchers.some((matcher) =>
        matcher(['replica:sync', 'notebookDocuments', 1, scope, 'topic-1', 'topic-1']),
      ),
    ).toBe(false);
  });
});
