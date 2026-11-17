import { type AgentPluginEntry } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyUserSkillChanges, useUserSkillsManagement } from './useUserSkillsManagement';

const mocks = vi.hoisted(() => ({
  agents: {} as Record<string, { plugins: AgentPluginEntry[] }>,
  refresh: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: {
    getState: () => ({
      agentMap: mocks.agents,
      internal_refreshAgentConfig: mocks.refresh,
      updateAgentConfigById: mocks.update,
    }),
  },
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentConfigById: (id: string) => (state: { agentMap: typeof mocks.agents }) =>
      state.agentMap[id],
  },
}));

const items = [
  { id: 'writing', name: 'Writing' },
  { id: 'analysis', name: 'Analysis', description: 'Spreadsheets' },
  { id: 'review', name: 'Review' },
];

beforeEach(() => {
  mocks.agents = {
    'agent-a': { plugins: ['writing', { identifier: 'analysis', mode: 'auto' }, 'mcp-tool'] },
    'agent-b': { plugins: [] },
  };
  mocks.update.mockReset().mockResolvedValue(undefined);
  mocks.refresh.mockReset().mockResolvedValue(undefined);
});

describe('applyUserSkillChanges', () => {
  it('preserves untouched legacy entries, auto mode, tools, and builtin skills', () => {
    const plugins: AgentPluginEntry[] = [
      'writing',
      { identifier: 'analysis', mode: 'auto' },
      'mcp-tool',
      'lobehub',
    ];
    expect(applyUserSkillChanges(plugins, { review: true, writing: false })).toEqual([
      { identifier: 'analysis', mode: 'auto' },
      'mcp-tool',
      'lobehub',
      { identifier: 'review', mode: 'pinned' },
    ]);
    expect(plugins[0]).toBe('writing');
  });

  it('does not turn an already enabled auto skill into pinned', () => {
    const plugins: AgentPluginEntry[] = [{ identifier: 'analysis', mode: 'auto' }];
    expect(applyUserSkillChanges(plugins, { analysis: true })).toBe(plugins);
  });

  it('persists a newly enabled skill explicitly and removes disabled opt-in skills', () => {
    expect(applyUserSkillChanges(undefined, { review: true })).toEqual([
      { identifier: 'review', mode: 'pinned' },
    ]);
    expect(applyUserSkillChanges(['review'], { review: false })).toEqual([]);
  });
});

describe('useUserSkillsManagement', () => {
  it('keeps edits local and discards them on cancel/unmount', () => {
    const { result, unmount } = renderHook(() => useUserSkillsManagement('agent-a', items, true));
    expect(result.current.selectedCount).toBe(2);
    act(() => result.current.setSelected(['review'], true));
    expect(result.current.selectedCount).toBe(3);
    expect(result.current.dirty).toBe(true);
    unmount();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.agents['agent-a'].plugins).not.toContain('review');
  });

  it('keeps checked and unchecked skills visible and preserves selections across search', () => {
    const { result } = renderHook(() => useUserSkillsManagement('agent-a', items, true));
    expect(result.current.filteredItems).toEqual(items);
    act(() => result.current.setSelected(['review'], true));
    act(() => result.current.setSelected(['writing'], false));
    expect(result.current.filteredItems).toEqual(items);
    act(() => result.current.setQuery('spreadsheets'));
    expect(result.current.filteredItems.map(({ id }) => id)).toEqual(['analysis']);
    act(() => result.current.setQuery(''));
    expect(result.current.filteredItems).toEqual(items);
    expect(result.current.isSelected('review')).toBe(true);
    expect(result.current.isSelected('writing')).toBe(false);
  });

  it('applies bulk selection only to the matching results', () => {
    const { result } = renderHook(() => useUserSkillsManagement('agent-a', items, true));
    act(() => result.current.setQuery('writing'));
    act(() =>
      result.current.setSelected(
        result.current.filteredItems.map(({ id }) => id),
        false,
      ),
    );
    expect(result.current.isSelected('writing')).toBe(false);
    expect(result.current.isSelected('analysis')).toBe(true);
    expect(result.current.isSelected('review')).toBe(false);
  });

  it('saves one patch to the bound agent, merging only edited skills into the latest config', async () => {
    const { result } = renderHook(() => useUserSkillsManagement('agent-a', items, true));
    act(() => result.current.setSelected(['review'], true));
    mocks.agents['agent-a'].plugins.push('new-connector');
    await act(async () => {
      expect(await result.current.save()).toBe(true);
    });
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(
      'agent-a',
      {
        plugins: [
          'writing',
          { identifier: 'analysis', mode: 'auto' },
          'mcp-tool',
          'new-connector',
          { identifier: 'review', mode: 'pinned' },
        ],
      },
      { rethrow: true, showErrorMessage: false },
    );
    expect(mocks.agents['agent-b'].plugins).toEqual([]);
  });

  it('does not change modes when a selection is toggled off and back on', async () => {
    const { result } = renderHook(() => useUserSkillsManagement('agent-a', items, true));
    act(() => result.current.setSelected(['analysis'], false));
    act(() => result.current.setSelected(['analysis'], true));
    expect(result.current.dirty).toBe(false);
    await act(async () => {
      await result.current.save();
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('prevents edits and writes without permission', async () => {
    const { result } = renderHook(() => useUserSkillsManagement('agent-a', items, false));
    act(() => result.current.setSelected(['review'], true));
    expect(result.current.dirty).toBe(false);
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('locks edits and duplicate submissions while saving', async () => {
    const deferred = Promise.withResolvers<void>();
    mocks.update.mockReturnValueOnce(deferred.promise);
    const { result } = renderHook(() => useUserSkillsManagement('agent-a', items, true));
    act(() => result.current.setSelected(['review'], true));
    let pending = Promise.resolve(false);
    act(() => {
      pending = result.current.save();
    });
    expect(result.current.saving).toBe(true);
    act(() => result.current.setSelected(['writing'], false));
    expect(result.current.isSelected('writing')).toBe(true);
    expect(await result.current.save()).toBe(false);
    await act(async () => {
      deferred.resolve();
      await pending;
    });
    expect(result.current.saving).toBe(false);
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  it('retains the draft and clears busy state after failure, then permits retry', async () => {
    mocks.update.mockRejectedValueOnce(new Error('Network error'));
    const { result } = renderHook(() => useUserSkillsManagement('agent-a', items, true));
    act(() => result.current.setSelected(['review'], true));
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(result.current.saveFailed).toBe(true);
    expect(result.current.saving).toBe(false);
    expect(result.current.isSelected('review')).toBe(true);
    expect(result.current.dirty).toBe(true);
    expect(mocks.refresh).toHaveBeenCalledWith('agent-a');
    await act(async () => {
      expect(await result.current.save()).toBe(true);
    });
    expect(result.current.saveFailed).toBe(false);
  });

  it('does not re-enable a skill uninstalled while the editor is open', async () => {
    const { result, rerender } = renderHook(
      ({ inventory }) => useUserSkillsManagement('agent-a', inventory, true),
      { initialProps: { inventory: items } },
    );
    act(() => result.current.setSelected(['review'], true));
    rerender({ inventory: items.filter(({ id }) => id !== 'review') });
    expect(result.current.dirty).toBe(false);
    await act(async () => {
      await result.current.save();
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
