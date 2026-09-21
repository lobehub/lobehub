import { Command } from 'commander';
import { expect, it, vi } from 'vitest';

import type * as Format from '../utils/format';
import { registerAcceptanceCommands } from './verifyAcceptance';

const { getBundle, outputJson } = vi.hoisted(() => ({ getBundle: vi.fn(), outputJson: vi.fn() }));
vi.mock('../api/client', () => ({
  getTrpcClient: async () => ({ acceptance: { getBundle: { query: getBundle } } }),
}));
vi.mock('../utils/format', async (original) => ({
  ...(await original<typeof Format>()),
  outputJson,
}));

it('includes flow regions and attachments, excluding superseded attempts from actionable feedback', async () => {
  const region = {
    evidenceId: 'image',
    comment: 'Clipped',
    rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  };
  const attempt = {
    id: 'latest',
    checkResultId: 'flow-result',
    checkItemId: 'flow-check',
    nodeId: 'node',
    sequence: 2,
    incomingEdgeId: 'edge',
    review: 'rejected',
    reviewComment: 'Fix image',
    reviewDetail: { annotations: [region], fileIds: ['attachment'] },
    evidence: [{ id: 'image', description: 'proof.png' }],
  };
  getBundle.mockResolvedValue({
    checks: [
      {
        id: 'legacy-flow',
        result: { id: 'flow-result' },
        evidence: [],
        timeline: [],
        userReview: { action: 'reject', stale: false },
        reviews: [{ id: 'flow-result', action: 'reject', comment: 'Duplicated flow review' }],
      },
    ],
    rounds: [{ run: { id: 'round', roundIndex: 1 } }],
    flows: [
      {
        versions: [
          {
            id: 'version',
            version: 1,
            nodes: [{ id: 'node', title: 'Ready' }],
            runs: [
              {
                id: 'run',
                verifyRunId: 'round',
                attempts: [{ ...attempt, id: 'old', sequence: 1 }, attempt],
              },
            ],
          },
        ],
      },
    ],
  });
  const program = new Command().exitOverride();
  registerAcceptanceCommands(program);
  await program.parseAsync([
    'node',
    'lh',
    'acceptance',
    'feedback',
    'acceptance-id',
    '--actionable',
    '--json',
  ]);
  const result = outputJson.mock.calls.at(-1)![0];
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0]).toMatchObject({
    kind: 'flow',
    checkId: 'flow-check',
    comment: 'Fix image',
    fileIds: ['attachment'],
    annotations: [{ ...region, region: expect.stringContaining('proof.png') }],
  });
});

it('emits a historical flow rejection once after a new unexecuted round, retaining non-flow reviews', async () => {
  const priorReview = {
    id: 'prior-result',
    action: 'reject',
    comment: 'Keep generic history',
    roundIndex: 1,
  };
  const flowReview = {
    id: 'flow-result',
    action: 'reject',
    comment: 'Flow rejection',
    roundIndex: 2,
  };
  getBundle.mockResolvedValue({
    checks: [
      {
        id: 'check',
        title: 'Ready',
        evidence: [],
        result: undefined,
        reviews: [priorReview, flowReview],
        timeline: [{ result: { id: 'flow-result' } }],
        userReview: { action: 'reject', stale: true },
      },
    ],
    rounds: [
      { run: { id: 'old-round', roundIndex: 2 } },
      { run: { id: 'new-round', roundIndex: 3 } },
    ],
    flows: [
      {
        versions: [
          {
            id: 'current',
            nodes: [{ id: 'node', title: 'Ready' }],
            runs: [{ id: 'new-round', verifyRunId: 'new-round', attempts: [] }],
          },
          {
            id: 'previous',
            nodes: [{ id: 'node', title: 'Ready' }],
            runs: [
              {
                id: 'old-round',
                verifyRunId: 'old-round',
                attempts: [
                  {
                    id: 'flow-result',
                    checkResultId: 'flow-result',
                    checkItemId: 'check',
                    nodeId: 'node',
                    sequence: 1,
                    review: 'rejected',
                    reviewComment: 'Flow rejection',
                    evidence: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  const program = new Command().exitOverride();
  registerAcceptanceCommands(program);
  await program.parseAsync(['node', 'lh', 'acceptance', 'feedback', 'acceptance-id', '--json']);
  const { entries } = outputJson.mock.calls.at(-1)![0];
  expect(entries).toHaveLength(2);
  expect(entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'check', comment: 'Keep generic history' }),
      expect.objectContaining({ kind: 'flow', comment: 'Flow rejection', actionable: false }),
    ]),
  );
});

it('keeps rejections for distinct subflow entries actionable and supersedes only the same check', async () => {
  const attempt = (id: string, checkItemId: string, nodeId: string) => ({
    id,
    checkResultId: id,
    checkItemId,
    nodeId,
    sequence: 1,
    review: 'rejected',
    reviewComment: id,
    evidence: [],
  });
  getBundle.mockResolvedValue({
    checks: [],
    rounds: [{ run: { id: 'round', roundIndex: 1 } }],
    flows: [
      {
        versions: [
          {
            id: 'version',
            nodes: [
              { id: 'first', title: 'First call' },
              { id: 'second', title: 'Second call' },
            ],
            runs: [
              {
                id: 'round',
                verifyRunId: 'round',
                attempts: [
                  attempt('old', 'first-check', 'first'),
                  attempt('first-latest', 'first-check', 'first'),
                  attempt('second-latest', 'second-check', 'second'),
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  const program = new Command().exitOverride();
  registerAcceptanceCommands(program);
  await program.parseAsync([
    'node',
    'lh',
    'acceptance',
    'feedback',
    'acceptance-id',
    '--actionable',
    '--json',
  ]);
  expect(
    outputJson.mock.calls.at(-1)![0].entries.map((entry: { comment: string }) => entry.comment),
  ).toEqual(['first-latest', 'second-latest']);
});
