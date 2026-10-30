import { readFileSync } from 'node:fs';
import path from 'node:path';

import { assembleLocalAcceptance } from '@lobechat/utils/verify/localAcceptance';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Format from '../../../utils/format';
import { log } from '../../../utils/logger';
import { ACCEPTANCE_FILE } from './acceptanceDir';
import { loadLocalAcceptance, writeReviewLog } from './localAcceptance';
import { publishAction } from './publish';
import { createLocalAcceptance, firstRound } from './testUtils';

const { client, ingestReportAction, outputJson } = vi.hoisted(() => ({
  client: {
    acceptance: {
      accept: { mutate: vi.fn() },
      addGroupFeedback: { mutate: vi.fn() },
      getBundle: { query: vi.fn() },
      reject: { mutate: vi.fn() },
      reviewChecks: { mutate: vi.fn() },
    },
  },
  ingestReportAction: vi.fn(),
  outputJson: vi.fn(),
}));
vi.mock('../../../api/client', () => ({ getTrpcClient: async () => client }));
vi.mock('../run/ingest', () => ({ ingestReportAction }));
vi.mock('../../../utils/format', async (original) => ({
  ...(await original<typeof Format>()),
  outputJson,
}));

const ingested = (
  roundIndex: number,
  publishedEvidence: { checkItemId: string; evidenceId: string; position: number }[] = [],
) => ({
  acceptanceId: 'remote-acceptance',
  acceptanceUrl: 'https://app.lobehub.com/acceptance/remote-acceptance',
  failedEvidence: [],
  missingEvidence: [],
  publicationStatus: 'complete',
  publishedEvidence,
  roundIndex,
  verifyRunId: `remote-run-${roundIndex}`,
});

/** Both artifacts of the fixture's `rename` check, uploaded in order. */
const bothUploaded = [
  { checkItemId: 'rename', evidenceId: 'remote-shot', position: 0 },
  { checkItemId: 'rename', evidenceId: 'remote-api', position: 1 },
];

const remoteBundle = (evidence: { id: string }[]) => ({
  checks: [
    {
      id: 'criterion-rename',
      planItem: { id: 'rename' },
      result: { id: 'remote-result' },
      timeline: [{ evidence, verifyRunId: 'remote-run-1' }],
    },
  ],
});

describe('lh acceptance publish', () => {
  let fixture: ReturnType<typeof createLocalAcceptance>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    fixture = createLocalAcceptance([firstRound()], 'task-T-12');
    vi.stubEnv('LOBEHUB_ACCEPTANCE_DOWNLOADS', path.join(fixture.root, 'Downloads'));
    vi.stubEnv('HOME', fixture.root);
  });

  afterEach(() => {
    fixture.cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('replays unpublished rounds in order into one acceptance, and resumes after them', async () => {
    loadLocalAcceptance(fixture.acceptanceDir, { create: true, requirement: 'Rename works' });
    const second = firstRound();
    second.dir = '20260102-090000-second';
    fixture.addRound(second);
    ingestReportAction.mockResolvedValueOnce(ingested(1)).mockResolvedValueOnce(ingested(2));

    await publishAction(fixture.acceptanceDir, { json: true, reviews: false });

    expect(
      ingestReportAction.mock.calls.map(([dir, options]) => [path.basename(dir), options]),
    ).toEqual([
      // The first round names the subject the directory is keyed by, and the requirement.
      [
        '20260101-090000-first',
        { quiet: true, requirement: 'Rename works', source: 'agent-testing', subject: 'task:T-12' },
      ],
      // Later rounds join the acceptance the first one created.
      [
        '20260102-090000-second',
        { acceptance: 'remote-acceptance', quiet: true, source: 'agent-testing' },
      ],
    ]);
    const stored = JSON.parse(
      readFileSync(path.join(fixture.acceptanceDir, ACCEPTANCE_FILE), 'utf8'),
    );
    expect(stored.remote).toEqual({
      acceptanceId: 'remote-acceptance',
      acceptanceUrl: 'https://app.lobehub.com/acceptance/remote-acceptance',
      rounds: [
        { dir: '20260101-090000-first', evidence: {}, roundIndex: 1, verifyRunId: 'remote-run-1' },
        {
          dir: '20260102-090000-second',
          evidence: {},
          roundIndex: 2,
          verifyRunId: 'remote-run-2',
        },
      ],
    });
    expect(outputJson.mock.calls[0]![0]).toMatchObject({
      acceptanceUrl: 'https://app.lobehub.com/acceptance/remote-acceptance',
      alreadyPublished: [],
      publicationStatus: 'complete',
    });

    // Nothing new: nothing is ingested again.
    ingestReportAction.mockClear();
    await publishAction(fixture.acceptanceDir, { json: true, reviews: false });
    expect(ingestReportAction).not.toHaveBeenCalled();
    expect(outputJson.mock.calls[1]![0]).toMatchObject({
      alreadyPublished: ['20260101-090000-first', '20260102-090000-second'],
      published: [],
    });
  });

  it("carries the reviewer's standing decisions, re-pointing regions at the uploads", async () => {
    const { info, source } = loadLocalAcceptance(fixture.acceptanceDir, { create: true });
    const local = assembleLocalAcceptance(source);
    const check = local.checks.find((item) => item.id === 'rename')!;
    writeReviewLog(fixture.acceptanceDir, info.id, [
      {
        action: 'reject',
        annotations: [
          {
            comment: 'Title is cut off',
            evidenceId: check.evidence[0]!.id,
            rect: { height: 0.2, width: 0.2, x: 0.1, y: 0.1 },
          },
        ],
        comment: 'Rename loses part of the title',
        createdAt: '2026-01-01T10:00:00.000Z',
        id: 'event-1',
        kind: 'checks',
        roundIndex: 1,
        targets: [{ checkId: 'rename', resultId: check.result!.id }],
      },
      {
        category: 'Rename',
        comment: 'Also try a very long title',
        createdAt: '2026-01-01T10:01:00.000Z',
        id: 'event-2',
        kind: 'group',
        roundIndex: 1,
      },
    ]);
    ingestReportAction.mockResolvedValueOnce(ingested(1, bothUploaded));
    client.acceptance.getBundle.query.mockResolvedValue(
      remoteBundle([{ id: 'remote-shot' }, { id: 'remote-api' }]),
    );

    await publishAction(fixture.acceptanceDir, { json: true });

    expect(client.acceptance.reviewChecks.mutate).toHaveBeenCalledWith({
      action: 'reject',
      annotations: [
        {
          comment: 'Title is cut off',
          evidenceId: 'remote-shot',
          rect: { height: 0.2, width: 0.2, x: 0.1, y: 0.1 },
        },
      ],
      checkItemIds: ['criterion-rename'],
      comment: 'Rename loses part of the title',
      id: 'remote-acceptance',
    });
    expect(client.acceptance.addGroupFeedback.mutate).toHaveBeenCalledWith({
      category: 'Rename',
      comment: 'Also try a very long title',
      id: 'remote-acceptance',
    });
    expect(outputJson.mock.calls[0]![0].reviews).toEqual({ skipped: [], uploaded: 2 });
  });
  it('places a region only on its own upload when an earlier artifact failed', async () => {
    const { info, source } = loadLocalAcceptance(fixture.acceptanceDir, { create: true });
    const check = assembleLocalAcceptance(source).checks.find((item) => item.id === 'rename')!;
    writeReviewLog(fixture.acceptanceDir, info.id, [
      {
        action: 'reject',
        annotations: [
          {
            comment: 'Title is cut off',
            evidenceId: check.evidence[0]!.id,
            rect: { height: 0.2, width: 0.2, x: 0.1, y: 0.1 },
          },
        ],
        createdAt: '2026-01-01T10:00:00.000Z',
        id: 'event-1',
        kind: 'checks',
        roundIndex: 1,
        targets: [{ checkId: 'rename', resultId: check.result!.id }],
      },
    ]);
    // The screenshot failed to upload: the API log is the check's only remote artifact.
    ingestReportAction.mockResolvedValueOnce(
      ingested(1, [{ checkItemId: 'rename', evidenceId: 'remote-api', position: 1 }]),
    );
    client.acceptance.getBundle.query.mockResolvedValue(remoteBundle([{ id: 'remote-api' }]));

    await publishAction(fixture.acceptanceDir, { json: true });

    // Not drawn on the API log; the note survives as words.
    expect(client.acceptance.reviewChecks.mutate).toHaveBeenCalledWith({
      action: 'reject',
      checkItemIds: ['criterion-rename'],
      comment: 'Title is cut off',
      id: 'remote-acceptance',
    });
  });

  it('carries each local decision once, so a re-publish keeps newer online ones', async () => {
    const { info, source } = loadLocalAcceptance(fixture.acceptanceDir, { create: true });
    const check = assembleLocalAcceptance(source).checks.find((item) => item.id === 'rename')!;
    const accept = {
      action: 'accept' as const,
      createdAt: '2026-01-01T10:00:00.000Z',
      id: 'event-1',
      kind: 'checks' as const,
      roundIndex: 1,
      targets: [{ checkId: 'rename', resultId: check.result!.id }],
    };
    const feedback = {
      category: 'Rename',
      comment: 'Also try a very long title',
      createdAt: '2026-01-01T10:01:00.000Z',
      id: 'event-2',
      kind: 'group' as const,
      roundIndex: 1,
    };
    writeReviewLog(fixture.acceptanceDir, info.id, [accept, feedback]);
    ingestReportAction.mockResolvedValueOnce(ingested(1, bothUploaded));
    client.acceptance.getBundle.query.mockResolvedValue(
      remoteBundle([{ id: 'remote-shot' }, { id: 'remote-api' }]),
    );

    await publishAction(fixture.acceptanceDir, { json: true });
    expect(client.acceptance.reviewChecks.mutate).toHaveBeenCalledTimes(1);
    expect(client.acceptance.addGroupFeedback.mutate).toHaveBeenCalledTimes(1);

    // Unchanged: nothing is replayed over what collaborators decided since.
    await publishAction(fixture.acceptanceDir, { json: true });
    expect(client.acceptance.reviewChecks.mutate).toHaveBeenCalledTimes(1);
    expect(client.acceptance.addGroupFeedback.mutate).toHaveBeenCalledTimes(1);
    expect(outputJson.mock.calls[1]![0].reviews).toEqual({ skipped: [], uploaded: 0 });

    // A decision made locally afterwards still moves.
    writeReviewLog(fixture.acceptanceDir, info.id, [
      accept,
      feedback,
      { ...accept, action: 'reject', createdAt: '2026-01-02T10:00:00.000Z', id: 'event-3' },
    ]);
    await publishAction(fixture.acceptanceDir, { json: true });
    expect(client.acceptance.reviewChecks.mutate).toHaveBeenCalledTimes(2);
    expect(client.acceptance.reviewChecks.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'reject', checkItemIds: ['criterion-rename'] }),
    );
    expect(client.acceptance.addGroupFeedback.mutate).toHaveBeenCalledTimes(1);
  });

  it("carries the latest round's delivery decision last, bound to that round, once", async () => {
    const { info, source } = loadLocalAcceptance(fixture.acceptanceDir, { create: true });
    const check = assembleLocalAcceptance(source).checks.find((item) => item.id === 'rename')!;
    const accept = {
      action: 'accept' as const,
      createdAt: '2026-01-01T10:00:00.000Z',
      id: 'event-1',
      kind: 'checks' as const,
      roundIndex: 1,
      targets: [{ checkId: 'rename', resultId: check.result!.id }],
    };
    const decision = {
      action: 'accept' as const,
      comment: 'Ship it',
      createdAt: '2026-01-01T10:05:00.000Z',
      id: 'event-2',
      kind: 'decision' as const,
      roundIndex: 1,
    };
    writeReviewLog(fixture.acceptanceDir, info.id, [accept, decision]);
    ingestReportAction.mockResolvedValueOnce(ingested(1, bothUploaded));
    client.acceptance.getBundle.query.mockResolvedValue(
      remoteBundle([{ id: 'remote-shot' }, { id: 'remote-api' }]),
    );

    await publishAction(fixture.acceptanceDir, { json: true });
    expect(client.acceptance.accept.mutate).toHaveBeenCalledWith({
      comment: 'Ship it',
      id: 'remote-acceptance',
      roundId: 'remote-run-1',
    });
    expect(client.acceptance.reviewChecks.mutate.mock.invocationCallOrder[0]).toBeLessThan(
      client.acceptance.accept.mutate.mock.invocationCallOrder[0]!,
    );
    expect(outputJson.mock.calls[0]![0].reviews).toEqual({ skipped: [], uploaded: 2 });

    await publishAction(fixture.acceptanceDir, { json: true });
    expect(client.acceptance.accept.mutate).toHaveBeenCalledTimes(1);
  });

  it('records a local send-back without dispatching it again, and leaves older rounds alone', async () => {
    const { info } = loadLocalAcceptance(fixture.acceptanceDir, { create: true });
    const second = firstRound();
    second.dir = '20260102-090000-second';
    fixture.addRound(second);
    const reject = {
      action: 'reject' as const,
      comment: 'Focus is lost',
      createdAt: '2026-01-02T10:00:00.000Z',
      id: 'event-1',
      kind: 'decision' as const,
      roundIndex: 2,
    };
    // A decision on a round a later one re-opened is history, not the current call.
    writeReviewLog(fixture.acceptanceDir, info.id, [
      {
        ...reject,
        action: 'accept',
        createdAt: '2026-01-01T10:00:00.000Z',
        id: 'old',
        roundIndex: 1,
      },
      reject,
    ]);
    ingestReportAction.mockResolvedValueOnce(ingested(1)).mockResolvedValueOnce(ingested(2));
    client.acceptance.getBundle.query.mockResolvedValue(remoteBundle([]));

    await publishAction(fixture.acceptanceDir, { json: true });
    expect(client.acceptance.accept.mutate).not.toHaveBeenCalled();
    expect(client.acceptance.reject.mutate).toHaveBeenCalledWith({
      comment: 'Focus is lost',
      dispatch: false,
      id: 'remote-acceptance',
      roundId: 'remote-run-2',
    });
  });

  it('reports how to repair evidence a published round failed to upload', async () => {
    loadLocalAcceptance(fixture.acceptanceDir, { create: true });
    const failure = {
      checkItemId: 'rename',
      checkResultId: 'remote-result',
      error: 'network down',
      path: '/tmp/after shot.png',
      reason: 'upload_failed',
      retryArgs: ['acceptance', 'run', 'evidence', 'upload', '--check', 'remote-result'],
      retryCommand: "lh acceptance run evidence upload '--check' 'remote-result'",
      retryCommandShell: 'posix',
      type: 'screenshot',
    };
    ingestReportAction.mockResolvedValueOnce({
      ...ingested(1),
      failedEvidence: [failure],
      publicationStatus: 'partial',
    });

    await publishAction(fixture.acceptanceDir, { json: true, reviews: false });
    expect(outputJson.mock.calls[0]![0]).toMatchObject({
      published: [{ failedEvidence: [failure], publicationStatus: 'partial' }],
      publicationStatus: 'partial',
    });

    // The human-readable form prints the same retry for the round it publishes.
    const second = firstRound();
    second.dir = '20260102-090000-second';
    fixture.addRound(second);
    ingestReportAction.mockResolvedValueOnce({
      ...ingested(2),
      failedEvidence: [failure],
      publicationStatus: 'partial',
    });
    await publishAction(fixture.acceptanceDir, { reviews: false });
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(failure.retryCommand);
    process.exitCode = undefined;
  });
});
