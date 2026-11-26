import { BadgeCheck, Ban, RotateCcw } from 'lucide-react';

import { userReviewState } from './checkState';
import type { AcceptanceCheck } from './types';

export type CheckDecision = 'accepted' | 'ignored' | 'needsFix' | 'notRun' | 'pending';
export type DecisionSegment = Exclude<CheckDecision, 'notRun'>;

export const checkDecision = (check: AcceptanceCheck): CheckDecision => {
  const review = userReviewState(check);
  if (review === 'accepted') return 'accepted';
  if (review === 'ignored') return 'ignored';
  if (review === 'rejected') return 'needsFix';
  return check.result ? 'pending' : 'notRun';
};

export const DECISION_ICON: Partial<Record<CheckDecision, typeof BadgeCheck>> = {
  accepted: BadgeCheck,
  ignored: Ban,
  needsFix: RotateCcw,
};

export const DECISION_LABEL_KEY = {
  accepted: 'acceptance.focus.state.accepted',
  ignored: 'acceptance.focus.state.ignored',
  needsFix: 'acceptance.focus.state.needsFix',
  notRun: 'acceptance.decision.notRun',
  pending: 'acceptance.focus.state.pending',
} as const satisfies Record<CheckDecision, string>;

const SEGMENT_ORDER: DecisionSegment[] = ['accepted', 'needsFix', 'ignored', 'pending'];

export const decisionSegments = (checks: AcceptanceCheck[]): DecisionSegment[] =>
  checks
    .map((check): DecisionSegment => {
      const decision = checkDecision(check);
      return decision === 'notRun' ? 'pending' : decision;
    })
    .sort((a, b) => SEGMENT_ORDER.indexOf(a) - SEGMENT_ORDER.indexOf(b));

const SECTION_ORDER: DecisionSegment[] = ['pending', 'needsFix', 'accepted', 'ignored'];

export const decisionSections = (checks: AcceptanceCheck[]) =>
  SECTION_ORDER.map((key) => ({
    checks: checks.filter((check) => {
      const decision = checkDecision(check);
      return (decision === 'notRun' ? 'pending' : decision) === key;
    }),
    key,
  })).filter((section) => section.checks.length > 0);
