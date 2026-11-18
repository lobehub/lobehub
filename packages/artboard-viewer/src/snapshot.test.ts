import type { ArtboardPublishSnapshot } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { snapshotToBoard } from './snapshot';

const rect = { h: 400, w: 640, x: 0, y: 0 };

const snapshot: ArtboardPublishSnapshot = {
  boards: [
    {
      groupId: null,
      id: 'brd_html',
      pageId: 'pg_1',
      rect,
      roundId: 'rnd_1',
      source: { hash: 'abcdef0123456789', kind: 'file', path: 'pages/home page.html' },
      title: 'Option A',
      type: 'html',
    },
    {
      groupId: null,
      id: 'brd_image',
      pageId: 'pg_1',
      rect,
      roundId: null,
      source: { hash: 'fedcba9876543210', kind: 'file', path: 'shots/home.png' },
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
    { condition: null, from: 'brd_html', id: 'e1', isDefault: false, label: '', to: 'brd_image' },
  ],
  groups: [],
  pages: [{ id: 'pg_1', name: 'Page 1', sortOrder: 0 }],
  publishedAt: '2026-11-17T00:00:00.000Z',
  rounds: [
    {
      chosenBoardId: 'brd_html',
      id: 'rnd_1',
      pageId: 'pg_1',
      recommendedBoardId: 'brd_html',
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
      chosenBoardId: 'brd_html',
    });
    expect(artboard.content.edges[0]).toMatchObject({ flowEdgeId: null, from: 'brd_html' });
    expect(artboard.content.boards.map((board) => board.expected)).toEqual([null, null, null]);
  });

  it('keeps each board on its artboard file, served from the site files directory', () => {
    const { artboard, fileBaseUrl } = snapshotToBoard(snapshot);
    const sources = Object.fromEntries(
      artboard.content.boards.map((board) => [board.id, board.source]),
    );

    expect(fileBaseUrl).toBe('files/');
    expect(sources).toEqual({
      brd_decision: null,
      brd_html: { hash: 'abcdef0123456789', kind: 'file', path: 'pages/home page.html' },
      brd_image: { hash: 'fedcba9876543210', kind: 'file', path: 'shots/home.png' },
    });
  });
});
