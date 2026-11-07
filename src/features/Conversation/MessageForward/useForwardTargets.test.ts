import type { SidebarAgentItem } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useForwardTargets } from './useForwardTargets';

const agent = (id: string, name: string | null, title = 'Codex'): SidebarAgentItem => ({
  id,
  name,
  pinned: false,
  title,
  type: 'agent',
  updatedAt: new Date('2026-10-29T00:00:00Z'),
});

describe('forward picker targets', () => {
  it('displays, searches and submits the custom name instead of the shared role title', () => {
    const { result } = renderHook(() =>
      useForwardTargets([agent('a', '中文 Alpha'), agent('b', ' 私有 Gamma ')], 'source'),
    );
    expect(result.current.candidates.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'a', label: '中文 Alpha' },
      { id: 'b', label: '私有 Gamma' },
    ]);

    act(() => result.current.setKeyword('  私有 gAMMa  '));
    expect(result.current.candidates.map(({ id }) => id)).toEqual(['b']);
    act(() => result.current.toggle('b'));
    expect(result.current.targets).toEqual([{ id: 'b', title: '私有 Gamma' }]);

    act(() => result.current.setKeyword('不存在'));
    expect(result.current.candidates).toEqual([]);
    expect(result.current.targets).toEqual([{ id: 'b', title: '私有 Gamma' }]);
    act(() => result.current.setKeyword(''));
    expect(result.current.candidates).toHaveLength(2);
    act(() => result.current.toggle('b'));
    expect(result.current.targets).toEqual([]);
  });

  it.each([null, '', '   '])('falls back to the role title for name %j', (name) => {
    const { result } = renderHook(() => useForwardTargets([agent('fallback', name)]));
    expect(result.current.candidates[0].label).toBe('Codex');
    act(() => result.current.setKeyword(' cODEx '));
    expect(result.current.candidates.map(({ id }) => id)).toEqual(['fallback']);
    act(() => result.current.toggle('fallback'));
    expect(result.current.targets).toEqual([{ id: 'fallback', title: 'Codex' }]);
  });

  it('excludes the source and groups from candidates and submitted targets', () => {
    const source = agent('source', '源助理');
    const group: SidebarAgentItem = { ...agent('group', '群组'), type: 'group' };
    const { result } = renderHook(() =>
      useForwardTargets([source, group, agent('target', '目标助理')], 'source'),
    );
    expect(result.current.candidates.map(({ id }) => id)).toEqual(['target']);
    act(() => {
      result.current.toggle('source');
      result.current.toggle('group');
      result.current.toggle('target');
    });
    expect(result.current.targets).toEqual([{ id: 'target', title: '目标助理' }]);
  });
});
