import type { ArtboardPublishSnapshot } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { snapshotToBoard } from './snapshot';

const rect = { h: 400, w: 640, x: 0, y: 0 };

const snapshot: ArtboardPublishSnapshot = {
  boards: [
    {
      groupId: null,
      id: 'brd_canvas',
      pageId: 'pg_1',
      rect,
      roundId: 'rnd_1',
      source: { kind: 'canvas', src: 'canvases/cvs_a/v3/index.html' },
      title: 'Option A',
      type: 'html',
    },
    {
      groupId: null,
      id: 'brd_image',
      pageId: 'pg_1',
      rect,
      roundId: null,
      source: { kind: 'image', src: 'images/file_1' },
      title: 'Reference',
      type: 'image',
    },
    {
      groupId: null,
      id: 'brd_decision',
      pageId: 'pg_1',
      rect,
      roundId: null,
      source: null,
      title: 'Pick',
      type: 'decision',
    },
  ],
  description: 'Directions',
  edges: [
    { condition: null, from: 'brd_canvas', id: 'e1', isDefault: false, label: '', to: 'brd_image' },
  ],
  groups: [],
  pages: [{ id: 'pg_1', name: 'Page 1', sortOrder: 0 }],
  publishedAt: '2026-11-17T00:00:00.000Z',
  rounds: [
    {
      chosenBoardId: 'brd_canvas',
      id: 'rnd_1',
      pageId: 'pg_1',
      recommendedBoardId: 'brd_canvas',
      status: 'submitted',
      title: 'Direction',
    },
  ],
  title: 'Onboarding',
  version: 1,
};

describe('snapshotToBoard', () => {
  it('rebuilds a read-only artboard the shared board view can render', () => {
    const { artboard } = snapshotToBoard(snapshot);

    expect(artboard).toMatchObject({
      acceptanceId: null,
      description: 'Directions',
      phase: 'discuss',
      title: 'Onboarding',
    });
    expect(artboard.content.questions).toEqual([]);
    expect(artboard.content.rounds[0]).toMatchObject({
      batchId: null,
      chosenBoardId: 'brd_canvas',
    });
    expect(artboard.content.edges[0]).toMatchObject({ flowEdgeId: null, from: 'brd_canvas' });
    expect(artboard.content.boards.map((board) => board.expected)).toEqual([null, null, null]);
  });

  it('keys image and canvas sources by board so the view can find the site file', () => {
    const { artboard, canvasSrc, imageUrls } = snapshotToBoard(snapshot);
    const sources = Object.fromEntries(
      artboard.content.boards.map((board) => [board.id, board.source]),
    );

    expect(sources).toEqual({
      brd_canvas: { canvasId: 'brd_canvas', kind: 'canvas', version: 1 },
      brd_decision: null,
      brd_image: { fileId: 'brd_image', kind: 'image' },
    });
    expect(imageUrls).toEqual({ brd_image: 'images/file_1' });
    expect(canvasSrc).toEqual({ brd_canvas: 'canvases/cvs_a/v3/index.html' });
  });
});
