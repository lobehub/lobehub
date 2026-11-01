interface ResolveMessageListFeedbackOptions {
  error?: unknown;
  /** Cached rows are on screen while the first server fetch is in flight. */
  isInitialRevalidation?: boolean;
  isNewConversation: boolean;
  isStreaming: boolean;
  messagesInit: boolean;
}

export const resolveMessageListFeedback = ({
  error,
  isInitialRevalidation = false,
  isNewConversation,
  isStreaming,
  messagesInit,
}: ResolveMessageListFeedbackOptions) => {
  const hasError = error !== undefined && error !== null;

  return {
    showBackgroundError: messagesInit && hasError && !isStreaming,
    showRefreshing: messagesInit && isInitialRevalidation && !hasError,
    showFirstLoadError: !messagesInit && !isNewConversation && hasError,
    showSkeleton: !messagesInit && !isNewConversation && !hasError,
  };
};
