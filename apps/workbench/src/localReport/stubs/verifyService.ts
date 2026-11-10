import type { AcceptanceCheckReviewAction, AcceptanceReviewAnnotation } from '@lobechat/types';
import type { LocalDeliveryDecision } from '@lobechat/utils/verify/localAcceptance';
import { localDecisionEvent, localReviewTargets } from '@lobechat/utils/verify/localAcceptance';

import { localEventId } from '../localEventId';
import { getLocalReport } from '../localReportData';
import { needsPublishedAcceptance } from './unavailable';

const currentRoundIndex = () => getLocalReport().bundle().rounds.at(-1)?.run.roundIndex ?? 0;

const getAcceptanceBundle = async (_id: string) => getLocalReport().bundle();

const reviewChecks = async (input: {
  action: AcceptanceCheckReviewAction;
  annotations?: AcceptanceReviewAnnotation[];
  checkItemIds: string[];
  comment?: string;
  fileIds?: string[];
}) => {
  if (input.fileIds?.length) throw needsPublishedAcceptance('Attaching files');
  const report = getLocalReport();
  const targets = localReviewTargets(report.bundle(), input.checkItemIds);
  report.append({
    action: input.action,
    ...(input.annotations?.length ? { annotations: input.annotations } : {}),
    ...(input.comment?.trim() ? { comment: input.comment.trim() } : {}),
    createdAt: new Date().toISOString(),
    id: localEventId(),
    kind: 'checks',
    roundIndex: currentRoundIndex(),
    targets,
  });
  return { resultIds: targets.map((target) => target.resultId) };
};

const addGroupFeedback = async (input: {
  category: string;
  comment: string;
  fileIds?: string[];
}) => {
  if (input.fileIds?.length) throw needsPublishedAcceptance('Attaching files');
  const entry = {
    category: input.category,
    comment: input.comment.trim(),
    createdAt: new Date().toISOString(),
  };
  const roundIndex = currentRoundIndex();
  getLocalReport().append({ ...entry, id: localEventId(), kind: 'group', roundIndex });
  return { entry: { ...entry, roundIndex }, success: true };
};

const decideDelivery = (action: LocalDeliveryDecision, comment?: string) => {
  const report = getLocalReport();
  report.append(
    localDecisionEvent(report.bundle(), {
      action,
      comment,
      createdAt: new Date().toISOString(),
      id: localEventId(),
    }),
  );
  return report.bundle().acceptance;
};

const acceptDelivery = async (_id: string, comment?: string) => decideDelivery('accept', comment);

/** Nothing to send the delivery back to: the page hands the repair prompt over itself. */
const rejectDelivery = async (_id: string, comment?: string) => decideDelivery('reject', comment);

const adjudicateProposal = async (): Promise<never> => {
  throw needsPublishedAcceptance('Review proposals');
};

/**
 * `@/services/verify` for the offline report: the bundle is the local one, and
 * a review is appended to the page's local review log instead of a server
 * mutation. The write rules are the server's — the same targets, the same
 * refusals — so the page answers a click exactly as the hosted one would.
 */
export const verifyService = {
  acceptDelivery,
  addGroupFeedback,
  adjudicateProposal,
  getAcceptanceBundle,
  rejectDelivery,
  reviewChecks,
};
