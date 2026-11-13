import { describe, expect, it } from 'vitest';

import {
  type ArtboardBoardView,
  type ArtboardContent,
  artboardOpSchema,
  formatArtboardResultLine,
  parseArtboardResultLine,
} from './artboard';
import { checkFinalizeReadiness } from './artboardReadiness';

const rect = { h: 400, w: 640, x: 0, y: 0 };

const board = (id: string, patch: Partial<ArtboardBoardView> = {}): ArtboardBoardView => ({
  expected: `sees ${id}`,
  flowNodeId: null,
  groupId: 'abg_journey',
  id,
  pageId: 'abp_1',
  rect,
  roundId: null,
  source: { canvasId: 'cvs_1', kind: 'canvas', version: 1 },
  title: id,
  type: 'html',
  ...patch,
});

const edge = (from: string, to: string) => ({
  condition: null,
  flowEdgeId: null,
  from,
  id: `${from}-${to}`,
  isDefault: false,
  label: 'next',
  to,
});

const content = (patch: Partial<ArtboardContent> = {}): ArtboardContent => ({
  boards: [board('b1'), board('b2')],
  edges: [edge('b1', 'b2')],
  groups: [{ desc: '', id: 'abg_journey', kind: 'journey', pageId: 'abp_1', rect, title: 'Flow' }],
  pages: [{ id: 'abp_1', name: 'Page 1', sortOrder: 0 }],
  questions: [],
  rounds: [],
  ...patch,
});

describe('artboardOpSchema', () => {
  it('accepts a board with a canvas source and no version', () => {
    const op = {
      board: { groupId: 'g', source: { canvasId: 'cvs_1', kind: 'canvas' }, title: 'A', x: 0, y: 0 },
      ref: 'a',
      type: 'addBoard',
    };
    expect(artboardOpSchema.parse(op)).toEqual(op);
  });

  it('accepts a decision board without a source', () => {
    const op = { board: { title: 'Paid?', type: 'decision', x: 0, y: 0 }, type: 'addBoard' };
    expect(artboardOpSchema.safeParse(op).success).toBe(true);
  });

  it('rejects the frame and note ops of the JSON board', () => {
    for (const type of ['addFrame', 'addArrow', 'addNote', 'decideQuestion'])
      expect(artboardOpSchema.safeParse({ id: 'x', type }).success).toBe(false);
  });

  it('rejects moving a board to another page through updateBoard', () => {
    const parsed = artboardOpSchema.parse({
      id: 'b1',
      patch: { pageId: 'abp_2', title: 'A' },
      type: 'updateBoard',
    });
    expect(parsed).toEqual({ id: 'b1', patch: { title: 'A' }, type: 'updateBoard' });
  });
});

describe('artboard result line', () => {
  it('round-trips the id and revision', () => {
    const line = formatArtboardResultLine({ boardCount: 3, groupCount: 2, id: 'art_1', revision: 7 });
    expect(parseArtboardResultLine(`ok\n${line}\n`)).toEqual({ artboardId: 'art_1', revision: 7 });
  });
});

describe('checkFinalizeReadiness', () => {
  it('passes a connected journey whose boards all have a check', () => {
    expect(checkFinalizeReadiness(content())).toEqual([]);
  });

  it('reports a journey board without a check, but not a decision board', () => {
    const issues = checkFinalizeReadiness(
      content({
        boards: [
          board('b1'),
          board('d1', { expected: null, source: null, type: 'decision' }),
          board('b2', { expected: ' ' }),
        ],
        edges: [edge('b1', 'd1'), edge('d1', 'b2')],
      }),
    );
    expect(issues).toEqual([{ boardId: 'b2', code: 'missing_check' }]);
  });

  it('reports a board no edge reaches', () => {
    const issues = checkFinalizeReadiness(
      content({ boards: [board('b1'), board('b2'), board('b3')], edges: [edge('b2', 'b3')] }),
    );
    expect(issues).toEqual([{ code: 'entry_count', entryBoardIds: ['b1', 'b2'] }]);
  });

  it('blocks on a round that is still open and on an unresolved agent question', () => {
    const issues = checkFinalizeReadiness(
      content({
        questions: [{ boardId: null, content: 'Skip?', groupId: null, id: 'c1', pageId: 'abp_1' }],
        rounds: [
          {
            batchId: null,
            chosenBoardId: null,
            id: 'r1',
            pageId: 'abp_1',
            recommendedBoardId: null,
            status: 'open',
            title: 'Layout',
          },
        ],
      }),
    );
    expect(issues).toEqual([
      { code: 'open_round', roundId: 'r1' },
      { code: 'open_question', commentId: 'c1' },
    ]);
  });

  it('reports a board with no journey group before anything else', () => {
    expect(checkFinalizeReadiness(content({ groups: [] }))[0]).toEqual({ code: 'no_journey' });
  });
});
