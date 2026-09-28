import type { GoalGraphEdge, GoalGraphNode } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { explorationMap } from './explorationMap';
import { useExplorationNavigation } from './useExplorationNavigation';

const nodes = [
  { id: 'a', kind: 'experiment' },
  { id: 'b', kind: 'experiment' },
  { id: 'nested', kind: 'experiment' },
  { id: 't', kind: 'task' },
  { id: 'nt', kind: 'task' },
] as GoalGraphNode[];
const edges = [
  { id: 'an', sourceNodeId: 'a', targetNodeId: 'nested', kind: 'contains' },
  { id: 'at', sourceNodeId: 'a', targetNodeId: 't', kind: 'contains' },
  { id: 'nt', sourceNodeId: 'nested', targetNodeId: 'nt', kind: 'contains' },
  { id: 'history', sourceNodeId: 'b', targetNodeId: 'a', kind: 'derived_from' },
] as GoalGraphEdge[];
const graph = { nodes, edges };

describe('experiment navigation', () => {
  it('starts collapsed even after async data arrives, and new experiments do not reset manual expansion', () => {
    const { result, rerender } = renderHook(
      (nodes) => useExplorationNavigation('g', { nodes, edges }),
      { initialProps: [] as GoalGraphNode[] },
    );
    rerender(nodes);
    expect(explorationMap(nodes, edges, result.current.collapsed).nodes.map((n) => n.id)).toEqual([
      'a',
      'b',
    ]);
    act(() => result.current.toggle('a'));
    expect(result.current.collapsed.has('nested')).toBe(true);
    rerender([...nodes, { id: 'new', kind: 'experiment' } as GoalGraphNode]);
    expect(result.current.collapsed.has('new')).toBe(true);
    expect(result.current.collapsed.has('a')).toBe(false);
  });
  it('drills through nested groups and returns without losing expansion or global provenance', () => {
    const { result } = renderHook(() => useExplorationNavigation('g', graph));
    act(() => result.current.toggle('a'));
    act(() => result.current.enter('a'));
    expect(result.current.nodes.map((n) => n.id)).toEqual(['nested', 't', 'nt']);
    expect(result.current.edges.some((e) => e.id === 'history')).toBe(false);
    act(() => result.current.toggle('nested'));
    act(() => result.current.enter('nested'));
    expect(result.current.path).toEqual(['a', 'nested']);
    expect(result.current.nodes.map((n) => n.id)).toEqual(['nt']);
    act(() => result.current.backTo(1));
    expect(result.current.scopeId).toBe('a');
    act(() => result.current.backTo(0));
    expect(result.current.edges).toContainEqual(edges[3]);
    expect([...result.current.collapsed]).toEqual(['b']);
  });
  it('supports empty groups and resets navigation when switching goals', () => {
    const { result, rerender } = renderHook((id) => useExplorationNavigation(id, graph), {
      initialProps: 'g',
    });
    act(() => result.current.enter('b'));
    expect(result.current.nodes).toHaveLength(0);
    expect(result.current.path).toEqual(['b']);
    rerender('other');
    expect(result.current.path).toEqual([]);
    expect(result.current.collapsed.size).toBe(3);
  });
  it('keeps the collapsed set identity across re-renders that do not change it', () => {
    const { result, rerender } = renderHook((props) => useExplorationNavigation('g', props), {
      initialProps: graph,
    });
    const initial = result.current.collapsed;
    // A graph poll hands over a new snapshot with the same content.
    rerender({ nodes: [...nodes], edges: [...edges] });
    expect(result.current.collapsed).toBe(initial);

    act(() => result.current.toggle('a'));
    expect(result.current.collapsed).not.toBe(initial);
  });
  it('keeps an empty collapsed set stable for graphs without experiments', () => {
    const plain = { nodes: [{ id: 't', kind: 'task' }] as GoalGraphNode[], edges: [] };
    const { result, rerender } = renderHook((props) => useExplorationNavigation('g', props), {
      initialProps: plain,
    });
    const initial = result.current.collapsed;
    rerender({ ...plain, nodes: [...plain.nodes] });
    expect(result.current.collapsed).toBe(initial);
    expect(initial.size).toBe(0);
  });
  it('bulk controls act on the current scope without collapsing its ancestor', () => {
    const { result } = renderHook(() => useExplorationNavigation('g', graph));
    act(() => result.current.expandAll(true));
    act(() => result.current.enter('a'));
    act(() => result.current.expandAll(false));
    act(() => result.current.backTo(0));
    expect([...result.current.collapsed]).toEqual(['nested']);
  });
});
