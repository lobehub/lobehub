import type { ArtboardContent, ArtboardItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildBoardModel, computeArrowPath } from './model';

const at = (x: number, y: number) => ({ x, y });

describe('computeArrowPath', () => {
  it('leaves the right edge and enters the left edge when the target is to the right', () => {
    expect(computeArrowPath(at(0, 0), at(840, 0))).toEqual({
      d: 'M640 200 H740 V200 H840',
      lx: 740,
      ly: 200,
    });
  });

  it('bends at the gap midpoint when the target sits lower to the right', () => {
    expect(computeArrowPath(at(0, 0), at(840, 600))).toEqual({
      d: 'M640 200 H740 V800 H840',
      lx: 740,
      ly: 500,
    });
  });

  it('runs right to left when the target is to the left', () => {
    expect(computeArrowPath(at(1680, 0), at(840, 0))).toEqual({
      d: 'M1680 200 H1580 V200 H1480',
      lx: 1580,
      ly: 200,
    });
  });

  it('goes vertical when the frames overlap horizontally', () => {
    expect(computeArrowPath(at(0, 0), at(100, 600))).toEqual({
      d: 'M320 400 V500 H420 V600',
      lx: 370,
      ly: 500,
    });
    expect(computeArrowPath(at(0, 600), at(0, 0))).toEqual({
      d: 'M320 600 V500 H320 V400',
      lx: 320,
      ly: 500,
    });
  });
});

const content: ArtboardContent = {
  arrows: [
    { from: 'f1', id: 'a1', label: '开始', to: 'f2' },
    { from: 'f1', id: 'a2', label: '丢了', to: 'gone' },
  ],
  frames: [
    {
      check: { expected: '能看到入口' },
      groupId: 'g2',
      id: 'f1',
      source: { canvasId: 'cvs_1', kind: 'canvas', version: 2 },
      title: '空项目',
      x: 0,
      y: 0,
    },
    {
      groupId: 'g2',
      id: 'f2',
      source: { fileId: 'file_1', kind: 'image' },
      title: '接入资料',
      x: 840,
      y: 0,
    },
    {
      groupId: 'g1',
      id: 'f3',
      source: { canvasId: 'cvs_2', kind: 'canvas', version: 1 },
      title: '方案 A',
      x: 0,
      y: 1000,
    },
  ],
  groups: [
    { desc: '', id: 'g1', kind: 'options', title: '方案' },
    { desc: '', id: 'g2', kind: 'journey', title: '旅程' },
    { desc: '', id: 'g3', kind: 'references', title: '参考' },
  ],
  notes: [
    { id: 'n1', kind: 'title', text: '首次进入', x: 0, y: -300 },
    { id: 'n2', kind: 'sticky', question: { status: 'open' }, text: '要保留吗？', x: 0, y: 1600 },
    {
      id: 'n3',
      kind: 'sticky',
      question: { decision: '保留', status: 'decided' },
      text: '要提示吗？',
      x: 400,
      y: 1600,
    },
  ],
};

const item = {
  acceptanceId: null,
  content,
  id: 'art_1',
  phase: 'discuss',
  revision: 3,
  taskId: 'task_1',
  title: '首次进入',
} as ArtboardItem;

describe('buildBoardModel', () => {
  const model = buildBoardModel(item, { file_1: 'https://cdn/1.png' });

  it('finds the single journey, its frames, arrows and entry', () => {
    expect(model.journeyGroupId).toBe('g2');
    expect(model.journeyFrames.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(model.journeyArrows.map((a) => a.id)).toEqual(['a1']);
    expect(model.journeyEntryId).toBe('f1');
  });

  it('has no journey when the board holds two', () => {
    const twice = buildBoardModel(
      {
        ...item,
        content: {
          ...content,
          groups: [...content.groups, { desc: '', id: 'g4', kind: 'journey', title: '另一条' }],
        },
      },
      {},
    );
    expect(twice.journeyGroupId).toBeUndefined();
    expect(twice.journeyFrames).toEqual([]);
  });

  it('wraps each group around its frames and skips empty groups', () => {
    expect(model.groupRects.g2).toEqual({ h: 512, w: 1576, x: -48, y: -64 });
    expect(model.groupRects.g3).toBeUndefined();
  });

  it('drops arrows whose ends are gone and lays out the rest', () => {
    expect(model.arrows).toEqual([
      {
        d: 'M640 200 H740 V200 H840',
        from: 'f1',
        id: 'a1',
        label: '开始',
        lx: 740,
        ly: 200,
        to: 'f2',
      },
    ]);
  });

  it('counts only open questions as pending', () => {
    expect(model.questions.map((n) => n.id)).toEqual(['n2', 'n3']);
    expect(model.openQuestions.map((n) => n.id)).toEqual(['n2']);
  });

  it('bounds every frame, note and group', () => {
    expect(model.bounds).toEqual({ maxX: 1528, maxY: 1712, minX: -48, minY: -300 });
  });
});
