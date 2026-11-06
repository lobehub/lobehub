import { describe, expect, it } from 'vitest';

import {
  artboardContentSchema,
  artboardOpSchema,
  artboardUserOpSchema,
  formatArtboardResultLine,
  parseArtboardResultLine,
} from './artboard';

const content = {
  arrows: [{ from: 'f1', id: 'a1', label: '点「接入资料」', to: 'f2' }],
  frames: [
    {
      check: { expected: '看到接入入口' },
      groupId: 'g1',
      id: 'f1',
      source: { canvasId: 'cvs_1', kind: 'canvas', version: 3 },
      title: '空项目',
      x: 0,
      y: 0,
    },
    {
      groupId: 'g1',
      id: 'f2',
      source: { fileId: 'file_1', kind: 'image' },
      title: '接入资料',
      x: 720,
      y: 0,
    },
  ],
  groups: [{ desc: '', id: 'g1', kind: 'journey', title: '用户旅程' }],
  notes: [
    {
      id: 'n1',
      kind: 'sticky',
      question: { status: 'open', suggestion: '可以跳过' },
      text: '接入资料这一步能不能跳过？',
      x: 0,
      y: 480,
    },
  ],
};

describe('artboardContentSchema', () => {
  it('accepts a complete board document', () => {
    expect(artboardContentSchema.parse(content)).toEqual(content);
  });

  it('rejects a question on a note that is not a sticky', () => {
    const titled = {
      ...content,
      notes: [{ ...content.notes[0], kind: 'title' }],
    };
    expect(artboardContentSchema.safeParse(titled).success).toBe(false);
  });

  it('rejects an unknown frame source kind', () => {
    const bad = {
      ...content,
      frames: [{ ...content.frames[0], source: { kind: 'video', url: 'x' } }],
    };
    expect(artboardContentSchema.safeParse(bad).success).toBe(false);
  });
});

describe('artboardOpSchema', () => {
  const ops = [
    { group: { kind: 'options', title: '方案' }, type: 'addGroup' },
    { id: 'g1', patch: { title: '旅程' }, type: 'updateGroup' },
    { id: 'g1', type: 'removeGroup' },
    {
      frame: {
        groupId: 'g1',
        source: { canvasId: 'cvs_1', kind: 'canvas' },
        title: 'A',
        x: 0,
        y: 0,
      },
      type: 'addFrame',
    },
    {
      frame: { groupId: 'g1', source: { fileRef: 'img_1', kind: 'image' }, title: 'B', x: 0, y: 0 },
      type: 'addFrame',
    },
    {
      id: 'f1',
      patch: { source: { canvasId: 'cvs_1', kind: 'canvas', version: 4 } },
      type: 'updateFrame',
    },
    { id: 'f1', type: 'removeFrame' },
    { arrow: { from: 'f1', label: '下一步', to: 'f2' }, type: 'addArrow' },
    { id: 'a1', type: 'removeArrow' },
    {
      note: { kind: 'sticky', question: { suggestion: '跳过' }, text: '?', x: 0, y: 0 },
      type: 'addNote',
    },
    { id: 'n1', patch: { text: 'x' }, type: 'updateNote' },
    { id: 'n1', type: 'removeNote' },
    { expected: '看到入口', frameId: 'f1', type: 'setCheck' },
    { decision: '可以跳过', noteId: 'n1', type: 'decideQuestion' },
  ];

  it.each(ops)('accepts $type', (op) => {
    expect(artboardOpSchema.safeParse(op).success).toBe(true);
  });

  it('rejects an unknown op', () => {
    expect(artboardOpSchema.safeParse({ id: 'f1', type: 'paint' }).success).toBe(false);
  });
});

describe('artboardUserOpSchema', () => {
  it.each([
    { id: 'f1', type: 'moveItem', x: 10, y: 20 },
    { decision: '可以跳过', noteId: 'n1', type: 'decideQuestion' },
    { id: 'n1', text: '新文字', type: 'updateNoteText' },
  ])('accepts $type', (op) => {
    expect(artboardUserOpSchema.safeParse(op).success).toBe(true);
  });

  it('rejects content ops from a user', () => {
    expect(artboardUserOpSchema.safeParse({ id: 'f1', type: 'removeFrame' }).success).toBe(false);
  });
});

describe('artboard result line', () => {
  it('round-trips the board id and revision through the CLI line', () => {
    const line = formatArtboardResultLine({
      frameCount: 10,
      groupCount: 3,
      id: 'art_8f2k',
      revision: 2,
    });
    expect(line).toBe('artboard art_8f2k · revision 2 · 3 groups · 10 frames');
    expect(parseArtboardResultLine(`some log\n${line}\n`)).toEqual({
      artboardId: 'art_8f2k',
      revision: 2,
    });
    expect(parseArtboardResultLine('artboard list is empty')).toBeUndefined();
  });
});
