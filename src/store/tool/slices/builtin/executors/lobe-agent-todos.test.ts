import { lobeAgentExecutor } from '@lobechat/builtin-tool-lobe-agent/client/executor';
import type { BuiltinToolContext } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import useSWR from 'swr';
import { describe, expect, it, vi } from 'vitest';

import { notebookSWRKeys } from '@/services/document/swrKeys';

const { row, updateDocument } = vi.hoisted(() => {
  const row = { current: { metadata: {} as Record<string, any> } };
  return {
    row,
    updateDocument: vi.fn(async ({ metadata }) => {
      row.current = { metadata };
    }),
  };
});

vi.mock('@/libs/swr', async () => ({ mutate: (await import('swr')).mutate }));
vi.mock('@/services/notebook', () => ({
  notebookService: {
    listDocuments: vi.fn().mockResolvedValue({
      data: [{ createdAt: new Date(), id: 'plan-1', metadata: {}, updatedAt: new Date() }],
    }),
    updateDocument,
  },
}));
vi.mock('@/store/notebook', () => ({ useNotebookStore: { getState: () => ({}) } }));

describe('lobeAgentExecutor plan todos sync', () => {
  it('revalidates the plan document after syncing todos into its metadata', async () => {
    const ctx = { currentTodos: [], topicId: 'topic-1' } as unknown as BuiltinToolContext;

    const { result: cache } = renderHook(() =>
      useSWR(notebookSWRKeys.documents('topic-1'), async () => row.current),
    );
    await waitFor(() => expect(cache.current.data).toBeDefined());
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
    expect(cache.current.data?.metadata.todos.items).toEqual([
      expect.objectContaining({ text: 'ship it' }),
    ]);
  });
});
