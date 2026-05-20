/**
 * @vitest-environment happy-dom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutoCreateTopicDocument } from './useAutoCreateTopicDocument';

const createForTopicMock = vi.hoisted(() => vi.fn());
const notebookMock = vi.hoisted(() => ({
  documents: [] as Array<{ id: string }>,
  isLoading: false,
  useFetchDocuments: vi.fn(),
}));
const chatMock = vi.hoisted(() => ({
  topicTitle: 'Research Topic',
}));

interface MockNotebookState {
  notebookMap: Record<string, Array<{ id: string }>>;
  useFetchDocuments: typeof notebookMock.useFetchDocuments;
}

interface MockChatState {
  topicDataMap: Record<string, { items: Array<{ id: string; title: string }> }>;
}

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: {
    createForTopic: createForTopicMock,
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: MockChatState) => unknown) =>
    selector({
      topicDataMap: {
        'agent:agt_test': { items: [{ id: 'tpc_test', title: chatMock.topicTitle }] },
      },
    }),
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    getTopicById: (id: string) => (state: MockChatState) =>
      Object.values(state.topicDataMap)
        .flatMap((data) => data.items)
        .find((topic) => topic.id === id),
  },
}));

vi.mock('@/store/notebook', () => ({
  notebookSelectors: {
    getDocumentsByTopicId: (topicId: string | undefined) => (state: MockNotebookState) => {
      if (!topicId) return [];

      return state.notebookMap[topicId] ?? [];
    },
  },
  useNotebookStore: (selector: (state: MockNotebookState) => unknown) =>
    selector({
      notebookMap: { tpc_test: notebookMock.documents },
      useFetchDocuments: notebookMock.useFetchDocuments,
    }),
}));

describe('useAutoCreateTopicDocument', () => {
  beforeEach(() => {
    createForTopicMock.mockReset();
    chatMock.topicTitle = 'Research Topic';
    notebookMock.documents = [];
    notebookMock.isLoading = false;
    notebookMock.useFetchDocuments.mockReset();
    notebookMock.useFetchDocuments.mockImplementation(() => ({
      isLoading: notebookMock.isLoading,
    }));
  });

  it('returns an existing topic document id without creating a new page', () => {
    notebookMock.documents = [{ id: 'doc_existing' }];

    const { result } = renderHook(() => useAutoCreateTopicDocument('tpc_test', 'agt_test'));

    expect(result.current.documentId).toBe('doc_existing');
    expect(createForTopicMock).not.toHaveBeenCalled();
  });

  it('creates a topic page and exposes the created document id before the list refresh is observed', async () => {
    createForTopicMock.mockResolvedValue({ documentId: 'doc_created' });

    const { result } = renderHook(() => useAutoCreateTopicDocument('tpc_test', 'agt_test'));

    await waitFor(() => expect(result.current.documentId).toBe('doc_created'));
    expect(createForTopicMock).toHaveBeenCalledWith({
      agentId: 'agt_test',
      content: '',
      title: 'Research Topic',
      topicId: 'tpc_test',
    });
  });
});
