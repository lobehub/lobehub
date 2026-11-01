/**
 * Guards the migration's cross-layer wiring: syncing todos into the plan
 * document's metadata must revalidate the topic's notebook documents, which now
 * live in a replica (`replica:sync` keys) instead of the `notebook:documents`
 * SWR entry.
 */
import { lobeAgentExecutor } from '@lobechat/builtin-tool-lobe-agent/client/executor';
import type { BuiltinToolContext } from '@lobechat/types';
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { row, updateDocument } = vi.hoisted(() => {
  const row = { current: { metadata: {} as Record<string, any> } };
  return {
    row,
    updateDocument: vi.fn(async ({ metadata }) => {
      row.current = { metadata };
    }),
  };
});

vi.mock('@/libs/swr', () => ({ mutate: vi.fn() }));
vi.mock('@/services/notebook', () => ({
  notebookService: {
    listDocuments: vi.fn(async () => ({
      data: [
        {
          createdAt: new Date(),
          id: 'plan-1',
          metadata: row.current.metadata,
          updatedAt: new Date(),
        },
      ],
    })),
    updateDocument,
  },
}));
vi.mock('@/store/notebook', () => ({ useNotebookStore: { getState: () => ({}) } }));

describe('lobeAgentExecutor plan todos sync', () => {
  it('revalidates the notebook documents replica after syncing todos into its metadata', async () => {
    const { mutate } = await import('@/libs/swr');
    const { cacheScope } = await import('@/libs/replica');

    const ctx = { currentTodos: [], topicId: 'topic-1' } as unknown as BuiltinToolContext;

    let result: Awaited<ReturnType<typeof lobeAgentExecutor.createTodos>>;
    await act(async () => {
      result = await lobeAgentExecutor.createTodos({ adds: ['ship it'] }, ctx);
    });

    expect(result!.success).toBe(true);
    expect(updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'plan-1',
        metadata: expect.objectContaining({ todos: expect.anything() }),
      }),
    );

    const matchers = vi
      .mocked(mutate)
      .mock.calls.map(([key]) => key)
      .filter((key): key is (queryKey: unknown) => boolean => typeof key === 'function');
    const scope = cacheScope.get();

    expect(
      matchers.some((match) =>
        match(['replica:sync', 'notebookDocuments', 1, scope, 'topic-1', 'topic-1']),
      ),
    ).toBe(true);
  });
});
