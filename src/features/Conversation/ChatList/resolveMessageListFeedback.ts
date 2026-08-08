interface ResolveMessageListFeedbackOptions {
  error?: unknown;
  isNewConversation: boolean;
  isStreaming: boolean;
  messagesInit: boolean;
}

export const resolveMessageListFeedback = ({
  error,
  isNewConversation,
  isStreaming,
  messagesInit,
}: ResolveMessageListFeedbackOptions) => {
  const hasError = error !== undefined && error !== null;

  return {
    showBackgroundError: messagesInit && hasError && !isStreaming,
    showFirstLoadError: !messagesInit && !isNewConversation && hasError,
    showSkeleton: !messagesInit && !isNewConversation && !hasError,
  };
};
