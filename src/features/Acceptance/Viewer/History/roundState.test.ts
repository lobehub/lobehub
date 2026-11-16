import type { TFunction } from 'i18next';
import { BadgeCheck, Info, Loader2, RotateCcw, Wrench } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import type { AcceptanceBundle } from '@/services/verify';

import { buildRoundCards, resolveRoundState, roundStateMeta } from './roundState';

const t = ((key: string) => key) as TFunction<'verify'>;

const settled = { accepted: 0, hasReport: true, status: 'passed', total: 8, userDecision: null };

describe('resolveRoundState', () => {
  it('names a round that has not started instead of leaking its raw status', () => {
    expect(resolveRoundState({ ...settled, hasReport: false, status: 'pending' })).toBe('waiting');
    expect(resolveRoundState({ ...settled, hasReport: false, status: 'planned' })).toBe('waiting');
  });

  it('reads a round without a status or report as running', () => {
    expect(resolveRoundState({ ...settled, hasReport: false, status: null })).toBe('running');
    expect(resolveRoundState({ ...settled, status: 'verifying' })).toBe('running');
  });

  it('keeps repairing and errored apart from running', () => {
    expect(resolveRoundState({ ...settled, status: 'repairing' })).toBe('repairing');
    expect(resolveRoundState({ ...settled, status: 'errored' })).toBe('errored');
  });

  it('waits on the reviewer until every check of the round is accepted', () => {
    expect(resolveRoundState(settled)).toBe('toReview');
    expect(resolveRoundState({ ...settled, accepted: 4 })).toBe('toReview');
    expect(resolveRoundState({ ...settled, accepted: 8 })).toBe('accepted');
    expect(resolveRoundState({ ...settled, total: 0 })).toBe('toReview');
  });

  it('reports a sent-back round as rejected whatever its tally', () => {
    expect(resolveRoundState({ ...settled, accepted: 8, userDecision: 'reject' })).toBe('rejected');
  });

  it('settles a failed or uncertain verification into a review state', () => {
    expect(resolveRoundState({ ...settled, hasReport: false, status: 'failed' })).toBe('toReview');
    expect(resolveRoundState({ ...settled, hasReport: false, status: 'uncertain' })).toBe(
      'toReview',
    );
  });
});

describe('roundStateMeta', () => {
  it('speaks one vocabulary', () => {
    const labels = (
      ['waiting', 'running', 'repairing', 'errored', 'toReview', 'rejected', 'accepted'] as const
    ).map((state) => roundStateMeta(state, t).label);
    expect(labels).toEqual([
      'acceptance.roundState.waiting',
      'acceptance.roundState.running',
      'acceptance.roundState.repairing',
      'acceptance.roundState.errored',
      'acceptance.roundState.toReview',
      'acceptance.roundState.rejected',
      'acceptance.roundState.accepted',
    ]);
  });

  it('spins only while the round is waiting or running', () => {
    expect(roundStateMeta('waiting', t)).toMatchObject({ icon: Loader2, spin: true, tone: 'info' });
    expect(roundStateMeta('running', t)).toMatchObject({ icon: Loader2, spin: true, tone: 'info' });
    expect(roundStateMeta('repairing', t)).toMatchObject({
      icon: Wrench,
      spin: false,
      tone: 'warning',
    });
  });

  it('shows an errored round with a static icon', () => {
    expect(roundStateMeta('errored', t)).toMatchObject({
      icon: Info,
      spin: false,
      tone: 'warning',
    });
  });

  it('leaves the review state as plain text', () => {
    const meta = roundStateMeta('toReview', t);
    expect(meta.icon).toBeUndefined();
    expect(meta.tone).toBe('neutral');
  });

  it('takes the settled icons from the acceptance verdict', () => {
    expect(roundStateMeta('rejected', t)).toMatchObject({
      icon: RotateCcw,
      spin: false,
      tone: 'error',
    });
    expect(roundStateMeta('accepted', t)).toMatchObject({
      icon: BadgeCheck,
      spin: false,
      tone: 'success',
    });
  });
});

const step = (roundIndex: number) => ({ evidence: [], roundIndex, state: 'passed', title: 'step' });

const check = (
  id: string,
  options: {
    reviews?: { action: 'accept' | 'ignore' | 'reject'; roundIndex: number }[];
    rounds: number[];
  },
) => {
  const reviews = options.reviews ?? [];
  const latest = reviews.at(-1);
  return {
    evidence: [],
    id,
    result: { id: `result-${id}` },
    resultRound: options.rounds.at(-1),
    reviews,
    state: 'passed',
    timeline: options.rounds.map(step),
    title: id,
    userReview: latest
      ? { ...latest, stale: latest.roundIndex !== options.rounds.at(-1) }
      : undefined,
  };
};

const round = (roundIndex: number, run: Record<string, unknown> = {}, report: unknown = {}) => ({
  report,
  run: { id: `run-${roundIndex}`, plan: [], roundIndex, status: 'passed', ...run },
});

const bundle = (value: { checks: unknown[]; rounds: unknown[] }) =>
  value as unknown as AcceptanceBundle;

describe('buildRoundCards', () => {
  it('lists the newest round first and marks it latest', () => {
    const cards = buildRoundCards(bundle({ checks: [], rounds: [round(1), round(2)] }));
    expect(cards.map((card) => card.round.run.roundIndex)).toEqual([2, 1]);
    expect(cards.map((card) => card.isLatest)).toEqual([true, false]);
  });

  it('tallies each round from the decisions made in that round', () => {
    const cards = buildRoundCards(
      bundle({
        checks: [
          check('a', {
            reviews: [
              { action: 'reject', roundIndex: 1 },
              { action: 'accept', roundIndex: 2 },
            ],
            rounds: [1, 2],
          }),
          check('b', { reviews: [{ action: 'accept', roundIndex: 1 }], rounds: [1, 2] }),
          check('c', { rounds: [1, 2] }),
        ],
        rounds: [
          round(1, { decisionDetail: { comment: 'Range resets.' }, userDecision: 'reject' }),
          round(2),
        ],
      }),
    );

    expect(cards[0]).toMatchObject({ accepted: 1, state: 'toReview', total: 3 });
    expect(cards[0].segments).toEqual(['accepted', 'pending', 'pending']);
    expect(cards[1]).toMatchObject({
      accepted: 1,
      reason: 'Range resets.',
      state: 'rejected',
      total: 3,
    });
    expect(cards[1].segments).toEqual(['accepted', 'needsFix', 'pending']);
  });

  it('opens only the rounds that have a report', () => {
    const cards = buildRoundCards(
      bundle({ checks: [], rounds: [round(1), round(2, { status: 'pending' }, null)] }),
    );
    expect(cards.map((card) => card.openable)).toEqual([false, true]);
    expect(cards[0].state).toBe('waiting');
  });
});
