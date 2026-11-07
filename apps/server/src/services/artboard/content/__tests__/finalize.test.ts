import type { ArtboardContent } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { validateFlow } from '@/database/models/acceptanceFlow';

import { buildJourneyFlow, checkFinalizeReadiness } from '../finalize';

const canvas = { canvasId: 'cvs_1', kind: 'canvas' as const, version: 1 };
const frame = (id: string, groupId = 'g1', expected: string | null = `${id} 的期望`) => ({
  ...(expected === null ? {} : { check: { expected } }),
  groupId,
  id,
  source: canvas,
  title: `画面 ${id}`,
  x: 0,
  y: 0,
});

const ready = (): ArtboardContent => ({
  arrows: [
    { from: 'f1', id: 'a1', label: '点接入', to: 'f2' },
    { from: 'f2', id: 'a2', label: '全部读完', to: 'f3' },
    { from: 'f2', id: 'a3', label: '有资料读不了', to: 'f4' },
    { from: 'f1', id: 'a4', label: '看方案', to: 'f5' },
  ],
  frames: [frame('f1'), frame('f2'), frame('f3'), frame('f4'), frame('f5', 'g2', null)],
  groups: [
    { desc: '', id: 'g1', kind: 'journey', title: '用户旅程' },
    { desc: '', id: 'g2', kind: 'options', title: '方案' },
  ],
  notes: [
    {
      id: 'n1',
      kind: 'sticky',
      question: { decision: '能跳过', status: 'decided' },
      text: '?',
      x: 0,
      y: 0,
    },
  ],
});

const codes = (content: ArtboardContent) => checkFinalizeReadiness(content).map((i) => i.code);

describe('checkFinalizeReadiness', () => {
  it('passes a ready board', () => {
    expect(checkFinalizeReadiness(ready())).toEqual([]);
  });

  it('needs a journey group with at least one frame', () => {
    const none = { ...ready(), arrows: [], frames: [], groups: [] };
    expect(codes(none)).toEqual(['no_journey']);

    const empty = { ...ready(), arrows: [], frames: [frame('f5', 'g2')] };
    expect(codes(empty)).toEqual(['empty_journey']);
  });

  it('needs an acceptance check on every journey frame', () => {
    const board = ready();
    board.frames[1] = frame('f2', 'g1', null);
    expect(checkFinalizeReadiness(board)).toEqual([{ code: 'missing_check', frameId: 'f2' }]);
  });

  it('needs every question decided', () => {
    const board = ready();
    board.notes[0].question = { status: 'open' };
    expect(checkFinalizeReadiness(board)).toEqual([{ code: 'open_question', noteId: 'n1' }]);
  });

  it('needs exactly one entry and every frame reachable from it', () => {
    const twoEntries = ready();
    twoEntries.arrows = twoEntries.arrows.filter((a) => a.id !== 'a1');
    expect(codes(twoEntries)).toEqual(['entry_count']);

    const cycle = ready();
    cycle.arrows.push({ from: 'f2', id: 'a5', label: '返回', to: 'f1' });
    expect(codes(cycle)).toEqual(['entry_count']);
  });
});

describe('buildJourneyFlow', () => {
  let counter = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

  it('turns journey frames into check nodes and journey arrows into required edges', () => {
    counter = 0;
    const { definition, frameNodeIds, arrowEdgeIds } = buildJourneyFlow(ready(), newId);

    expect(definition.title).toBe('用户旅程');
    expect(definition.nodes).toHaveLength(4);
    expect(definition.edges).toHaveLength(3);
    expect(definition.entryNodeId).toBe(frameNodeIds.f1);
    expect(Object.keys(frameNodeIds)).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(Object.keys(arrowEdgeIds)).toEqual(['a1', 'a2', 'a3']);

    const node = definition.nodes.find((n) => n.id === frameNodeIds.f2)!;
    expect(node.check).toMatchObject({
      definition: { expected: 'f2 的期望' },
      title: '画面 f2',
    });
    expect(definition.edges.find((e) => e.id === arrowEdgeIds.a3)).toEqual({
      id: arrowEdgeIds.a3,
      required: true,
      sourceNodeId: frameNodeIds.f2,
      targetNodeId: frameNodeIds.f4,
      trigger: '有资料读不了',
    });
    expect(() => validateFlow(definition)).not.toThrow();
  });
});
