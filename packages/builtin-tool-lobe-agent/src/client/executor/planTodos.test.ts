import type { BuiltinToolContext } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { lobeAgentExecutor } from './index';

const { invalidateDocumentMutation, updateDocument } = vi.hoisted(() => ({
  invalidateDocumentMutation: vi.fn().mockResolvedValue(undefined),
  updateDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/document/invalidation', () => ({ invalidateDocumentMutation }));
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

    const result = await lobeAgentExecutor.createTodos({ adds: ['ship it'] }, ctx);

    expect(result.success).toBe(true);
    expect(updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'plan-1',
        metadata: expect.objectContaining({ todos: expect.anything() }),
      }),
    );
    expect(invalidateDocumentMutation).toHaveBeenCalledWith({
      cause: 'notebook',
      documentId: 'plan-1',
    });
  });
});
