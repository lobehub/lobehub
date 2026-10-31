import type {
  AcceptanceCommentThread,
  AcceptanceFrame,
  AcceptanceFrameBoard,
} from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  canvasRefLabel,
  layoutFrameTransitions,
  parseCriteriaLines,
  shownVersionOf,
  summarizeFrameBoard,
  threadsForFrameTarget,
} from './frameBoard';

const version = (id: string, page?: string) => ({
  canvasId: 'cvs',
  canvasVersion: 2,
  createdAt: '',
  id,
  label: id,
  ...(page ? { page } : {}),
  source: 'mock' as const,
});

const frame = (id: string, extra: Partial<AcceptanceFrame> = {}): AcceptanceFrame => ({
  captures: [],
  criteria: { copy: [], edgeCases: [], states: [] },
  id,
  key: id,
  title: id,
  versions: [version(`${id}-v1`)],
  ...extra,
});

const baseline = {
  criteria: { copy: ['c'], edgeCases: ['e'], states: ['s'] },
  lockedAt: '',
  lockedBy: null,
  versionId: 'v',
};

const board = (frames: AcceptanceFrame[], transitions: AcceptanceFrameBoard['transitions'] = []) =>
  ({ frames, title: 'Board', transitions, updatedAt: '', version: 1 }) as AcceptanceFrameBoard;

describe('summarizeFrameBoard', () => {
  it('counts review and delivery separately — locked prototypes are not delivery passes', () => {
    const capture = {
      addedBy: null,
      capturedAt: '',
      fileId: 'r',
      id: 'cap',
      source: 'real' as const,
    };
    const summary = summarizeFrameBoard(
      board([
        frame('a'),
        frame('b', { baseline }),
        frame('c', { baseline, captures: [capture] }),
        frame('d', {
          baseline,
          captures: [capture],
          realReview: { captureId: 'cap', reviewedAt: '', reviewedBy: null, verdict: 'matches' },
        }),
        frame('e', {
          baseline,
          captures: [capture],
          realReview: { captureId: 'cap', reviewedAt: '', reviewedBy: null, verdict: 'deviates' },
        }),
      ]),
    );
    expect(summary).toEqual({ baselined: 4, deviates: 1, matches: 1, total: 5 });
  });
});

describe('layoutFrameTransitions', () => {
  it('draws arrows only between neighbours and lists the rest', () => {
    const transitions = [
      { fromFrameId: 'a', id: 't1', toFrameId: 'b', trigger: 'next' },
      { fromFrameId: 'b', id: 't2', toFrameId: 'c', trigger: 'skip' },
      { fromFrameId: 'b', id: 't3', toFrameId: 'c', trigger: 'done' },
      { fromFrameId: 'c', id: 't4', toFrameId: 'a', trigger: 'reset' },
    ];
    const { between, others } = layoutFrameTransitions(
      board([frame('a'), frame('b'), frame('c')], transitions),
    );
    expect(between.map((list) => list.map((item) => item.trigger))).toEqual([
      ['next'],
      ['skip', 'done'],
    ]);
    expect(others.map((item) => item.id)).toEqual(['t4']);
  });
});

describe('threadsForFrameTarget', () => {
  it('keeps only roots pinned on the given version or capture of the frame', () => {
    const thread = (id: string, anchor: object | null, anchorType = 'frame') =>
      ({
        replies: [],
        root: { anchorType, frame: anchor, id },
      }) as unknown as AcceptanceCommentThread;
    const threads = [
      thread('1', { frameId: 'a', versionId: 'a-v1', x: 0, y: 0 }),
      thread('2', { captureId: 'cap', frameId: 'a', x: 0, y: 0 }),
      thread('3', { frameId: 'b', versionId: 'a-v1', x: 0, y: 0 }),
      thread('4', null, 'acceptance'),
    ];
    expect(
      threadsForFrameTarget(threads, 'a', { versionId: 'a-v1' }).map((t) => t.root.id),
    ).toEqual(['1']);
    expect(threadsForFrameTarget(threads, 'a', { captureId: 'cap' }).map((t) => t.root.id)).toEqual(
      ['2'],
    );
  });
});

describe('parseCriteriaLines', () => {
  it('splits one point per line and drops blanks', () => {
    expect(parseCriteriaLines(' locked \n\n current\n')).toEqual(['locked', 'current']);
  });
});

describe('shownVersionOf', () => {
  const versions = [version('a'), version('b'), version('c')];

  it('opens on the first reference before anything is chosen', () => {
    expect(shownVersionOf(frame('f', { versions }))?.id).toBe('a');
  });

  it('prefers the previewed version over the current choice', () => {
    const chosen = frame('f', { selectedVersionId: 'b', versions });
    expect(shownVersionOf(chosen)?.id).toBe('b');
    expect(shownVersionOf(chosen, 'c')?.id).toBe('c');
  });

  it('pins to the locked baseline whatever is previewed', () => {
    const locked = frame('f', { baseline: { ...baseline, versionId: 'b' }, versions });
    expect(shownVersionOf(locked, 'c')?.id).toBe('b');
  });
});

describe('canvasRefLabel', () => {
  it('names the pinned Canvas version and, when set, the page', () => {
    expect(canvasRefLabel(version('a'))).toBe('Canvas v2');
    expect(canvasRefLabel(version('a', 'members.html'))).toBe('Canvas v2 · members.html');
  });
});
