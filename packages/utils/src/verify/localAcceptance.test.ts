import { describe, expect, it } from 'vitest';

import {
  assembleLocalAcceptance,
  localAcceptanceComments,
  type LocalAcceptanceSource,
  type LocalReviewEvent,
  localReviewTargets,
  type LocalRoundSource,
  localSubjectFromKey,
  mergeLocalReviewEvents,
} from './localAcceptance';

const planItem = (id: string, title: string) => ({
  id,
  index: 0,
  onFail: 'manual' as const,
  required: true,
  title,
  verifierConfig: { requiredEvidence: [{ type: 'screenshot' as const }] },
  verifierType: 'agent' as const,
});

const round = (
  roundIndex: number,
  cases: { id: string; title: string; verdict: 'failed' | 'passed' | 'uncertain' }[],
  extra: Partial<LocalRoundSource> = {},
): LocalRoundSource => ({
  dir: `2026010${roundIndex}-000000-round`,
  evidence: cases.map((item) => ({
    checkResultId: `r${roundIndex}-${item.id}`,
    content: null,
    createdAt: `2026-01-0${roundIndex}T00:00:00.000Z`,
    description: `${item.title} screenshot`,
    fileHeight: 600,
    fileName: `${item.id}.png`,
    fileUrl: `2026010${roundIndex}-000000-round/assets/${item.id}.png`,
    fileWidth: 800,
    id: `e${roundIndex}-${item.id}`,
    metadata: null,
    type: 'screenshot' as const,
  })),
  proposal: null,
  report: {
    content: 'narrative',
    failedChecks: cases.filter((item) => item.verdict === 'failed').length,
    overallConfidence: null,
    passedChecks: cases.filter((item) => item.verdict === 'passed').length,
    summary: `round ${roundIndex}`,
    totalChecks: cases.length,
    uncertainChecks: null,
    verdict: cases.every((item) => item.verdict === 'passed') ? 'passed' : 'failed',
  },
  results: cases.map((item, index) => ({
    checkItemId: item.id,
    checkItemIndex: index,
    checkItemTitle: item.title,
    createdAt: `2026-01-0${roundIndex}T00:00:00.000Z`,
    id: `r${roundIndex}-${item.id}`,
    metadata: null,
    required: true,
    suggestion: null,
    toulmin: { evidence: `${item.title}: ${item.verdict}` },
    verdict: item.verdict,
  })),
  run: {
    context: { pullRequest: { title: 'Fix', url: 'https://github.com/lobehub/demo/pull/7' } },
    createdAt: `2026-01-0${roundIndex}T00:00:00.000Z`,
    goal: null,
    id: `run-${roundIndex}`,
    metadata: null,
    plan: cases.map((item) => planItem(item.id, item.title)),
    roundIndex,
    scenario: 'coding',
    title: `Round ${roundIndex}`,
  },
  ...extra,
});

const source = (
  rounds: LocalRoundSource[],
  reviews: LocalReviewEvent[] = [],
): LocalAcceptanceSource => ({
  acceptance: {
    createdAt: '2026-01-01T00:00:00.000Z',
    id: 'acc-local',
    requirement: 'Users can rename a topic',
    subjectKey: 'standalone-rename',
  },
  format: 1,
  generatedAt: '2026-01-03T00:00:00.000Z',
  reviews,
  rounds,
});

describe('assembleLocalAcceptance', () => {
  it('folds rounds into the union the acceptance page renders', () => {
    const bundle = assembleLocalAcceptance(
      source([
        round(1, [
          { id: 'rename', title: 'Rename keeps focus', verdict: 'failed' },
          { id: 'toast', title: 'Toast copy', verdict: 'passed' },
        ]),
        round(2, [{ id: 'rename', title: 'Rename keeps focus', verdict: 'passed' }]),
      ]),
    );

    expect(bundle.checks.map((check) => [check.id, check.seq, check.state])).toEqual([
      ['rename', 1, 'passed'],
      ['toast', 2, 'passed'],
    ]);
    const rename = bundle.checks[0]!;
    expect(rename.fixed).toBe(true);
    expect(rename.timeline.map((entry) => entry.evidence[0]?.fileUrl)).toEqual([
      '20260101-000000-round/assets/rename.png',
      '20260102-000000-round/assets/rename.png',
    ]);
    expect(rename.evidence[0]?.checkItemId).toBe('rename');
    // Round 2 planned only `rename`; `toast` keeps its round-1 evidence.
    expect(bundle.checks[1]!.resultRound).toBe(1);
    expect(bundle.acceptance.status).toBe('delivered');
    expect(bundle.latestReport?.summary).toBe('round 2');
    expect(bundle.subject).toEqual({
      id: 'standalone-rename',
      title: 'Round 2',
      type: 'standalone',
    });
    expect(bundle.pullRequests).toMatchObject([
      { number: 7, repoFullName: 'lobehub/demo', source: 'manual' },
    ]);
    expect(bundle.canReview).toBe(true);
  });

  it('keeps a decision on the round it judged, so a re-run makes a reject stale', () => {
    const rounds = [
      round(1, [
        { id: 'rename', title: 'Rename keeps focus', verdict: 'passed' },
        { id: 'toast', title: 'Toast copy', verdict: 'passed' },
      ]),
    ];
    const first = assembleLocalAcceptance(source(rounds));
    const reviews: LocalReviewEvent[] = [
      {
        action: 'reject',
        annotations: [
          {
            comment: 'Caret jumps to the start',
            evidenceId: 'e1-rename',
            rect: { h: 0.2, w: 0.2, x: 0.1, y: 0.1 },
          },
        ],
        comment: 'Focus is lost',
        createdAt: '2026-01-01T10:00:00.000Z',
        id: 'ev-1',
        kind: 'checks',
        roundIndex: 1,
        targets: localReviewTargets(first, ['rename']),
      },
      {
        action: 'accept',
        createdAt: '2026-01-01T10:01:00.000Z',
        id: 'ev-2',
        kind: 'checks',
        roundIndex: 1,
        targets: localReviewTargets(first, ['toast']),
      },
      {
        category: 'Rename',
        comment: 'Also check keyboard-only',
        createdAt: '2026-01-01T10:02:00.000Z',
        id: 'ev-3',
        kind: 'group',
        roundIndex: 1,
      },
    ];

    const reviewed = assembleLocalAcceptance(source(rounds, reviews));
    expect(reviewed.checks[0]!.userReview).toMatchObject({
      action: 'reject',
      comment: 'Focus is lost',
      stale: false,
    });
    expect(reviewed.checks[0]!.userReview?.annotations?.[0]?.evidenceId).toBe('e1-rename');
    expect(reviewed.checks[1]!.userReview).toMatchObject({ action: 'accept', stale: false });
    expect(reviewed.rounds[0]!.run.decisionDetail?.groupFeedback).toEqual([
      {
        category: 'Rename',
        comment: 'Also check keyboard-only',
        createdAt: '2026-01-01T10:02:00.000Z',
      },
    ]);

    const repaired = assembleLocalAcceptance(
      source(
        [...rounds, round(2, [{ id: 'rename', title: 'Rename keeps focus', verdict: 'passed' }])],
        reviews,
      ),
    );
    // The reject stays on round 1's row: history now, not the round-2 verdict.
    expect(repaired.checks[0]!.userReview).toMatchObject({ action: 'reject', stale: true });
    expect(repaired.checks[0]!.reviews).toHaveLength(1);
    // An accept is sticky across rounds.
    expect(repaired.checks[1]!.userReview).toMatchObject({ action: 'accept', stale: false });
  });
});

describe('localReviewTargets', () => {
  it('refuses unknown and never-executed checks, like the server', () => {
    const bundle = assembleLocalAcceptance(
      source([
        round(1, [{ id: 'rename', title: 'Rename', verdict: 'passed' }], {
          run: {
            ...round(1, []).run,
            plan: [planItem('rename', 'Rename'), planItem('later', 'Later')],
          },
        }),
      ]),
    );
    expect(() => localReviewTargets(bundle, ['missing'])).toThrow('Unknown check item(s): missing');
    expect(() => localReviewTargets(bundle, ['later'])).toThrow('never executed');
    expect(localReviewTargets(bundle, ['rename'])).toEqual([
      { checkId: 'rename', resultId: 'r1-rename' },
    ]);
  });
});

describe('localAcceptanceComments', () => {
  it('posts each round proposal as that round’s note', () => {
    const list = localAcceptanceComments(
      source([round(1, [], { proposal: '  Rename now keeps focus.  ' }), round(2, [])]),
    );
    expect(list.canComment).toBe(false);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      content: 'Rename now keeps focus.',
      contextRoundIndex: 1,
      contextRunId: 'run-1',
      kind: 'proposal',
    });
  });
});

describe('localSubjectFromKey', () => {
  it('reads the subject the directory is keyed by', () => {
    expect(localSubjectFromKey('task-T-12')).toEqual({ id: 'T-12', type: 'task' });
    expect(localSubjectFromKey('standalone-rename')).toEqual({
      id: 'standalone-rename',
      type: 'standalone',
    });
    expect(localSubjectFromKey('my-feature')).toEqual({ id: 'my-feature', type: 'standalone' });
  });
});

describe('mergeLocalReviewEvents', () => {
  it('dedupes by id and orders by time', () => {
    const a: LocalReviewEvent = {
      category: 'A',
      comment: 'a',
      createdAt: '2026-01-02T00:00:00.000Z',
      id: 'a',
      kind: 'group',
      roundIndex: 1,
    };
    const b: LocalReviewEvent = { ...a, createdAt: '2026-01-01T00:00:00.000Z', id: 'b' };
    expect(mergeLocalReviewEvents([a], [b, a]).map((event) => event.id)).toEqual(['b', 'a']);
  });
});
