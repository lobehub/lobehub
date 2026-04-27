import type { FeedbackContextMessage } from './messageContextRenderer';
import { renderMessageContext } from './messageContextRenderer';

export const FEEDBACK_CONTEXT_RECENT_MESSAGE_LIMIT = 10;

/** Inputs required to assemble message-only feedback context. */
export interface AssembleFeedbackContextParams {
  feedbackMessage: FeedbackContextMessage;
  messages: FeedbackContextMessage[];
}

/** Output bundle returned by the feedback context assembler. */
export interface FeedbackContextAssemblyResult {
  latestAssistantReply?: FeedbackContextMessage;
  recentMessages: FeedbackContextMessage[];
  serializedContext: string;
}

const isAssistantMessage = (message: FeedbackContextMessage) => message.role === 'assistant';

/**
 * Assembles the message-only feedback context for Phase 1 analysis.
 *
 * Use when:
 * - Workflow ingress has already queried conversation messages
 * - Later feedback stages need one rendered context string plus the selected message window
 *
 * Expects:
 * - `messages` is already ordered from oldest to newest
 * - `feedbackMessage` is the current user feedback turn, even if it is not part of `messages`
 *
 * Returns:
 * - The selected recent messages, the resolved latest assistant reply, and rendered XML context
 */
export const assembleFeedbackContext = (
  params: AssembleFeedbackContextParams,
): FeedbackContextAssemblyResult => {
  const recentMessages = params.messages.slice(-FEEDBACK_CONTEXT_RECENT_MESSAGE_LIMIT);
  const latestAssistantReply = [...recentMessages].reverse().find(isAssistantMessage);

  return {
    latestAssistantReply,
    recentMessages,
    serializedContext: renderMessageContext({
      feedbackMessage: params.feedbackMessage,
      latestAssistantReply,
      recentMessages,
    }),
  };
};
