import type { ArtboardItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildBoardModel } from '../model';
import { acceptanceJourneyView } from './acceptanceView';
import { nodeState } from './flow';

const board = buildBoardModel(
  {
    acceptanceId: 'acc_1',
    content: {
      arrows: [{ flowEdgeId: 'edge-k1', from: 'f1', id: 'a1', label: '下一步', to: 'f2' }],
      frames: ['f1', 'f2'].map((id, i) => ({
        check: { expected: `${id} works` },
        flowNodeId: `node-k${i + 1}`,
        groupId: 'g1',
        id,
        source: { canvasId: `cvs_${id}`, kind: 'canvas' as const, version: 1 },
        title: id,
        x: i * 840,
        y: 0,
      })),
      groups: [{ desc: '', id: 'g1', kind: 'journey', title: '旅程' }],
      notes: [],
    },
    id: 'art_1',
    phase: 'finalized',
    revision: 2,
  } as ArtboardItem,
  {},
);

const attempt = (nodeId: string, incomingEdgeId: string | null, verdict: string) => ({
  checkItemId: `${nodeId}:${incomingEdgeId}`,
  checkResultId: null,
  evidence: [],
  id: `${nodeId}:${incomingEdgeId}`,
  incomingEdgeId,
  nodeId,
  observation: null,
  review: null,
  reviewAttachments: [],
  reviewComment: null,
  reviewDetail: null,
  sequence: 1,
  verdict,
});

const version = {
  edges: [
    {
      edgeKey: 'edge-k1',
      id: 'edge_db_1',
      required: true,
      sourceNodeId: 'node_db_1',
      sourceNodeKey: 'node-k1',
      targetNodeId: 'node_db_2',
      targetNodeKey: 'node-k2',
      trigger: '下一步',
    },
  ],
  entryNodeKey: 'node-k1',
  flowId: 'flow_1',
  id: 'ver_1',
  nodes: [
    { id: 'node_db_1', nodeKey: 'node-k1', title: 'f1' },
    { id: 'node_db_2', nodeKey: 'node-k2', title: 'f2' },
  ],
  runs: [
    {
      attempts: [attempt('node_db_1', null, 'passed'), attempt('node_db_2', 'edge_db_1', 'failed')],
      id: 'run_1',
      status: 'verifying',
      verifyRunId: 'vr_1',
    },
  ],
  title: '旅程',
  version: 1,
};

const bundle = {
  flows: [{ versions: [version] }],
  rounds: [{ run: { id: 'vr_1', roundIndex: 1 } }],
} as any;

describe('acceptanceJourneyView', () => {
  const view = acceptanceJourneyView(board, bundle)!;

  it('maps flow nodes and edges back to frames and arrows by their flow ids', () => {
    expect(view.nodeOf('f2')).toBe('node-k2');
    expect(view.frameOf('node-k1')).toBe('f1');
    expect(view.edgeOf('a1')).toBe('edge_db_1');
  });

  it('reads each frame’s verdict from the latest round', () => {
    expect(nodeState(view, 'f1')).toBe('passed');
    expect(nodeState(view, 'f2')).toBe('failed');
  });

  it('finds nothing for a board whose frames are not in the bundle', () => {
    expect(acceptanceJourneyView(board, { flows: [], rounds: [] } as any)).toBeUndefined();
  });
});
