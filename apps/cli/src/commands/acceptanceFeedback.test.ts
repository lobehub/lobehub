import type { AcceptanceCommentItem } from '@lobechat/types';
import { Command } from 'commander';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type * as Format from '../utils/format';
import { registerAcceptanceCommands } from './verifyAcceptance';

const { getBundle, listComments, outputJson } = vi.hoisted(() => ({
  getBundle: vi.fn(),
  listComments: vi.fn(),
  outputJson: vi.fn(),
}));
vi.mock('../api/client', () => ({
  getTrpcClient: async () => ({
    acceptance: { getBundle: { query: getBundle } },
    acceptanceComment: { list: { query: listComments } },
  }),
}));
vi.mock('../utils/format', async (original) => ({
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
      reviews: [],
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
