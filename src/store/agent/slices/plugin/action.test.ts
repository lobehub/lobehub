import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';

import { useAgentStore } from '../../store';

// Mock agentService
vi.mock('@/services/agent', () => ({
  AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT: 12,
  agentService: {
    updateAgentConfig: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAgentStore.setState({
    activeAgentId: undefined,
    agentMap: {},
    builtinAgentIdMap: {},
    updateAgentConfigSignal: undefined,
    updateAgentMetaSignal: undefined,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PluginSlice Actions', () => {
  describe('togglePlugin', () => {
    it('should enable plugin as mode auto when not in list', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { plugins: [{ identifier: 'plugin-1', mode: 'auto' }] } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { plugins: [] } as any },
        });
      });

      await act(async () => {
        await result.current.togglePlugin('plugin-1');
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          plugins: [{ identifier: 'plugin-1', mode: 'auto' }],
        }),
        expect.any(AbortSignal),
        undefined,
      );
    });

    it('should disable plugin when already enabled (legacy string or auto object)', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { plugins: [{ identifier: 'plugin-1', mode: 'disabled' }] } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { plugins: ['plugin-1'] } as any },
        });
      });

      await act(async () => {
        await result.current.togglePlugin('plugin-1');
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          plugins: [{ identifier: 'plugin-1', mode: 'disabled' }],
        }),
        expect.any(AbortSignal),
        undefined,
      );
    });

    it('keeps the toggle on its Agent when the user switches while it loads', async () => {
      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { plugins: [{ identifier: 'plugin-1', mode: 'auto' }] } as any,
        success: true,
      });

      useAgentStore.setState({
        activeAgentId: 'agent-1',
        agentMap: {
          'agent-1': { plugins: [] } as any,
          'agent-2': { plugins: [] } as any,
        },
      });

      await act(async () => {
        const toggle = useAgentStore.getState().togglePlugin('plugin-1', true);
        useAgentStore.setState({ activeAgentId: 'agent-2' });
        await toggle;
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledTimes(1);
      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          plugins: [{ identifier: 'plugin-1', mode: 'auto' }],
        }),
        expect.any(AbortSignal),
        undefined,
      );
    });

    it('should enable plugin as mode auto when open=true explicitly', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { plugins: [{ identifier: 'plugin-1', mode: 'auto' }] } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { plugins: [] } as any },
        });
      });

      await act(async () => {
        await result.current.togglePlugin('plugin-1', true);
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          plugins: [{ identifier: 'plugin-1', mode: 'auto' }],
        }),
        expect.any(AbortSignal),
        undefined,
      );
    });

    it('should disable plugin explicitly when open=false', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { plugins: [{ identifier: 'plugin-1', mode: 'disabled' }] } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { plugins: ['plugin-1'] } as any },
        });
      });

      await act(async () => {
        await result.current.togglePlugin('plugin-1', false);
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          plugins: [{ identifier: 'plugin-1', mode: 'disabled' }],
        }),
        expect.any(AbortSignal),
        undefined,
      );
    });

    it('should not add duplicate plugin and should upgrade legacy entries in place', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { plugins: [{ identifier: 'plugin-1', mode: 'auto' }] } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { plugins: ['plugin-1'] } as any },
        });
      });

      await act(async () => {
        await result.current.togglePlugin('plugin-1', true);
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          plugins: [{ identifier: 'plugin-1', mode: 'auto' }],
        }),
        expect.any(AbortSignal),
        undefined,
      );
    });

    it('sets builtinOverride when toggling an on-demand builtin tool', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { plugins: [] } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: {
            'agent-1': {
              plugins: [{ identifier: 'lobe-calculator', mode: 'disabled' }],
            } as any,
          },
        });
      });

      await act(async () => {
        await result.current.togglePlugin('lobe-calculator', true);
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          plugins: [{ builtinOverride: true, identifier: 'lobe-calculator', mode: 'auto' }],
        }),
        expect.any(AbortSignal),
        undefined,
      );
    });

    it('toggleAgentPlugin flips a disabled object entry in place without appending duplicates', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { plugins: [] } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: {
            'agent-1': {
              plugins: [{ identifier: 'github', mode: 'disabled' }],
            } as any,
          },
        });
      });

      await act(async () => {
        await result.current.toggleAgentPlugin('github', true);
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          plugins: [{ identifier: 'github', mode: 'auto' }],
        }),
        expect.any(AbortSignal),
        undefined,
      );
    });

    it('should handle empty plugins array', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { plugins: [{ identifier: 'plugin-1', mode: 'auto' }] } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': {} as any }, // No plugins field
        });
      });

      await act(async () => {
        await result.current.togglePlugin('plugin-1');
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          plugins: [{ identifier: 'plugin-1', mode: 'auto' }],
        }),
        expect.any(AbortSignal),
        undefined,
      );
    });
  });

  describe('removePlugin', () => {
    it('should drop an existing entry regardless of mode', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { plugins: [] } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: {
            'agent-1': { plugins: [{ identifier: 'plugin-1', mode: 'disabled' }] } as any,
          },
        });
      });

      await act(async () => {
        await result.current.removePlugin('plugin-1');
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          plugins: [],
        }),
        expect.any(AbortSignal),
        undefined,
      );
    });

    it('should handle removing non-existent plugin gracefully', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { plugins: ['existing-plugin'] } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { plugins: ['existing-plugin'] } as any },
        });
      });

      await act(async () => {
        await result.current.removePlugin('non-existent');
      });

      // Should not modify the array
      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          plugins: ['existing-plugin'],
        }),
        expect.any(AbortSignal),
        undefined,
      );
    });
  });

  describe('setPluginMode', () => {
    it('disables a legacy string entry, upgrading only that entry', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: {} as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { plugins: ['plugin-1', 'plugin-2'] } as any },
        });
      });

      await act(async () => {
        await result.current.setPluginMode('plugin-1', 'disabled');
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          // untouched sibling entry stays a bare string (lazy per-item upgrade)
          plugins: [{ identifier: 'plugin-1', mode: 'disabled' }, 'plugin-2'],
        }),
        expect.any(AbortSignal),
        undefined,
      );
    });

    it('can switch a disabled entry back to pinned', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: {} as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: {
            'agent-1': { plugins: [{ identifier: 'plugin-1', mode: 'disabled' }] } as any,
          },
        });
      });

      await act(async () => {
        await result.current.setPluginMode('plugin-1', 'pinned');
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          plugins: [{ identifier: 'plugin-1', mode: 'pinned' }],
        }),
        expect.any(AbortSignal),
        undefined,
      );
    });

    it('setting mode to auto removes the entry entirely', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: {} as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: {
            'agent-1': {
              plugins: [{ identifier: 'plugin-1', mode: 'disabled' }, 'plugin-2'],
            } as any,
          },
        });
      });

      await act(async () => {
        await result.current.setPluginMode('plugin-1', 'auto');
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          plugins: ['plugin-2'],
        }),
        expect.any(AbortSignal),
        undefined,
      );
    });

    it('keeps an explicit auto entry for a library skill, whose absence means disabled', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: {} as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { plugins: ['plugin-2'] } as any },
        });
      });

      await act(async () => {
        await result.current.setPluginMode('excalidraw', 'auto', 'disabled');
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          plugins: ['plugin-2', { identifier: 'excalidraw', mode: 'auto' }],
        }),
        expect.any(AbortSignal),
        undefined,
      );
    });
  });
});
