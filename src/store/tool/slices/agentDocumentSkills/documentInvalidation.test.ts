/**
 * Guards the migration's cross-layer wiring: an agent-document write must
 * revalidate the slash-menu skill registry, which now lives in a replica
 * (`replica:sync` keys) instead of the `agent:documentsList` SWR entry.
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

describe('agentDocumentSkills invalidation wiring', () => {
  it('revalidates the skill registry replica for the mutated agent only', async () => {
    const { cacheScope } = await import('@/libs/replica');
    const scope = cacheScope.get();

    await invalidateDocumentMutation({ agentId: 'agent-1' });

    const matchers = await functionKeys();
    const matches = (key: unknown) => matchers.some((matcher) => matcher(key));

    expect(matches(['replica:sync', 'agentDocumentSkills', 1, scope, 'agent-1', 'agent-1'])).toBe(
      true,
    );
    expect(matches(['replica:sync', 'agentDocumentSkills', 1, scope, 'agent-2', 'agent-2'])).toBe(
      false,
    );
  });

  it('does not touch the skill registry when no agent is involved', async () => {
    await invalidateDocumentMutation({ documentId: 'page-doc-1' });

    const matchers = await functionKeys();
    const { cacheScope } = await import('@/libs/replica');
    const scope = cacheScope.get();

    expect(
      matchers.some((matcher) =>
        matcher(['replica:sync', 'agentDocumentSkills', 1, scope, 'agent-1', 'agent-1']),
      ),
    ).toBe(false);
  });
});
