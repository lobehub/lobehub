import { describe, expect, it } from 'vitest';

import { draftJourneyView, nodeState } from './flow';
import { testBoard, testEdge, testModel } from './testBoard';

const board = testModel({
  boards: [testBoard('b1'), testBoard('b2'), testBoard('b3'), testBoard('o1', { groupId: 'g2' })],
  edges: [
    testEdge('e1', 'b1', 'b2', { label: '下一步' }),
    testEdge('e2', 'b1', 'b3', { label: '失败' }),
    testEdge('e3', 'b3', 'b2', { label: '重试' }),
    testEdge('e4', 'b1', 'o1', { label: '看方案' }),
  ],
});

describe('draftJourneyView', () => {
  const view = draftJourneyView(board)!;

  it('turns the journey into flow nodes keyed by board, with only its own edges', () => {
    expect(view.version.entryNodeKey).toBe('b1');
    expect(view.version.nodes.map((n) => n.nodeKey)).toEqual(['b1', 'b2', 'b3']);
    expect(view.version.edges.map((e) => [e.sourceNodeKey, e.targetNodeKey, e.trigger])).toEqual([
      ['b1', 'b2', '下一步'],
      ['b1', 'b3', '失败'],
      ['b3', 'b2', '重试'],
    ]);
  });

  it('plans one check item for the entry and one per incoming path', () => {
    expect(
      Object.fromEntries(view.version.nodes.map((n) => [n.nodeKey, n.checkItemIds.length])),
    ).toEqual({ b1: 1, b2: 2, b3: 1 });
  });

  it('leaves every board pending before any acceptance run', () => {
    expect(['b1', 'b2', 'b3', 'o1'].map((id) => nodeState(view, id))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(view.nodeOf('o1')).toBeUndefined();
  });

  it('folds a decision board into one edge per branch', () => {
    const branched = draftJourneyView(
      testModel({
        boards: [
          testBoard('b1'),
          testBoard('d1', { expected: null, source: null, type: 'decision' }),
          testBoard('b2'),
          testBoard('b3'),
        ],
        edges: [
          testEdge('e1', 'b1', 'd1', { label: '提交' }),
          testEdge('e2', 'd1', 'b2', { condition: '已付费' }),
          testEdge('e3', 'd1', 'b3', { isDefault: true, label: '否则' }),
        ],
      }),
    )!;

    expect(branched.version.nodes.map((n) => n.nodeKey)).toEqual(['b1', 'b2', 'b3']);
    expect(
      branched.version.edges.map((e) => [e.sourceNodeKey, e.targetNodeKey, e.trigger, e.condition]),
    ).toEqual([
      ['b1', 'b2', '提交', '已付费'],
      ['b1', 'b3', '提交', '否则'],
    ]);
  });
});
