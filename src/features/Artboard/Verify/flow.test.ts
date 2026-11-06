import type { ArtboardItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildBoardModel } from '../model';
import { draftJourneyView, nodeState } from './flow';

const frame = (id: string, x: number, groupId = 'g1') => ({
  check: { expected: `${id} works` },
  groupId,
  id,
  source: { canvasId: `cvs_${id}`, kind: 'canvas' as const, version: 1 },
  title: id,
  x,
  y: 0,
});

const board = buildBoardModel(
  {
    content: {
      arrows: [
        { from: 'f1', id: 'a1', label: '下一步', to: 'f2' },
        { from: 'f1', id: 'a2', label: '失败', to: 'f3' },
        { from: 'f3', id: 'a3', label: '重试', to: 'f2' },
        { from: 'f1', id: 'a4', label: '看方案', to: 'o1' },
      ],
      frames: [frame('f1', 0), frame('f2', 840), frame('f3', 1680), frame('o1', 0, 'g2')],
      groups: [
        { desc: '', id: 'g1', kind: 'journey', title: '旅程' },
        { desc: '', id: 'g2', kind: 'options', title: '方案' },
      ],
      notes: [],
    },
    id: 'art_1',
    phase: 'discuss',
    revision: 1,
  } as ArtboardItem,
  {},
);

describe('draftJourneyView', () => {
  const view = draftJourneyView(board)!;

  it('turns the journey into flow nodes keyed by frame, with only its own arrows', () => {
    expect(view.version.entryNodeKey).toBe('f1');
    expect(view.version.nodes.map((n) => n.nodeKey)).toEqual(['f1', 'f2', 'f3']);
    expect(view.version.edges.map((e) => [e.sourceNodeKey, e.targetNodeKey, e.trigger])).toEqual([
      ['f1', 'f2', '下一步'],
      ['f1', 'f3', '失败'],
      ['f3', 'f2', '重试'],
    ]);
  });

  it('plans one check item for the entry and one per incoming path', () => {
    expect(
      Object.fromEntries(view.version.nodes.map((n) => [n.nodeKey, n.checkItemIds.length])),
    ).toEqual({ f1: 1, f2: 2, f3: 1 });
  });

  it('leaves every frame pending before any acceptance run', () => {
    expect(['f1', 'f2', 'f3', 'o1'].map((id) => nodeState(view, id))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(view.nodeOf('o1')).toBeUndefined();
  });
});
