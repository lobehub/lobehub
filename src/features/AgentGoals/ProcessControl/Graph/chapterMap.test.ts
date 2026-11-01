import type { GoalEdgeKind, GoalGraphEdge, GoalReportState } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { GoalGraphView, GoalNodeView } from '../goalGraphViewModel';
import { chapterMap } from './chapterMap';
import { edgeTone, resolveMainline } from './mainline';

type Link = [id: string, kind: GoalEdgeKind, source: string, target: string];

const graphOf = (
  nodes: Record<string, 'problem' | 'task' | 'finding' | 'experiment'>,
  links: Link[],
  mainline?: { edgeIds: string[]; nodeIds: string[] },
): GoalGraphView => {
  const views = Object.entries(nodes).map(
    ([id, kind]) => ({ node: { id, kind, status: 'resolved' } }) as unknown as GoalNodeView,
  );
  return {
    blocked: [],
    byId: Object.fromEntries(views.map((view) => [view.node.id, view])),
    edges: links.map(
      ([id, kind, sourceNodeId, targetNodeId]) =>
        ({ id, kind, sourceNodeId, targetNodeId }) as GoalGraphEdge,
    ),
    frontier: [],
    nodes: views,
    report: mainline
      ? ({
          latest: {
            metadata: { chapters: [], graphCursor: 'e', headline: 'H', mainline, nextSteps: [] },
          },
          status: 'completed',
        } as unknown as GoalReportState)
      : undefined,
  } as unknown as GoalGraphView;
};

const edgeIds = (map: ReturnType<typeof chapterMap>) => map.graph.edges.map((edge) => edge.id);
const nodeIds = (map: ReturnType<typeof chapterMap>) => map.graph.nodes.map((v) => v.node.id);

describe('chapterMap', () => {
  it('keeps every relation between the chapter’s own nodes', () => {
    const graph = graphOf(
      { a: 'task', b: 'task', c: 'task', d: 'task', e: 'task', f: 'finding', g: 'task' },
      [
        ['e-dep', 'depends_on', 'b', 'a'],
        ['e-der', 'derived_from', 'c', 'b'],
        ['e-rev', 'revises', 'd', 'c'],
        ['e-con', 'contradicts', 'f', 'd'],
        ['e-pro', 'produces', 'e', 'f'],
        ['e-dec', 'decomposes', 'a', 'e'],
        ['e-out', 'depends_on', 'g', 'a'],
      ],
    );

    const map = chapterMap(graph, ['a', 'b', 'c', 'd', 'e', 'f']);

    expect(edgeIds(map)).toEqual(['e-dep', 'e-der', 'e-rev', 'e-con', 'e-pro', 'e-dec']);
    expect(map.bridges).toEqual([]);
    expect([...map.contextIds]).toEqual([]);
  });

  it('shows the question a detour forked from when the chapter does not list it', () => {
    // p decomposes into the mainline task and the dead end: neither links to the other.
    const graph = graphOf(
      { dead: 'task', main: 'task', p: 'problem' },
      [
        ['p-main', 'decomposes', 'p', 'main'],
        ['p-dead', 'decomposes', 'p', 'dead'],
      ],
      { edgeIds: ['p-main'], nodeIds: ['main'] },
    );

    const map = chapterMap(graph, ['main', 'dead']);

    expect([...map.contextIds]).toEqual(['p']);
    expect(nodeIds(map).sort()).toEqual(['dead', 'main', 'p']);
    expect(edgeIds(map)).toEqual(['p-main', 'p-dead']);
    expect(map.bridges).toEqual([]);
  });

  it('draws one schematic link when the fork is further than one node away', () => {
    const graph = graphOf(
      { main: 'task', mid1: 'task', mid2: 'task', retry: 'task' },
      [
        ['d1', 'derived_from', 'mid1', 'main'],
        ['d2', 'derived_from', 'mid2', 'mid1'],
        ['d3', 'derived_from', 'retry', 'mid2'],
      ],
      { edgeIds: [], nodeIds: ['main'] },
    );

    const map = chapterMap(graph, ['main', 'retry']);

    expect(map.bridges).toEqual([{ hops: 2, sourceNodeId: 'main', targetNodeId: 'retry' }]);
    expect([...map.contextIds]).toEqual([]);
    expect(nodeIds(map).sort()).toEqual(['main', 'retry']);
  });

  it('anchors on the part holding the mainline, whatever order the chapter lists', () => {
    const graph = graphOf(
      { dead: 'task', main: 'task', p: 'problem', side: 'finding' },
      [
        ['p-main', 'decomposes', 'p', 'main'],
        ['p-dead', 'decomposes', 'p', 'dead'],
        ['dead-side', 'produces', 'dead', 'side'],
      ],
      { edgeIds: [], nodeIds: ['main'] },
    );

    const map = chapterMap(graph, ['dead', 'side', 'main']);

    expect([...map.contextIds]).toEqual(['p']);
    expect(edgeIds(map).sort()).toEqual(['dead-side', 'p-dead', 'p-main']);
  });

  it('joins every stray part, not only the first', () => {
    const graph = graphOf(
      { a: 'task', b: 'task', main: 'task', p: 'problem' },
      [
        ['p-main', 'decomposes', 'p', 'main'],
        ['p-a', 'decomposes', 'p', 'a'],
        ['p-b', 'decomposes', 'p', 'b'],
      ],
      { edgeIds: [], nodeIds: ['main'] },
    );

    const map = chapterMap(graph, ['main', 'a', 'b']);

    expect([...map.contextIds]).toEqual(['p']);
    expect(edgeIds(map)).toEqual(['p-main', 'p-a', 'p-b']);
  });

  it('leaves a part with no route to the rest alone, and ignores containment', () => {
    const graph = graphOf(
      { alone: 'task', main: 'task', x: 'experiment' },
      [
        ['x-main', 'contains', 'x', 'main'],
        ['x-alone', 'contains', 'x', 'alone'],
      ],
      { edgeIds: [], nodeIds: ['main'] },
    );

    const map = chapterMap(graph, ['main', 'alone']);

    expect(map.bridges).toEqual([]);
    expect([...map.contextIds]).toEqual([]);
    expect(edgeIds(map)).toEqual([]);
  });

  it('drops chapter references the graph no longer carries', () => {
    const graph = graphOf({ a: 'task' }, []);
    expect(nodeIds(chapterMap(graph, ['a', 'gone']))).toEqual(['a']);
  });
});

describe('edgeTone', () => {
  const graph = graphOf({ dead: 'task', main: 'task', p: 'problem' }, [], {
    edgeIds: ['p-main'],
    nodeIds: ['p', 'main'],
  });
  const mainline = resolveMainline(graph);
  const isMainlineCard = (id: string) => mainline!.nodeIds.has(id);
  const detours = new Set(['dead']);

  it('keeps the mainline line highlighted', () => {
    const edge = { id: 'p-main', sourceNodeId: 'p', targetNodeId: 'main' };
    expect(edgeTone(mainline, edge, isMainlineCard, detours)).toBe('mainline');
  });

  it('draws the line into a detour in the detour style instead of muting it', () => {
    const edge = { id: 'p-dead', sourceNodeId: 'p', targetNodeId: 'dead' };
    expect(edgeTone(mainline, edge, isMainlineCard, detours)).toBe('detour');
    expect(edgeTone(mainline, edge, isMainlineCard)).toBe('muted');
  });

  it('styles a schematic bridge into a detour the same way', () => {
    const bridge = { bridge: true, id: 'b', sourceNodeId: 'main', targetNodeId: 'dead' };
    expect(edgeTone(mainline, bridge, isMainlineCard, detours)).toBe('detour');
  });

  it('calls out a detour even without a marked mainline', () => {
    const edge = { id: 'x', sourceNodeId: 'main', targetNodeId: 'dead' };
    expect(edgeTone(undefined, edge, () => false, detours)).toBe('detour');
    expect(edgeTone(undefined, edge, () => false)).toBeUndefined();
  });
});
