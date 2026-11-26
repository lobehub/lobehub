import type { ShareVisitorTopicGroup } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useActiveVisitorTopic } from './useActiveVisitorTopic';

const activePathnameMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ hash: '', pathname: activePathnameMock(), search: '' }),
}));

const groups = [
  {
    topics: [{ id: 'tpc_a' }, { id: 'tpc_b' }],
    visitor: { avatar: null, id: 'user_alice', name: 'Alice' },
  },
  {
    topics: [{ id: 'tpc_c' }],
    visitor: { avatar: null, id: 'user_bob', name: 'Bob' },
  },
] as unknown as ShareVisitorTopicGroup[];

/**
 * The sidebar's own router stays on the Agent root, as on desktop, where the sidebar renders
 * outside the tab that shows the visitor topic.
 */
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(MemoryRouter, { initialEntries: ['/agent/agt_1'] }, children);

describe('useActiveVisitorTopic', () => {
  beforeEach(() => {
    activePathnameMock.mockReset();
  });

  it('follows the active tab URL rather than the sidebar router', () => {
    activePathnameMock.mockReturnValue('/agent/agt_1/visitor/tpc_b');

    const { result } = renderHook(() => useActiveVisitorTopic(groups), { wrapper });

    expect(result.current).toEqual({ activeTopicId: 'tpc_b', activeVisitorId: 'user_alice' });
  });

  it('finds no topic when the tab shows something else', () => {
    activePathnameMock.mockReturnValue('/agent/agt_1/tpc_own');

    const { result } = renderHook(() => useActiveVisitorTopic(groups), { wrapper });

    expect(result.current).toEqual({ activeTopicId: undefined, activeVisitorId: undefined });
  });
});
