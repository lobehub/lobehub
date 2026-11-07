import type { ArtboardContent, ResolvedArtboardOp } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { applyArtboardOps, applyArtboardUserOps, ArtboardOpError } from '../applyOps';

const canvas = { canvasId: 'cvs_1', kind: 'canvas' as const, version: 1 };

const board = (): ArtboardContent => ({
  arrows: [{ from: 'f1', id: 'a1', label: '下一步', to: 'f2' }],
  frames: [
    { groupId: 'g1', id: 'f1', source: canvas, title: '空项目', x: 0, y: 0 },
    { groupId: 'g1', id: 'f2', source: canvas, title: '接入资料', x: 720, y: 0 },
    { groupId: 'g2', id: 'f3', source: canvas, title: '方案 A', x: 0, y: 600 },
  ],
  groups: [
    { desc: '', id: 'g1', kind: 'journey', title: '用户旅程' },
    { desc: '', id: 'g2', kind: 'options', title: '方案' },
  ],
  notes: [
    {
      id: 'n1',
      kind: 'sticky',
      question: { status: 'open', suggestion: '可以跳过' },
      text: '能跳过吗？',
      x: 0,
      y: 1200,
    },
  ],
});

const agent = (ops: ResolvedArtboardOp[], phase: 'discuss' | 'finalized' = 'discuss') =>
  applyArtboardOps(board(), ops, { phase });

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ArtboardOpError) return error.code;
    throw error;
  }
  return 'ok';
};

describe('applyArtboardOps', () => {
  it('assigns the next short id per kind and reports what changed', () => {
    const result = agent([
      { group: { kind: 'references', title: '参考' }, type: 'addGroup' },
      {
        frame: {
          groupId: 'g2',
          source: { fileId: 'file_1', kind: 'image' },
          title: 'B',
          x: 0,
          y: 0,
        },
        type: 'addFrame',
      },
      { arrow: { from: 'f1', label: '跳过', to: 'f3' }, type: 'addArrow' },
      {
        note: { kind: 'sticky', question: { suggestion: '要' }, text: '?', x: 0, y: 0 },
        type: 'addNote',
      },
    ]);

    expect(result.content.groups.at(-1)).toMatchObject({ desc: '', id: 'g3' });
    expect(result.content.frames.at(-1)?.id).toBe('f4');
    expect(result.content.arrows.at(-1)?.id).toBe('a2');
    expect(result.content.notes.at(-1)).toMatchObject({
      id: 'n2',
      question: { status: 'open', suggestion: '要' },
    });
    expect(result.changedIds).toEqual(['g3', 'f4', 'a2', 'n2']);
  });

  it('lets later ops in a batch address new items by their ref', () => {
    const result = agent([
      { group: { kind: 'options', title: '新方案' }, ref: 'opts', type: 'addGroup' },
      {
        frame: { groupId: 'opts', source: canvas, title: 'C', x: 0, y: 0 },
        ref: 'c',
        type: 'addFrame',
      },
      { arrow: { from: 'f1', label: '看方案 C', to: 'c' }, ref: 'toC', type: 'addArrow' },
      { id: 'c', patch: { recommended: true }, type: 'updateFrame' },
      {
        note: { kind: 'sticky', question: {}, text: '选 C？', x: 0, y: 0 },
        ref: 'q',
        type: 'addNote',
      },
      { decision: '选 C', noteId: 'q', type: 'decideQuestion' },
    ]);

    expect(result.content.frames.at(-1)).toMatchObject({
      groupId: 'g3',
      id: 'f4',
      recommended: true,
    });
    expect(result.content.arrows.at(-1)).toEqual({
      from: 'f1',
      id: 'a2',
      label: '看方案 C',
      to: 'f4',
    });
    expect(result.content.notes.at(-1)?.question).toMatchObject({
      decision: '选 C',
      status: 'decided',
    });
    expect(JSON.stringify(result.content)).not.toContain('"ref"');
  });

  it('rejects a ref used twice in one batch', () => {
    expect(
      codeOf(() =>
        agent([
          { group: { kind: 'other', title: 'A' }, ref: 'x', type: 'addGroup' },
          { group: { kind: 'other', title: 'B' }, ref: 'x', type: 'addGroup' },
        ]),
      ),
    ).toBe('invalid');
  });

  it('allows at most one journey group', () => {
    expect(
      codeOf(() => agent([{ group: { kind: 'journey', title: '又一个' }, type: 'addGroup' }])),
    ).toBe('journey_exists');
    expect(
      codeOf(() => agent([{ id: 'g2', patch: { kind: 'journey' }, type: 'updateGroup' }])),
    ).toBe('journey_exists');
  });

  it('refuses to remove a group that still has frames', () => {
    expect(codeOf(() => agent([{ id: 'g2', type: 'removeGroup' }]))).toBe('group_not_empty');
    const result = agent([
      { id: 'f3', type: 'removeFrame' },
      { id: 'g2', type: 'removeGroup' },
    ]);
    expect(result.content.groups.map((g) => g.id)).toEqual(['g1']);
  });

  it('removes the arrows attached to a removed frame', () => {
    const result = agent([{ id: 'f2', type: 'removeFrame' }]);

    expect(result.content.arrows).toEqual([]);
    expect(result.changedIds).toEqual(['f2', 'a1']);
  });

  it('updates frames, notes and checks', () => {
    const result = agent([
      {
        id: 'f1',
        patch: { source: { ...canvas, version: 2 }, title: '空的项目' },
        type: 'updateFrame',
      },
      { id: 'n1', patch: { question: null, text: '已经不是问题' }, type: 'updateNote' },
      { expected: '看到接入入口', frameId: 'f1', type: 'setCheck' },
      { id: 'a1', type: 'removeArrow' },
    ]);

    expect(result.content.frames[0]).toMatchObject({
      check: { expected: '看到接入入口' },
      source: { version: 2 },
      title: '空的项目',
    });
    expect(result.content.notes[0].question).toBeUndefined();
    expect(result.content.arrows).toEqual([]);
  });

  it('records a decision on an open question', () => {
    const result = agent([{ decision: '可以跳过', noteId: 'n1', type: 'decideQuestion' }]);

    expect(result.content.notes[0].question).toEqual({
      decision: '可以跳过',
      status: 'decided',
      suggestion: '可以跳过',
    });
  });

  it.each([
    ['an unknown frame', { id: 'f9', type: 'removeFrame' }, 'not_found'],
    [
      'an arrow to an unknown frame',
      { arrow: { from: 'f1', label: '', to: 'f9' }, type: 'addArrow' },
      'not_found',
    ],
    ['a self arrow', { arrow: { from: 'f1', label: '', to: 'f1' }, type: 'addArrow' }, 'invalid'],
    [
      'a frame in an unknown group',
      { frame: { groupId: 'g9', source: canvas, title: 'x', x: 0, y: 0 }, type: 'addFrame' },
      'not_found',
    ],
    ['a check outside the journey', { expected: 'x', frameId: 'f3', type: 'setCheck' }, 'invalid'],
    [
      'a question on a title note',
      { note: { kind: 'title', question: {}, text: 'T', x: 0, y: 0 }, type: 'addNote' },
      'invalid',
    ],
    [
      'deciding a note without a question',
      { decision: 'x', noteId: 'n9', type: 'decideQuestion' },
      'not_found',
    ],
  ] as [string, ResolvedArtboardOp, string][])('rejects %s', (_name, op, code) => {
    expect(codeOf(() => agent([op]))).toBe(code);
  });

  it('writes nothing when one op in the batch fails', () => {
    const before = board();
    expect(() =>
      applyArtboardOps(
        before,
        [
          { id: 'f1', patch: { title: '改了' }, type: 'updateFrame' },
          { id: 'f9', type: 'removeFrame' },
        ],
        { phase: 'discuss' },
      ),
    ).toThrow(ArtboardOpError);
    expect(before).toEqual(board());
  });

  describe('after finalize', () => {
    it.each([
      ['a journey frame', { id: 'f1', patch: { title: 'x' }, type: 'updateFrame' }],
      ['removing a journey frame', { id: 'f2', type: 'removeFrame' }],
      [
        'adding a journey frame',
        { frame: { groupId: 'g1', source: canvas, title: 'x', x: 0, y: 0 }, type: 'addFrame' },
      ],
      ['a journey arrow', { id: 'a1', type: 'removeArrow' }],
      ['a new journey arrow', { arrow: { from: 'f2', label: '', to: 'f1' }, type: 'addArrow' }],
      ['a journey check', { expected: 'x', frameId: 'f1', type: 'setCheck' }],
      [
        'moving a frame into the journey',
        { id: 'f3', patch: { groupId: 'g1' }, type: 'updateFrame' },
      ],
    ] as [string, ResolvedArtboardOp][])('locks %s', (_name, op) => {
      expect(codeOf(() => agent([op], 'finalized'))).toBe('locked');
    });

    it('still lets other groups, notes and journey positions change', () => {
      const result = agent(
        [
          { id: 'f3', patch: { title: '方案 B' }, type: 'updateFrame' },
          { id: 'f1', patch: { x: 40, y: 40 }, type: 'updateFrame' },
          { id: 'n1', patch: { text: '改便签' }, type: 'updateNote' },
        ],
        'finalized',
      );
      expect(result.content.frames[2].title).toBe('方案 B');
      expect(result.content.frames[0]).toMatchObject({ x: 40, y: 40 });
    });
  });
});

describe('applyArtboardUserOps', () => {
  it('moves frames and notes, decides questions and edits note text', () => {
    const result = applyArtboardUserOps(
      board(),
      [
        { id: 'f1', type: 'moveItem', x: 10, y: 20 },
        { id: 'n1', type: 'moveItem', x: 5, y: 5 },
        { decision: '不能跳过', noteId: 'n1', type: 'decideQuestion' },
        { id: 'n1', text: '新文字', type: 'updateNoteText' },
      ],
      { phase: 'finalized' },
    );

    expect(result.content.frames[0]).toMatchObject({ x: 10, y: 20 });
    expect(result.content.notes[0]).toMatchObject({
      question: { decision: '不能跳过', status: 'decided' },
      text: '新文字',
      x: 5,
    });
    expect(result.changedIds).toEqual(['f1', 'n1']);
  });

  it('rejects moving something that is not on the board', () => {
    expect(
      codeOf(() =>
        applyArtboardUserOps(board(), [{ id: 'a1', type: 'moveItem', x: 0, y: 0 }], {
          phase: 'discuss',
        }),
      ),
    ).toBe('not_found');
  });
});
