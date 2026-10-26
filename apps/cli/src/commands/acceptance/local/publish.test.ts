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
      addGroupFeedback: { mutate: vi.fn() },
      getBundle: { query: vi.fn() },
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

const ingested = (roundIndex: number) => ({
  acceptanceId: 'remote-acceptance',
  acceptanceUrl: 'https://app.lobehub.com/acceptance/remote-acceptance',
  publicationStatus: 'complete',
  roundIndex,
  verifyRunId: `remote-run-${roundIndex}`,
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
        { dir: '20260101-090000-first', roundIndex: 1, verifyRunId: 'remote-run-1' },
        { dir: '20260102-090000-second', roundIndex: 2, verifyRunId: 'remote-run-2' },
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
    ingestReportAction.mockResolvedValueOnce(ingested(1));
    client.acceptance.getBundle.query.mockResolvedValue({
      checks: [
        {
          id: 'criterion-rename',
          planItem: { id: 'rename' },
          result: { id: 'remote-result' },
          timeline: [
            {
              evidence: [{ id: 'remote-shot' }, { id: 'remote-api' }],
              verifyRunId: 'remote-run-1',
            },
          ],
        },
      ],
    });

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
});
