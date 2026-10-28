import { getLocalReport } from '../localReportData';
import { needsPublishedAcceptance } from './unavailable';

const commentsNeedSharing = async (): Promise<never> => {
  throw needsPublishedAcceptance('Comments');
};

/**
 * `@/services/acceptanceComment` for the offline report. The discussion holds
 * each round's proposal; talking to other people is what publishing is for, so
 * the list reports `canComment: false` and every write refuses.
 */
export const acceptanceCommentService = {
  answerAccessRequest: commentsNeedSharing,
  create: commentsNeedSharing,
  delete: commentsNeedSharing,
  list: async (_acceptanceId: string) => getLocalReport().comments(),
  react: commentsNeedSharing,
  requestAccess: commentsNeedSharing,
  setResolved: commentsNeedSharing,
};
