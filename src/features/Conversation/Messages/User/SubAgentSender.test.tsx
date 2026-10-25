/**
 * @vitest-environment happy-dom
 */
import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  SubAgentSenderTags,
  SubAgentThreadLink,
  useSubAgentSenderIdentity,
} from './SubAgentSender';

const agentState = vi.hoisted(() => ({
  agentMap: { 'agt-poet': { avatar: '🪶', title: '诗人' } } as Record<string, any>,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector(agentState),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    getAgentMetaById: (id: string) => (s: typeof agentState) => s.agentMap[id] ?? {},
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({ closeThreadPortal: vi.fn(), openThreadInPortal: vi.fn() }),
}));

const threads = vi.hoisted(() => ({ list: [] as { id: string; sourceMessageId: string }[] }));

vi.mock('@/store/chat/selectors', () => ({
  portalThreadSelectors: { portalThreadId: () => undefined },
  threadSelectors: { currentTopicThreads: () => threads.list },
}));

describe('useSubAgentSenderIdentity', () => {
  // The report is a user turn whose sender is the agent that answered.
  it('speaks as the answering agent, under the call name when there is one', () => {
    const named = renderHook(() =>
      useSubAgentSenderIdentity({
        agentId: 'agt-poet',
        name: '列 todo 并写雪诗',
        status: 'completed',
        threadId: 'thd_1',
      }),
    );
    const bare = renderHook(() =>
      useSubAgentSenderIdentity({
        agentId: 'agt-poet',
        name: '',
        status: 'completed',
        threadId: 'thd_2',
      }),
    );

    expect(named.result.current).toEqual({ avatar: '🪶', title: '列 todo 并写雪诗' });
    expect(bare.result.current).toEqual({ avatar: '🪶', title: '诗人' });
  });

  it('is absent for an ordinary user message', () => {
    const { result } = renderHook(() => useSubAgentSenderIdentity(undefined));

    expect(result.current).toBeUndefined();
  });
});

describe('SubAgentSenderTags', () => {
  it('tags the sender as a sub-agent and marks one that did not finish', () => {
    const { rerender } = render(
      <SubAgentSenderTags callback={{ name: 'Poet', status: 'completed', threadId: 'thd' }} />,
    );
    expect(screen.getByText('subAgentCallback.tag')).toBeTruthy();
    expect(screen.queryByText('subAgentCallback.failed')).toBeNull();

    rerender(<SubAgentSenderTags callback={{ name: 'Poet', status: 'error', threadId: 'thd' }} />);
    expect(screen.getByText('subAgentCallback.failed')).toBeTruthy();
  });
});

describe('SubAgentThreadLink', () => {
  // The thread link sits under the report, not in its header.
  it('offers the thread under the message once the thread is listed', () => {
    const callback = { name: 'Poet', status: 'completed' as const, threadId: 'thd_1' };

    threads.list = [];
    const { rerender } = render(<SubAgentThreadLink callback={callback} />);
    expect(screen.queryByText('thread.openSubagentThread')).toBeNull();

    threads.list = [{ id: 'thd_1', sourceMessageId: 'msg_tool' }];
    rerender(<SubAgentThreadLink callback={callback} />);
    expect(screen.getByText('thread.openSubagentThread')).toBeTruthy();
  });

  it('leaves the thread link out of the header tags', () => {
    threads.list = [{ id: 'thd_1', sourceMessageId: 'msg_tool' }];
    render(
      <SubAgentSenderTags callback={{ name: 'Poet', status: 'completed', threadId: 'thd_1' }} />,
    );

    expect(screen.queryByText('thread.openSubagentThread')).toBeNull();
  });
});
