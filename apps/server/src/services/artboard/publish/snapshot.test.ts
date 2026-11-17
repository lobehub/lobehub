// @vitest-environment node
import type { ArtboardItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildArtboardPublishSnapshot, hashArtboardSnapshot } from './snapshot';

const rect = { h: 400, w: 640, x: 0, y: 0 };

const item = (overrides: Partial<ArtboardItem['content']> = {}): ArtboardItem => ({
  acceptanceId: 'acc_1',
  content: {
    boards: [
      {
        expected: 'shows the empty state',
        flowNodeId: 'node_1',
        groupId: 'grp_options',
        id: 'brd_a',
        pageId: 'pg_1',
        rect,
        roundId: 'rnd_open',
        source: { canvasId: 'cvs_a', kind: 'canvas', path: 'detail.html', version: 3 },
        title: 'Option A',
        type: 'html',
      },
      {
        expected: null,
        flowNodeId: null,
        groupId: 'grp_options',
        id: 'brd_b',
        pageId: 'pg_1',
        rect,
        roundId: 'rnd_done',
        source: { canvasId: 'cvs_b', kind: 'canvas', version: 1 },
        title: 'Option B',
        type: 'html',
      },
      {
        expected: null,
        flowNodeId: null,
        groupId: null,
        id: 'brd_img',
        pageId: 'pg_1',
        rect,
        roundId: null,
        source: { fileId: 'file_1', kind: 'image' },
        title: 'Reference',
        type: 'image',
      },
      {
        expected: null,
        flowNodeId: null,
        groupId: null,
        id: 'brd_decision',
        pageId: 'pg_1',
        rect,
        roundId: null,
        source: null,
        title: 'Pick one',
        type: 'decision',
      },
    ],
    edges: [
      {
        condition: null,
        flowEdgeId: 'flow_edge_1',
        from: 'brd_a',
        id: 'edg_1',
        isDefault: false,
        label: 'next',
        to: 'brd_b',
      },
    ],
    groups: [
      { desc: '', id: 'grp_options', kind: 'options', pageId: 'pg_1', rect, title: 'Options' },
    ],
    pages: [{ id: 'pg_1', name: 'Page 1', sortOrder: 0 }],
    questions: [
      {
        boardId: 'brd_a',
        content: 'secret agent question',
        groupId: null,
        id: 'q_1',
        pageId: 'pg_1',
      },
    ],
    rounds: [
      {
        batchId: 'batch_1',
        chosenBoardId: 'brd_a',
        id: 'rnd_open',
        pageId: 'pg_1',
        recommendedBoardId: 'brd_a',
        status: 'open',
        title: 'Direction',
      },
      {
        batchId: null,
        chosenBoardId: 'brd_b',
        id: 'rnd_done',
        pageId: 'pg_1',
        recommendedBoardId: null,
        status: 'submitted',
        title: 'Layout',
      },
    ],
    ...overrides,
  },
  createdAt: new Date('2026-11-01T00:00:00Z'),
  description: 'Onboarding directions',
  id: 'art_1',
  phase: 'discuss',
  projectId: 'prj_1',
  revision: 7,
  taskId: 'task_1',
  title: 'Onboarding',
  topicId: 'tpc_1',
  updatedAt: new Date('2026-11-02T00:00:00Z'),
});

const publishedAt = '2026-11-17T00:00:00.000Z';

describe('buildArtboardPublishSnapshot', () => {
  it('leaves out comments, acceptance fields and private ids', () => {
    const json = JSON.stringify(buildArtboardPublishSnapshot(item(), { publishedAt }));

    for (const leaked of [
      'secret agent question',
      'shows the empty state',
      'node_1',
      'flow_edge_1',
      'acc_1',
      'task_1',
      'tpc_1',
      'prj_1',
      'batch_1',
    ])
      expect(json).not.toContain(leaked);
  });

  it('keeps only submitted choices', () => {
    const { rounds } = buildArtboardPublishSnapshot(item(), { publishedAt });

    expect(rounds.find((round) => round.id === 'rnd_open')?.chosenBoardId).toBeNull();
    expect(rounds.find((round) => round.id === 'rnd_open')?.recommendedBoardId).toBe('brd_a');
    expect(rounds.find((round) => round.id === 'rnd_done')?.chosenBoardId).toBe('brd_b');
  });

  it('points board sources at files inside the published site', () => {
    const { boards } = buildArtboardPublishSnapshot(item(), { publishedAt });
    const sources = Object.fromEntries(boards.map((board) => [board.id, board.source]));

    expect(sources).toEqual({
      brd_a: { kind: 'canvas', src: 'canvases/cvs_a/v3/detail.html' },
      brd_b: { kind: 'canvas', src: 'canvases/cvs_b/v1/index.html' },
      brd_decision: null,
      brd_img: { kind: 'image', src: 'images/file_1' },
    });
  });

  it('carries the title, description and pages', () => {
    const snapshot = buildArtboardPublishSnapshot(item(), { publishedAt });

    expect(snapshot).toMatchObject({
      description: 'Onboarding directions',
      pages: [{ id: 'pg_1', name: 'Page 1', sortOrder: 0 }],
      publishedAt,
      title: 'Onboarding',
      version: 1,
    });
  });
});

describe('hashArtboardSnapshot', () => {
  it('is the same for the same board published at different times', () => {
    const first = buildArtboardPublishSnapshot(item(), { publishedAt });
    const later = buildArtboardPublishSnapshot(item(), { publishedAt: '2026-12-01T00:00:00.000Z' });

    expect(hashArtboardSnapshot(later)).toBe(hashArtboardSnapshot(first));
  });

  it('changes when a submitted choice changes', () => {
    const base = item();
    const rechosen = item({
      rounds: base.content.rounds.map((round) =>
        round.id === 'rnd_done' ? { ...round, chosenBoardId: 'brd_a' } : round,
      ),
    });

    expect(hashArtboardSnapshot(buildArtboardPublishSnapshot(rechosen, { publishedAt }))).not.toBe(
      hashArtboardSnapshot(buildArtboardPublishSnapshot(base, { publishedAt })),
    );
  });

  it('ignores a draft pick in an open round', () => {
    const base = item();
    const drafted = item({
      rounds: base.content.rounds.map((round) =>
        round.id === 'rnd_open' ? { ...round, chosenBoardId: 'brd_b' } : round,
      ),
    });

    expect(hashArtboardSnapshot(buildArtboardPublishSnapshot(drafted, { publishedAt }))).toBe(
      hashArtboardSnapshot(buildArtboardPublishSnapshot(base, { publishedAt })),
    );
  });
});
