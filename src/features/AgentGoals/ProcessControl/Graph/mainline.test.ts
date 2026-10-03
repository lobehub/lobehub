import type { GoalReportState } from '@lobechat/types';
import { cssVar } from 'antd-style';
import { describe, expect, it } from 'vitest';

import type { GoalGraphView } from '../goalGraphViewModel';
import {
  edgeEmphasis,
  edgeMarkerColor,
  isNodeDimmed,
  MUTED_EDGE_OPACITY,
  MUTED_EDGE_OPACITY_DARK,
  nodeEmphasis,
  resolveMainline,
} from './mainline';

const graphWith = (
  mainline: { edgeIds: string[]; nodeIds: string[] } | undefined,
  nodeIds = ['p', 't1', 't2', 't3', 'x1'],
  kinds: Record<string, string> = {},
) => {
  const nodes = nodeIds.map((id) => ({ node: { id, kind: kinds[id] } }));
  return {
    byId: Object.fromEntries(nodes.map((view) => [view.node.id, view])),
    edges: [],
    nodes,
    report: {
      latest: {
        metadata: { chapters: [], graphCursor: 'e', headline: 'H', mainline, nextSteps: [] },
      },
      status: 'completed',
    } as unknown as GoalReportState,
  } as unknown as Pick<GoalGraphView, 'byId' | 'edges' | 'nodes' | 'report'>;
};

describe('resolveMainline', () => {
  it('reads the mark from the newest report version', () => {
    const mainline = resolveMainline(graphWith({ edgeIds: ['e1'], nodeIds: ['t1', 't2'] }));
    expect([...mainline!.nodeIds]).toEqual(['t1', 't2']);
    expect([...mainline!.edgeIds]).toEqual(['e1']);
  });

  it('leaves the map as it was without a report or a mark', () => {
    expect(resolveMainline({ byId: {}, report: undefined } as any)).toBeUndefined();
    expect(resolveMainline(graphWith(undefined))).toBeUndefined();
  });

  it('drops nodes gone from the graph, and does not mute a map whose whole mainline is gone', () => {
    expect([
      ...resolveMainline(graphWith({ edgeIds: [], nodeIds: ['t1', 'gone'] }))!.nodeIds,
    ]).toEqual(['t1']);
    expect(resolveMainline(graphWith({ edgeIds: [], nodeIds: ['gone'] }))).toBeUndefined();
  });

  it('drops a mark that reaches every card, so the map is never all mainline', () => {
    // The wrap-up model marks every node when it cannot tell the path apart;
    // ringing the whole map says nothing, so the plain map is drawn instead.
    const all = graphWith({ edgeIds: [], nodeIds: ['p', 't1', 't2', 't3', 'x1'] }, undefined, {
      p: 'problem',
    });
    expect(resolveMainline(all)).toBeUndefined();
  });

  it('keeps the mark while any card stands off it, the root question aside', () => {
    const root = graphWith({ edgeIds: [], nodeIds: ['t1', 't2', 't3', 'x1'] }, undefined, {
      p: 'problem',
    });
    expect(resolveMainline(root)).toBeUndefined();
    const oneOff = graphWith({ edgeIds: [], nodeIds: ['t1', 't2', 't3'] }, undefined, {
      p: 'problem',
    });
    expect(resolveMainline(oneOff)).toBeDefined();
  });

  it('treats a collapsed experiment as on the mainline when its members are', () => {
    const nodes = [
      { node: { id: 'p', kind: 'problem' } },
      { node: { id: 'e1', kind: 'experiment' } },
      { node: { id: 't1', kind: 'task' } },
    ];
    expect(
      resolveMainline({
        byId: Object.fromEntries(nodes.map((view) => [view.node.id, view])),
        edges: [{ id: 'c1', kind: 'contains', sourceNodeId: 'e1', targetNodeId: 't1' }],
        nodes,
        report: {
          latest: {
            metadata: {
              chapters: [],
              graphCursor: 'e',
              headline: 'H',
              mainline: { edgeIds: [], nodeIds: ['t1'] },
              nextSteps: [],
            },
          },
          status: 'completed',
        },
      } as unknown as Pick<GoalGraphView, 'byId' | 'edges' | 'nodes' | 'report'>),
    ).toBeUndefined();
  });
});

describe('nodeEmphasis', () => {
  const mainline = resolveMainline(graphWith({ edgeIds: ['e1'], nodeIds: ['t1', 't2'] }));

  it('highlights marked nodes and mutes the rest', () => {
    expect(nodeEmphasis(mainline, { id: 't1', kind: 'task' })).toBe('mainline');
    expect(nodeEmphasis(mainline, { id: 't3', kind: 'task' })).toBe('muted');
    expect(nodeEmphasis(mainline, { id: 'f9', kind: 'finding' })).toBe('muted');
  });

  it('keeps the root question readable', () => {
    expect(nodeEmphasis(mainline, { id: 'p', kind: 'problem' })).toBeUndefined();
  });

  it('highlights a collapsed experiment whose members are on the mainline', () => {
    expect(nodeEmphasis(mainline, { id: 'x1', kind: 'experiment' }, ['t2'])).toBe('mainline');
    expect(nodeEmphasis(mainline, { id: 'x1', kind: 'experiment' }, ['t3'])).toBe('muted');
  });

  it('changes nothing when no mainline was marked', () => {
    expect(nodeEmphasis(undefined, { id: 't3', kind: 'task' })).toBeUndefined();
  });
});

describe('edgeEmphasis', () => {
  const mainline = resolveMainline(graphWith({ edgeIds: ['e1'], nodeIds: ['t1', 't2'] }));
  const isCard = (id: string) => mainline!.nodeIds.has(id);

  it('highlights only the marked edges, projected ones included by their goal edge id', () => {
    expect(
      edgeEmphasis(mainline, { id: 'e1', sourceNodeId: 'x1', targetNodeId: 't1' }, isCard),
    ).toBe('mainline');
    // Both ends on the mainline is not enough for a real edge: the report chose which to mark.
    expect(
      edgeEmphasis(mainline, { id: 'e2', sourceNodeId: 't1', targetNodeId: 't2' }, isCard),
    ).toBe('muted');
  });

  it('highlights a bridge through hidden kinds when both of its cards are on the mainline', () => {
    expect(
      edgeEmphasis(
        mainline,
        { bridge: true, id: 'bridge:t1:t2', sourceNodeId: 't1', targetNodeId: 't2' },
        isCard,
      ),
    ).toBe('mainline');
    expect(
      edgeEmphasis(
        mainline,
        { bridge: true, id: 'bridge:t1:t3', sourceNodeId: 't1', targetNodeId: 't3' },
        isCard,
      ),
    ).toBe('muted');
  });

  it('changes nothing when no mainline was marked', () => {
    expect(
      edgeEmphasis(undefined, { id: 'e1', sourceNodeId: 't1', targetNodeId: 't2' }, () => false),
    ).toBeUndefined();
  });
});

describe('isNodeDimmed', () => {
  it('mutes cards off the mainline and blocked cards', () => {
    expect(isNodeDimmed({ blocked: false, emphasis: 'muted', highlighted: false })).toBe(true);
    expect(isNodeDimmed({ blocked: true, emphasis: undefined, highlighted: false })).toBe(true);
    expect(isNodeDimmed({ blocked: false, emphasis: 'mainline', highlighted: false })).toBe(false);
    expect(isNodeDimmed({ blocked: false, emphasis: undefined, highlighted: false })).toBe(false);
  });

  it('keeps a highlighted detour readable even though it is off the mainline', () => {
    // A chapter's local map calls its detours out; the mainline mark must not fade them.
    expect(isNodeDimmed({ blocked: false, emphasis: 'muted', highlighted: true })).toBe(false);
  });
});

describe('off-mainline legibility', () => {
  /**
   * Regression: the dark canvas turned the border token at a third opacity into
   * background, so an off-mainline line and the arrow ending it were barely
   * there. Only the off-mainline tone is lifted; the mainline keeps its own
   * primary line, so the hierarchy is not flattened.
   */
  it('lifts only the off-mainline arrow on the dark canvas', () => {
    expect(edgeMarkerColor('mainline', true)).toBe(cssVar.colorPrimary);
    expect(edgeMarkerColor('detour', true)).toBe(cssVar.colorWarning);
    // Light mode is unchanged — the same border token as before.
    expect(edgeMarkerColor(undefined, false)).toBe(cssVar.colorBorder);
    expect(edgeMarkerColor('muted', false)).toBe(cssVar.colorBorder);
    expect(edgeMarkerColor(undefined, true)).toBe(cssVar.colorTextQuaternary);
    expect(edgeMarkerColor('muted', true)).toBe(cssVar.colorTextQuaternary);
  });

  it('is more legible on the dark canvas while still stepping back', () => {
    expect(MUTED_EDGE_OPACITY_DARK).toBeGreaterThan(MUTED_EDGE_OPACITY);
    expect(MUTED_EDGE_OPACITY_DARK).toBeLessThan(1);
  });
});
