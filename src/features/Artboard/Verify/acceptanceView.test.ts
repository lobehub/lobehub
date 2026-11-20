import { describe, expect, it } from 'vitest';

import { acceptanceJourneyView } from './acceptanceView';
import { isFlagged, nodeScreenshot, nodeState } from './flow';
import { testBoard, testEdge, testModel } from './testBoard';

const board = testModel(
  {
    boards: ['b1', 'b2'].map((id, i) => testBoard(id, { flowNodeId: `node-k${i + 1}` })),
    edges: [testEdge('e1', 'b1', 'b2', { flowEdgeId: 'edge-k1', label: '下一步' })],
  },
  { acceptanceId: 'acc_1', phase: 'finalized', revision: 2 },
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
    { id: 'node_db_1', nodeKey: 'node-k1', title: 'b1' },
    { id: 'node_db_2', nodeKey: 'node-k2', title: 'b2' },
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

  it('maps flow nodes back to boards by their flow ids', () => {
    expect(view.nodeOf('b2')).toBe('node-k2');
    expect(view.boardOf('node-k1')).toBe('b1');
  });

  it('reads each board’s verdict from the latest round', () => {
    expect(nodeState(view, 'b1')).toBe('passed');
    expect(nodeState(view, 'b2')).toBe('failed');
  });

  it('finds nothing for a board whose boards are not in the bundle', () => {
    expect(acceptanceJourneyView(board, { flows: [], rounds: [] } as any)).toBeUndefined();
  });

  it('picks the screenshot evidence of the journey board', () => {
    const withEvidence = structuredClone(bundle);
    withEvidence.flows[0].versions[0].runs[0].attempts[0].evidence = [
      { fileUrl: 'https://evidence.test/log.txt', type: 'log' },
      { fileUrl: 'https://evidence.test/b1.png', type: 'screenshot' },
    ];
    const journey = acceptanceJourneyView(board, withEvidence);

    expect(nodeScreenshot(journey, 'b1')).toBe('https://evidence.test/b1.png');
  });

  it('has no screenshot for a board without evidence instead of borrowing another board', () => {
    expect(nodeScreenshot(view, 'b2')).toBeUndefined();
    expect(nodeScreenshot(undefined, 'b1')).toBeUndefined();
  });

  it('flags only results that need a person', () => {
    expect(isFlagged('passed')).toBe(false);
    expect(isFlagged(undefined)).toBe(false);
    expect(isFlagged('failed')).toBe(true);
    expect(isFlagged('blocked')).toBe(true);
  });
});
