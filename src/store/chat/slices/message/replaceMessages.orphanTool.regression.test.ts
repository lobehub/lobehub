import { type UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useChatStore } from '../../store';

// `replaceMessages` is pure store + conversation-flow `parse` (no service
// calls), but importing the chat store pulls the whole slice graph, so mirror
// the minimal service / swr / zustand stubs the sibling action tests use.
vi.mock('@/libs/swr', async () => {
  const actual = await vi.importActual('@/libs/swr');
  return { ...actual, mutate: vi.fn() };
});
vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.resolve(new Response('mock'))),
);
vi.mock('zustand/traditional');
vi.mock('@/services/message', () => ({
  messageService: {
    createMessage: vi.fn(),
    getMessages: vi.fn(),
    updateMessage: vi.fn(),
    updateMessageError: vi.fn(),
  },
}));
vi.mock('@/services/topic', () => ({ topicService: {} }));

const CTX = { agentId: 'agent-1', topicId: 'topic-1' };
const KEY = messageMapKey(CTX);

const tool = (id: string, name: string) => ({
  apiName: name,
  arguments: '{}',
  id,
  identifier: name,
  type: 'default' as const,
});

/**
 * Real CC streaming chain from trace 20260603-205720-8ecfc841…:
 *   user → assistant#1 (2× Bash) → assistant#2 (Grep) → assistant#3 (Bash)
 *
 * `step2Tools` lets a later (out-of-order / SWR) snapshot drop assistant#2's
 * `tools[]` while the Grep `role:'tool'` row + its parentId chain stay intact —
 * the transient in-memory state that orphans the Grep bubble during streaming.
 */
const buildChain = (step2Tools: 'grep' | 'empty'): UIChatMessage[] =>
  [
    {
      content: 'check error filtering',
      createdAt: 1000,
      id: 'msg-user',
      role: 'user',
      updatedAt: 1000,
    },

    // step 1
    {
      content: 'InsufficientBudgetForModel 是用户侧错误…',
      createdAt: 2000,
      id: 'asst-1',
      parentId: 'msg-user',
      role: 'assistant',
      tools: [tool('bash-1', 'Bash'), tool('bash-2', 'Bash')],
      updatedAt: 2000,
    },
    {
      content: 'logic…',
      createdAt: 2100,
      id: 'bash-1',
      parentId: 'asst-1',
      role: 'tool',
      tool_call_id: 'bash-1',
      updatedAt: 2100,
    },
    {
      content: 'refs…',
      createdAt: 2200,
      id: 'bash-2',
      parentId: 'asst-1',
      role: 'tool',
      tool_call_id: 'bash-2',
      updatedAt: 2200,
    },

    // step 2 — the fast Grep tool
    {
      content: 'Let me find where includeUserErrors is applied…',
      createdAt: 3000,
      id: 'asst-2',
      parentId: 'bash-2',
      role: 'assistant',
      tools: step2Tools === 'grep' ? [tool('grep-1', 'Grep')] : [],
      updatedAt: 3000,
    },
    {
      content: 'attribution IS DISTINCT FROM user…',
      createdAt: 3100,
      id: 'grep-1',
      parentId: 'asst-2',
      role: 'tool',
      tool_call_id: 'grep-1',
      updatedAt: 3100,
    },

    // step 3 — chained off the Grep tool message
    {
      content: 'Inspect backfill classification rules',
      createdAt: 4000,
      id: 'asst-3',
      parentId: 'grep-1',
      role: 'assistant',
      tools: [tool('bash-3', 'Bash')],
      updatedAt: 4000,
    },
    {
      content: 'rules…',
      createdAt: 4100,
      id: 'bash-3',
      parentId: 'asst-3',
      role: 'tool',
      tool_call_id: 'bash-3',
      updatedAt: 4100,
    },
  ] as UIChatMessage[];

const topLevelToolIds = (result: { current: ReturnType<typeof useChatStore.getState> }) =>
  (result.current.messagesMap[KEY] ?? []).filter((m) => m.role === 'tool').map((m) => m.id);

describe('replaceMessages — hetero-agent streaming orphan tool regression', () => {
  beforeEach(() => {
    useChatStore.setState({ activeAgentId: 'agent-1', activeTopicId: 'topic-1' }, false);
  });

  it('groups the full CC chain when tools[] is intact (control)', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.replaceMessages(buildChain('grep'), { context: CTX });
    });

    // Whole run collapses into one assistantGroup, no stray tool bubble.
    expect(topLevelToolIds(result)).toEqual([]);
    expect((result.current.messagesMap[KEY] ?? []).map((m) => m.role)).toEqual([
      'user',
      'assistantGroup',
    ]);
  });

  it('does not orphan the Grep tool when a stale snapshot drops assistant#2 tools[]', () => {
    const { result } = renderHook(() => useChatStore());

    // 1. Consistent live state — Grep grouped under assistant#2.
    act(() => {
      result.current.replaceMessages(buildChain('grep'), { context: CTX });
    });
    expect(topLevelToolIds(result)).toEqual([]);

    // 2. A later out-of-order / SWR snapshot lands assistant#2 with an empty
    //    tools[] (the "7→6 次技能调用" tools[] regression, taken to its
    //    extreme). The Grep row + parentId survive. replaceMessages must not
    //    let that regression demote Grep to a top-level orphan bubble — the
    //    exact thing the UI flags as `inspector.orphanedToolCall`.
    act(() => {
      result.current.replaceMessages(buildChain('empty'), { context: CTX });
    });

    expect(topLevelToolIds(result)).toEqual([]);
  });

  // Guard against over-reaching: a genuine deletion (the Grep tool ROW is gone
  // from the snapshot, along with everything chained after it) must NOT be
  // resurrected by the reconciliation.
  it('does not resurrect a genuinely deleted tool (row absent from snapshot)', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.replaceMessages(buildChain('grep'), { context: CTX });
    });

    // User trimmed the conversation back to step 1 — grep row + step-3 chain
    // are gone, and assistant#2 no longer references the (deleted) grep.
    const trimmed = buildChain('empty').filter(
      (m) => !['asst-3', 'bash-3', 'grep-1'].includes(m.id),
    );
    act(() => {
      result.current.replaceMessages(trimmed, { context: CTX });
    });

    const ids = (result.current.messagesMap[KEY] ?? []).flatMap((m) =>
      m.role === 'tool' ? [m.id] : [],
    );
    // No phantom grep anywhere — neither as an orphan nor re-linked.
    expect(ids).toEqual([]);
    const raw = result.current.dbMessagesMap[KEY] ?? [];
    expect(raw.some((m) => m.id === 'grep-1')).toBe(false);
    expect(raw.find((m) => m.id === 'asst-2')?.tools ?? []).toEqual([]);
  });
});
