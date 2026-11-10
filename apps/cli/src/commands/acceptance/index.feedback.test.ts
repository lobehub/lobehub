import type { AcceptanceCommentItem } from '@lobechat/types';
import { Command } from 'commander';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type * as Format from '../../utils/format';
import { registerAcceptanceCommands } from '.';

const { getBundle, listComments, outputJson, setPreviewUrl } = vi.hoisted(() => ({
  getBundle: vi.fn(),
  listComments: vi.fn(),
  outputJson: vi.fn(),
  setPreviewUrl: vi.fn(),
}));
vi.mock('../../api/client', () => ({
  getTrpcClient: async () => ({
    acceptance: { getBundle: { query: getBundle }, setPreviewUrl: { mutate: setPreviewUrl } },
    acceptanceComment: { list: { query: listComments } },
  }),
}));
vi.mock('../../utils/format', async (original) => ({
  ...(await original<typeof Format>()),
  outputJson,
}));

const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
const comment = (
  id: string,
  overrides: Partial<AcceptanceCommentItem> = {},
): AcceptanceCommentItem => ({
  acceptanceId: 'acceptance-id',
  anchorType: 'evidence',
  attachments: [],
  author: {
    avatar: null,
    fullName: 'Reviewer',
    id: 'user',
    status: 'active',
    type: 'user',
    username: null,
  },
  authorAgentId: null,
  authorUserId: 'user',
  canDelete: true,
  checkItemId: 'table',
  clientId: id,
  content: id,
  contextRoundIndex: 1,
  contextRunId: 'round-1',
  createdAt: new Date('2026-09-22T14:09:00Z'),
  deletedAt: null,
  editorData: null,
  evidenceId: 'image',
  id,
  kind: 'comment',
  parentCommentId: null,
  reactions: [],
  rect,
  resolvedAt: null,
  resolvedByUserId: null,
  source: null,
  updatedAt: new Date('2026-09-22T14:09:00Z'),
  ...overrides,
});

const bundle = () => ({
  checks: [
    {
      id: 'table',
      seq: 2,
      title: 'Token table',
      evidence: [],
      timeline: [{ evidence: [{ id: 'image', description: 'table.png' }] }],
      reviews: [] as {
        action: string;
        annotations?: { comment?: string; evidenceId?: string; rect?: typeof rect }[];
        comment?: string;
        createdAt?: string;
        id?: string;
        roundIndex?: number;
      }[],
      userReview: null,
    },
  ],
  flows: [],
  rounds: [
    {
      run: {
        id: 'round-1',
        roundIndex: 1,
        userDecision: 'reject',
        decisionDetail: {
          comment: 'Read my comments',
          decidedAt: '2026-09-22T14:18:00Z',
        },
      },
    },
  ],
});

const feedback = async (...flags: string[]) => {
  const program = new Command().exitOverride();
  registerAcceptanceCommands(program);
  await program.parseAsync(['node', 'lh', 'acceptance', 'feedback', 'acceptance-id', ...flags]);
  return outputJson.mock.calls.at(-1)?.[0];
};

beforeEach(() => {
  vi.clearAllMocks();
  getBundle.mockResolvedValue(bundle());
  listComments.mockResolvedValue({ items: [], canComment: true, canApprove: true });
});
afterEach(() => vi.restoreAllMocks());

it('returns independent region comments and the overall rejection even without check rejects', async () => {
  listComments.mockResolvedValue({
    items: [
      comment('region', {
        content: 'Not vertically centered',
        attachments: [
          { id: 'attachment', name: 'expected.png', url: 'https://example.com/expected.png' },
        ],
      }),
    ],
  });
  const { entries } = await feedback('--actionable', '--json');
  expect(entries).toHaveLength(2);
  expect(entries[0]).toMatchObject({
    kind: 'decision',
    actionable: true,
    comment: 'Read my comments',
    roundIndex: 1,
  });
  expect(entries[1]).toMatchObject({
    kind: 'comment',
    commentId: 'region',
    threadId: 'region',
    actionable: true,
    comment: 'Not vertically centered',
    checkId: 'table',
    checkSeq: 2,
    title: 'Token table',
    createdAt: '2026-09-22T14:09:00.000Z',
    fileIds: ['attachment'],
    attachments: [{ id: 'attachment', url: 'https://example.com/expected.png' }],
    annotations: [{ evidenceId: 'image', rect, region: expect.stringContaining('table.png') }],
  });
});

it('keeps unresolved older comments and replies actionable across rounds with the original anchor', async () => {
  const data = bundle();
  data.rounds.push({
    run: {
      id: 'round-2',
      roundIndex: 2,
      userDecision: 'accept',
      decisionDetail: { comment: 'Approved', decidedAt: '2026-09-23T14:00:00Z' },
    },
  });
  getBundle.mockResolvedValue(data);
  listComments.mockResolvedValue({
    items: [
      comment('root'),
      comment('reply', {
        anchorType: 'acceptance',
        checkItemId: null,
        evidenceId: null,
        rect: null,
        parentCommentId: 'root',
        contextRoundIndex: 2,
        contextRunId: 'round-2',
      }),
    ],
  });
  const { entries } = await feedback('--actionable', '--json');
  expect(entries).toHaveLength(2);
  expect(entries[1]).toMatchObject({
    commentId: 'reply',
    threadId: 'root',
    parentCommentId: 'root',
    checkId: 'table',
    annotations: [{ evidenceId: 'image', rect }],
    roundIndex: 2,
  });
});

it('excludes resolved threads, deleted comments and non-comment events from actionable feedback', async () => {
  listComments.mockResolvedValue({
    items: [
      comment('resolved', { resolvedAt: new Date() }),
      comment('reply', { parentCommentId: 'resolved' }),
      comment('deleted', { deletedAt: new Date(), content: '' }),
      comment('approval', { kind: 'approval' }),
      comment('proposal', { kind: 'proposal' }),
      comment('reaction', { kind: 'reaction' }),
      comment('global', {
        anchorType: 'acceptance',
        checkItemId: null,
        evidenceId: null,
        rect: null,
      }),
    ],
  });
  const { entries } = await feedback('--actionable', '--json');
  expect(entries.map((entry: { comment: string }) => entry.comment)).toEqual([
    'Read my comments',
    'global',
  ]);
  const history = await feedback('--json');
  expect(history.entries.filter((entry: { kind: string }) => entry.kind === 'comment')).toEqual([
    expect.objectContaining({ commentId: 'resolved', actionable: false }),
    expect.objectContaining({ commentId: 'reply', actionable: false }),
    expect.objectContaining({ commentId: 'global', actionable: true }),
  ]);
});

it('preserves live replies to deleted roots and round proposals', async () => {
  listComments.mockResolvedValue({
    items: [
      comment('deleted', { deletedAt: new Date(), content: '' }),
      comment('reply', { parentCommentId: 'deleted' }),
      comment('proposal', { kind: 'proposal' }),
      comment('proposal-reply', { parentCommentId: 'proposal' }),
    ],
  });
  const { entries } = await feedback('--actionable', '--json');
  expect(
    entries
      .filter((entry: { kind: string }) => entry.kind === 'comment')
      .map((entry: { commentId: string }) => entry.commentId),
  ).toEqual(['reply', 'proposal-reply']);
});

it('prints readable region, attachment and overall rejection context in plain text', async () => {
  const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
  listComments.mockResolvedValue({
    items: [
      comment('region', {
        content: 'Not vertically centered',
        attachments: [{ id: 'attachment', url: 'https://example.com/expected.png' }],
      }),
    ],
  });
  await feedback('--actionable');
  const text = stdout.mock.calls.flat().join('\n');
  expect(text).toContain('Read my comments');
  expect(text).toContain('Not vertically centered');
  expect(text).toContain('C2 Token table');
  expect(text).toContain('table.png');
  expect(text).toContain('attachment');
  expect(text).toContain('https://example.com/expected.png');
  expect(text).not.toContain('No actionable feedback');
});

it('leads with the region a note was drawn on, and hangs the note under it', async () => {
  const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
  const data = bundle();
  data.checks[0].reviews.push({
    action: 'reject',
    // A region note: the reviewer circled an area and wrote the words for it.
    annotations: [{ comment: 'Expand this by default', evidenceId: 'image', rect }],
    comment: '',
    createdAt: '2026-09-22T14:20:00.000Z',
    id: 'review-1',
    roundIndex: 1,
  });
  getBundle.mockResolvedValue(data);

  await feedback();

  const text = stdout.mock.calls.flat().join('\n');
  expect(text).toContain('table.png @ 10%,20% · 30%×40%');
  expect(text).toContain('Expand this by default');
  // The anchor names the artifact; the reviewer's own words come after it.
  expect(text.indexOf('table.png')).toBeLessThan(text.indexOf('Expand this by default'));
  expect(text).not.toContain('region: Expand this by default');
});

it('reports a comment read failure instead of claiming there is no feedback', async () => {
  listComments.mockRejectedValue(new Error('Comments unavailable'));
  await expect(feedback('--actionable', '--json')).rejects.toThrow('Comments unavailable');
  expect(outputJson).not.toHaveBeenCalled();
});

it('retains historical rejection notes without treating them or approval notes as current feedback', async () => {
  const data = bundle();
  data.rounds.push({
    run: {
      id: 'round-2',
      roundIndex: 2,
      userDecision: 'accept',
      decisionDetail: { comment: 'Approved', decidedAt: '2026-09-23T14:00:00Z' },
    },
  });
  getBundle.mockResolvedValue(data);
  expect((await feedback('--actionable', '--json')).entries).toEqual([]);
  expect((await feedback('--json')).entries).toEqual([
    expect.objectContaining({ kind: 'decision', comment: 'Read my comments', actionable: false }),
  ]);
});

const pageSource = {
  intent: 'change' as const,
  scroll: { x: 0, y: 0 },
  targets: [
    {
      code: { chain: [], column: 7, file: 'src/Pay.tsx', line: 42 },
      label: 'Pay',
      rect: { height: 40, width: 120, x: 10, y: 20 },
      selector: '#pay',
    },
    { label: 'Total', rect: { height: 20, width: 80, x: 0, y: 0 }, selector: '.total' },
  ],
  url: 'https://pr-12.preview.example.com/checkout',
  v: 1 as const,
  viewport: { dpr: 2, height: 800, width: 1280 },
};
const pageComment = (id: string, overrides: Partial<AcceptanceCommentItem> = {}) =>
  comment(id, {
    anchorType: 'acceptance',
    checkItemId: null,
    evidenceId: null,
    rect: null,
    ...overrides,
  });

it('points product-page comments and their replies at the page and source location', async () => {
  listComments.mockResolvedValue({
    items: [
      pageComment('root', { source: pageSource }),
      pageComment('reply', { parentCommentId: 'root' }),
    ],
  });
  const { entries } = await feedback('--json');
  const page = { locations: ['src/Pay.tsx:42'], url: pageSource.url };
  expect(entries.filter((entry: { kind: string }) => entry.kind === 'comment')).toEqual([
    expect.objectContaining({ commentId: 'root', page }),
    expect.objectContaining({ commentId: 'reply', page }),
  ]);
});

it('prints the page and source location of a product-page comment', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  listComments.mockResolvedValue({ items: [pageComment('root', { source: pageSource })] });
  await feedback();
  const printed = log.mock.calls.map((call) => String(call[0])).join('\n');
  expect(printed).toContain(pageSource.url);
  expect(printed).toContain('src/Pay.tsx:42');
});

it('records where the delivery is deployed for preview review', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  setPreviewUrl.mockResolvedValue({ previewUrl: 'https://pr-12.example.com/', roundIndex: 3 });
  const program = new Command().exitOverride();
  registerAcceptanceCommands(program);
  await program.parseAsync([
    'node',
    'lh',
    'acceptance',
    'preview',
    'acceptance-id',
    'https://pr-12.example.com/',
  ]);
  expect(setPreviewUrl).toHaveBeenCalledWith({
    id: 'acceptance-id',
    url: 'https://pr-12.example.com/',
  });
});

it('includes video time for the root and its replies in actionable feedback', async () => {
  listComments.mockResolvedValue({
    items: [
      comment('video-root', { time: { start: 1.25 } }),
      comment('video-reply', { parentCommentId: 'video-root', evidenceId: null, rect: null }),
    ],
  });
  const result = await feedback('--json');
  const video = result.entries.filter((item: { kind: string }) => item.kind === 'comment');
  expect(video).toHaveLength(2);
  expect(video[0].annotations[0].time).toEqual({ start: 1.25 });
  expect(video[1].annotations[0].time).toEqual({ start: 1.25 });
});
