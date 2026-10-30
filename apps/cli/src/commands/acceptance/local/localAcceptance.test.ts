import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { assembleLocalAcceptance } from '@lobechat/utils/verify/localAcceptance';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../../utils/logger';
import { ReportRoundError } from '../run/reportRound';
import { ACCEPTANCE_FILE, REVIEWS_FILE } from './acceptanceDir';
import { findSavedReviewLog, loadLocalAcceptance, reviewExportPrefix } from './localAcceptance';
import { createLocalAcceptance, firstRound } from './testUtils';

describe('loadLocalAcceptance', () => {
  let fixture: ReturnType<typeof createLocalAcceptance>;

  beforeEach(() => {
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    fixture = createLocalAcceptance([firstRound()]);
    vi.stubEnv('LOBEHUB_ACCEPTANCE_DOWNLOADS', path.join(fixture.root, 'Downloads'));
    vi.stubEnv('XDG_DOWNLOAD_DIR', path.join(fixture.root, 'Downloads'));
    vi.stubEnv('HOME', fixture.root);
  });

  afterEach(() => {
    fixture.cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reads a round the way ingest publishes it', () => {
    const roundDir = path.join(fixture.acceptanceDir, '20260101-090000-first');
    const { info, rounds, source } = loadLocalAcceptance(roundDir, {
      create: true,
      requirement: 'Users can rename a topic',
    });

    expect(info.requirement).toBe('Users can rename a topic');
    expect(info.subjectKey).toBe('standalone-demo');
    const [round] = rounds;
    // The test gate is screened out exactly as on ingest.
    expect(round!.droppedLabels).toEqual(['unit — Unit tests pass']);
    expect(round!.source.results.map((result) => result.checkItemId)).toEqual(['rename']);
    expect(round!.source.results[0]).toMatchObject({
      toulmin: { evidence: 'The list shows the new title.' },
      verdict: 'passed',
    });
    // The never-run video check is an open gap, not a pass.
    expect(round!.unexecuted).toEqual(['enter']);
    expect(round!.missingEvidence).toEqual([{ checkItemId: 'enter', types: ['video'] }]);
    expect(round!.source.report).toMatchObject({
      totalChecks: 2,
      passedChecks: 1,
      verdict: 'uncertain',
    });

    const [screenshot, text] = round!.source.evidence;
    // Relative to the acceptance directory, where report.html lives; spaces encoded.
    expect(screenshot).toMatchObject({
      content: null,
      fileHeight: 600,
      fileUrl: '20260101-090000-first/assets/after%20shot.png',
      fileWidth: 800,
      type: 'screenshot',
    });
    // A page opened from disk cannot fetch siblings: text travels inline.
    expect(text).toMatchObject({
      content: expect.stringContaining('Weekly sync'),
      fileUrl: null,
      type: 'text',
    });
    expect(source.rounds[0]!.proposal).toBe('Rename keeps the new title.');
    expect(source.rounds[0]!.run.createdAt).toBe(new Date(2026, 0, 1, 9, 0, 0).toISOString());
  });

  it('keeps ids stable across reads, so decisions stay on their evidence', () => {
    const first = loadLocalAcceptance(fixture.acceptanceDir, { create: true });
    const second = loadLocalAcceptance(fixture.acceptanceDir);
    expect(second.info.id).toBe(first.info.id);
    expect(second.source.rounds[0]!.results[0]!.id).toBe(first.source.rounds[0]!.results[0]!.id);
    expect(second.source.rounds[0]!.evidence.map((item) => item.id)).toEqual(
      first.source.rounds[0]!.evidence.map((item) => item.id),
    );
  });

  it('records the requirement once', () => {
    loadLocalAcceptance(fixture.acceptanceDir, { create: true, requirement: 'First goal' });
    const again = loadLocalAcceptance(fixture.acceptanceDir, {
      create: true,
      requirement: 'Another goal',
    });
    expect(again.info.requirement).toBe('First goal');
    expect(again.keptRequirement).toBe('First goal');
    const stored = JSON.parse(
      readFileSync(path.join(fixture.acceptanceDir, ACCEPTANCE_FILE), 'utf8'),
    );
    expect(stored).toMatchObject({ format: 1, requirement: 'First goal' });
    expect(stored.subjectKey).toBeUndefined();
  });

  it('downgrades a pass whose required evidence is missing', () => {
    const round = firstRound();
    round.dir = '20260102-090000-second';
    round.assets = {};
    fixture.addRound(round);
    const { rounds } = loadLocalAcceptance(fixture.acceptanceDir, { create: true });
    const second = rounds[1]!;
    expect(second.failedEvidence.map((item) => path.basename(item.path))).toEqual([
      'after shot.png',
      'api.txt',
    ]);
    expect(second.source.results[0]).toMatchObject({
      toulmin: { limitation: 'Required evidence not published: screenshot, text.' },
      verdict: 'uncertain',
    });
  });

  it('refuses a round of nothing but programmatic gates', () => {
    const round = firstRound();
    round.dir = '20260103-090000-gates';
    round.result = { cases: [{ id: 'unit', name: 'Unit tests pass', status: 'pass' }] };
    fixture.addRound(round);
    expect(() => loadLocalAcceptance(fixture.acceptanceDir, { create: true })).toThrow(
      ReportRoundError,
    );
  });

  it('reads the review log the page saved to the downloads folder', () => {
    const { info, source } = loadLocalAcceptance(fixture.acceptanceDir, { create: true });
    const bundle = assembleLocalAcceptance(source);
    const reviewLog = {
      acceptanceId: info.id,
      events: [
        {
          action: 'reject',
          comment: 'Title is cut off',
          createdAt: '2026-01-01T10:00:00.000Z',
          id: 'event-1',
          kind: 'checks',
          roundIndex: 1,
          targets: [{ checkId: 'rename', resultId: bundle.checks[0]!.result!.id }],
        },
      ],
      format: 1,
    };
    const downloads = path.join(fixture.root, 'Downloads');
    mkdirSync(downloads);
    // A second save of the same name gets a browser suffix; the newest one wins.
    writeFileSync(
      path.join(downloads, `${reviewExportPrefix(info.id)}.json`),
      JSON.stringify({ ...reviewLog, events: [] }),
    );
    const newest = path.join(downloads, `${reviewExportPrefix(info.id)} (1).json`);
    writeFileSync(newest, JSON.stringify(reviewLog));
    const later = new Date(Date.now() + 1000);
    utimesSync(newest, later, later);

    expect(findSavedReviewLog(info.id)).toBe(newest);
    const read = loadLocalAcceptance(fixture.acceptanceDir);
    expect(read.reviewsImported).toEqual({ added: 1, file: newest });
    expect(assembleLocalAcceptance(read.source).checks[0]!.userReview).toMatchObject({
      action: 'reject',
      comment: 'Title is cut off',
      stale: false,
    });
    // Filed beside the rounds; reading the same download again adds nothing.
    expect(
      JSON.parse(readFileSync(path.join(fixture.acceptanceDir, REVIEWS_FILE), 'utf8')).events,
    ).toHaveLength(1);
    expect(loadLocalAcceptance(fixture.acceptanceDir).reviewsImported).toEqual({
      added: 0,
      file: newest,
    });
  });

  it('rejects a saved review log of another acceptance', () => {
    loadLocalAcceptance(fixture.acceptanceDir, { create: true });
    const file = path.join(fixture.root, 'other.json');
    writeFileSync(file, JSON.stringify({ acceptanceId: 'someone-else', events: [], format: 1 }));
    expect(() => loadLocalAcceptance(fixture.acceptanceDir, { reviewsFile: file })).toThrow(
      'reviews of another acceptance',
    );
  });

  it('needs a render before read-only commands', () => {
    expect(() => loadLocalAcceptance(fixture.acceptanceDir)).toThrow('no acceptance.json yet');
  });
});
