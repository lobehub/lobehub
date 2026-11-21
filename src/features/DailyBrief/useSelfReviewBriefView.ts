import {
  formatSelfReviewBriefTitle,
  getSelfReviewBriefDetails,
  getSelfReviewProposalContent,
  hasSelfReviewProposalContent,
  type SelfReviewBriefDetails,
  type SelfReviewBriefDetailsTranslator,
  type SelfReviewProposalContentItem,
} from '@lobechat/agent-signal/brief';
import { useTranslation } from 'react-i18next';

import { type BriefItem } from './types';

export interface SelfReviewBriefView {
  /**
   * What each proposed action would write (skill body, system prompt, memory),
   * present only when there is more to read than the inline rows show.
   */
  content?: SelfReviewProposalContentItem[];
  details: SelfReviewBriefDetails;
  /** Title naming the main proposed change, in the reader's language. */
  title: string;
}

/**
 * Reads a nightly self-review brief (Agent Signal "dream") into its inline
 * display model.
 *
 * The details come from the frozen proposal / ideas in the brief metadata, not
 * from the persisted `title` / `summary`: briefs stored before those named the
 * change only say "a suggestion needs review", and reading the metadata gives
 * every such brief the same specific card.
 *
 * Returns `undefined` for any other brief, which keeps its stored text.
 */
export const useSelfReviewBriefView = (
  metadata: BriefItem['metadata'],
): SelfReviewBriefView | undefined => {
  const translate = useSelfReviewTranslator();

  const details = getSelfReviewBriefDetails(metadata);
  if (!details) return;

  const content = details.kind === 'proposal' ? getSelfReviewProposalContent(metadata) : undefined;

  return {
    ...(content && hasSelfReviewProposalContent(content) ? { content } : {}),
    details,
    title: formatSelfReviewBriefTitle(details, translate),
  };
};

/**
 * The `home` translator in the shape the shared self-review formatters take.
 * Their keys are composed at runtime (`…kind.${kind}.plain`), so the typed key
 * union is widened here, once.
 */
export const useSelfReviewTranslator = (): SelfReviewBriefDetailsTranslator => {
  const { t } = useTranslation('home');

  return (key, options) => t(key as 'brief.title', options);
};
