import type { VerifyUserDecision } from '@lobechat/const/verify';
import type { VerifyCheckItem } from '@lobechat/types';

export interface ReviewPlanMark {
  content: string;
  id: string;
  pageUrl: string;
  seq: number;
}

export interface ReviewMarkOutcome {
  state: 'failed' | 'not_executed' | 'passed' | 'uncertain';
  userDecision: VerifyUserDecision | null;
}

const TITLE_LIMIT = 40;

const title = (mark: ReviewPlanMark) => {
  const text = mark.content.trim();
  return `#${mark.seq} ${text.length > TITLE_LIMIT ? `${text.slice(0, TITLE_LIMIT)}…` : text}`;
};

const settled = (outcome: ReviewMarkOutcome | undefined) =>
  outcome?.userDecision === 'accepted' || outcome?.userDecision === 'overridden';

const needsWork = (outcome: ReviewMarkOutcome | undefined) => {
  if (!outcome) return true;
  if (settled(outcome)) return false;
  return outcome.userDecision === 'rejected' || outcome.state !== 'passed';
};

const pick = (marks: ReviewPlanMark[], previous: Map<string, ReviewMarkOutcome>) => {
  const flagged = marks.filter((mark) => needsWork(previous.get(mark.id)));
  return flagged.length ? flagged : marks.filter((mark) => !settled(previous.get(mark.id)));
};

export const buildReviewPlanItems = (
  marks: ReviewPlanMark[],
  previous: Map<string, ReviewMarkOutcome>,
): VerifyCheckItem[] =>
  pick(marks, previous).map((mark, index) => ({
    description: `Review mark #${mark.seq} on ${mark.pageUrl}: ${mark.content}`,
    id: mark.id,
    index,
    onFail: 'manual',
    required: true,
    title: title(mark),
    verifierConfig: {},
    verifierType: 'agent',
  }));
