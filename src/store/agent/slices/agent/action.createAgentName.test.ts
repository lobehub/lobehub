import type * as ConstModule from '@lobechat/const';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';

import { useAgentStore } from '../../store';

const { randomAgentName } = vi.hoisted(() => ({ randomAgentName: vi.fn(() => '小满') }));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof ConstModule>()),
  randomAgentName,
}));

vi.mock('@/services/agent', () => ({
  AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT: 12,
  agentService: { createAgent: vi.fn() },
}));

const sidebarAgent = (id: string, name: string | null) =>
  ({ id, name, pinned: false, title: null, type: 'agent', updatedAt: new Date() }) as any;

describe('createAgent default name', () => {
  afterEach(() => {
    useHomeStore.setState({ pinnedAgents: [], ungroupedAgents: [] });
    vi.clearAllMocks();
  });

  it('draws a name that skips the ones already in the sidebar', async () => {
    vi.mocked(agentService.createAgent).mockResolvedValue({ agentId: 'agent-new' });
    const status = useGlobalStore.getState().status;
    useGlobalStore.setState({ status: { ...status, language: 'zh-CN' } });
    useHomeStore.setState({
      pinnedAgents: [sidebarAgent('a1', '小禾')],
      ungroupedAgents: [sidebarAgent('a2', '知夏'), sidebarAgent('a3', null)],
    });
    const { result } = renderHook(() => useAgentStore());

    try {
      await act(async () => {
        await result.current.createAgent({ config: { title: '健康助手' } });
      });

      expect(randomAgentName).toHaveBeenCalledExactlyOnceWith('zh-CN', ['小禾', '知夏']);
      expect(vi.mocked(agentService.createAgent).mock.calls[0][0].config?.name).toBe('小满');
    } finally {
      useGlobalStore.setState({ status });
    }
  });

  it('keeps a name the caller already carries without drawing one', async () => {
    vi.mocked(agentService.createAgent).mockResolvedValue({ agentId: 'agent-new' });
    const { result } = renderHook(() => useAgentStore());

    await act(async () => {
      await result.current.createAgent({ config: { name: 'Ada', title: 'Math Tutor' } });
    });

    expect(randomAgentName).not.toHaveBeenCalled();
  });
});
