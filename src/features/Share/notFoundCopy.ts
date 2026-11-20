export interface ShareNotFoundCopy {
  desc: string;
  title: string;
}

/**
 * What a missing share is called. The topic wording is the default; a share
 * page of another kind (a file) names its own subject.
 */
export const resolveShareNotFoundCopy = (
  pageCopy: ShareNotFoundCopy | undefined,
  topicCopy: ShareNotFoundCopy,
): ShareNotFoundCopy => pageCopy ?? topicCopy;
