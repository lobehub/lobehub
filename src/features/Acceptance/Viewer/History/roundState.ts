import type { TFunction } from 'i18next';
import { Info, type LucideIcon, Wrench } from 'lucide-react';

import type { AcceptanceBundle } from '@/services/verify';

import { type DecisionSegment, decisionSegments } from '../Checks/checkDecision';
import { checksForTurn } from '../turnChecks';
import { resolveAcceptanceVerdictMeta } from '../verdict';

export type AcceptanceRound = AcceptanceBundle['rounds'][number];

export type RoundState =
  'accepted' | 'errored' | 'rejected' | 'repairing' | 'running' | 'toReview' | 'waiting';

export type RoundTone = 'error' | 'info' | 'neutral' | 'success' | 'warning';

const WAITING_STATUSES = new Set(['pending', 'planned']);
const SETTLED_STATUSES = new Set(['failed', 'passed', 'uncertain']);

export const resolveRoundState = ({
  accepted,
  hasReport,
  status,
  total,
  userDecision,
}: {
  accepted: number;
  hasReport: boolean;
  status?: string | null;
  total: number;
  userDecision?: string | null;
}): RoundState => {
  if (status === 'errored') return 'errored';
  if (status === 'repairing') return 'repairing';
  if (status === 'verifying') return 'running';
  if (!hasReport && !(status && SETTLED_STATUSES.has(status)))
    return status && WAITING_STATUSES.has(status) ? 'waiting' : 'running';
  if (userDecision === 'reject') return 'rejected';
  return total > 0 && accepted >= total ? 'accepted' : 'toReview';
};

const VERDICT_STATUS: Record<RoundState, string> = {
  accepted: 'accepted',
  errored: 'errored',
  rejected: 'rejected',
  repairing: 'repairing',
  running: 'verifying',
  toReview: 'delivered',
  waiting: 'pending',
};

const ROUND_STATE_TONE: Record<RoundState, RoundTone> = {
  accepted: 'success',
  errored: 'warning',
  rejected: 'error',
  repairing: 'warning',
  running: 'info',
  toReview: 'neutral',
  waiting: 'info',
};

const ROUND_STATE_LABEL_KEY = {
  accepted: 'acceptance.roundState.accepted',
  errored: 'acceptance.roundState.errored',
  rejected: 'acceptance.roundState.rejected',
  repairing: 'acceptance.roundState.repairing',
  running: 'acceptance.roundState.running',
  toReview: 'acceptance.roundState.toReview',
  waiting: 'acceptance.roundState.waiting',
} as const satisfies Record<RoundState, string>;

const STATIC_ICON: Partial<Record<RoundState, LucideIcon | null>> = {
  errored: Info,
  repairing: Wrench,
  toReview: null,
};

export interface RoundStateMeta {
  icon?: LucideIcon;
  label: string;
  spin: boolean;
  tone: RoundTone;
}

export const roundStateMeta = (state: RoundState, t: TFunction<'verify'>): RoundStateMeta => {
  const label = t(ROUND_STATE_LABEL_KEY[state]);
  const tone = ROUND_STATE_TONE[state];
  if (state in STATIC_ICON)
    return { icon: STATIC_ICON[state] ?? undefined, label, spin: false, tone };
  const verdict = resolveAcceptanceVerdictMeta(VERDICT_STATUS[state], t);
  return { icon: verdict.icon, label, spin: Boolean(verdict.spin), tone };
};

export interface RoundCardModel {
  accepted: number;
  isLatest: boolean;
  openable: boolean;
  reason: string | null;
  round: AcceptanceRound;
  segments: DecisionSegment[];
  state: RoundState;
  total: number;
}

const roundChecks = (data: AcceptanceBundle, roundIndex: number | null, isLatest: boolean) => {
  if (isLatest) return data.checks;
  if (roundIndex === null) return [];
  return checksForTurn(data, roundIndex);
};

export const buildRoundCards = (data: AcceptanceBundle): RoundCardModel[] => {
  const latestIndex = data.rounds.at(-1)?.run.roundIndex;
  return [...data.rounds].reverse().map((round) => {
    const roundIndex = round.run.roundIndex ?? null;
    const isLatest = roundIndex === latestIndex;
    const segments = decisionSegments(roundChecks(data, roundIndex, isLatest));
    const accepted = segments.filter((segment) => segment === 'accepted').length;
    const state = resolveRoundState({
      accepted,
      hasReport: Boolean(round.report),
      status: round.run.status,
      total: segments.length,
      userDecision: round.run.userDecision,
    });
    return {
      accepted,
      isLatest,
      openable: Boolean(round.report),
      reason: state === 'rejected' ? round.run.decisionDetail?.comment || null : null,
      round,
      segments,
      state,
      total: segments.length,
    };
  });
};
