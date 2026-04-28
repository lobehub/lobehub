/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialState as initialChatState } from '@/store/chat/initialState';
import { useChatStore } from '@/store/chat/store';
import { createInitialEditorContentState, useDocumentStore } from '@/store/document';
import { initialEditorState } from '@/store/document/slices/editor';

import { useAgentContext } from './useAgentContext';

describe('useAgentContext', () => {
  beforeEach(() => {
    useChatStore.setState(
      {
        ...initialChatState,
        activeAgentId: 'agt_1',
        activeThreadId: undefined,
        activeTopicId: 'tpc_1',
      },
      false,
    );
    useDocumentStore.setState({ ...initialEditorState }, false);
  });

  it('carries the active notebook document for the current topic in main scope', () => {
    useDocumentStore.setState(
      {
        activeDocumentId: 'docs_1',
        documents: {
          docs_1: createInitialEditorContentState('notebook', { topicId: 'tpc_1' }),
        },
      },
      false,
    );

    const { result } = renderHook(() => useAgentContext());

    expect(result.current).toEqual({
      agentId: 'agt_1',
      documentId: 'docs_1',
      scope: 'main',
      threadId: null,
      topicId: 'tpc_1',
    });
  });

  it('falls back to the last opened topic document after leaving the page route', () => {
    useDocumentStore.setState(
      {
        activeDocumentId: undefined,
        documents: {
          docs_1: createInitialEditorContentState('notebook', { topicId: 'tpc_1' }),
        },
        lastActiveTopicDocumentIdByTopicId: {
          tpc_1: 'docs_1',
        },
      },
      false,
    );

    const { result } = renderHook(() => useAgentContext());

    expect(result.current.documentId).toBe('docs_1');
  });

  it('can carry the last topic document id even when editor document state has been cleared', () => {
    useDocumentStore.setState(
      {
        activeDocumentId: undefined,
        documents: {},
        lastActiveTopicDocumentIdByTopicId: {
          tpc_1: 'docs_1',
        },
      },
      false,
    );

    const { result } = renderHook(() => useAgentContext());

    expect(result.current.documentId).toBe('docs_1');
  });

  it('does not carry a stale notebook document from another topic', () => {
    useDocumentStore.setState(
      {
        activeDocumentId: 'docs_1',
        documents: {
          docs_1: createInitialEditorContentState('notebook', { topicId: 'tpc_other' }),
        },
      },
      false,
    );

    const { result } = renderHook(() => useAgentContext());

    expect(result.current.documentId).toBeUndefined();
  });
});
