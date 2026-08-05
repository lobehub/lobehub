import {
  type ConversationContext,
  type SendMessageParams,
  type UploadFileItem,
} from '@lobechat/types';

type SendMessage = (
  params: SendMessageParams & { conversationContext?: ConversationContext },
) => Promise<void>;

interface SendVoiceMessageOptions {
  context?: ConversationContext;
  optimisticUserMessageId?: string;
  signal?: AbortSignal;
}

const getAbortError = (signal: AbortSignal) =>
  signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Voice message send was cancelled', 'AbortError');

/**
 * Dispatch an audio-only turn and retain the recording until the conversation lifecycle owns it
 * as either a persisted user message or a queued turn.
 */
export const sendVoiceMessage = (
  sendMessage: SendMessage,
  file: UploadFileItem,
  options: SendVoiceMessageOptions = {},
) => {
  const { context, optimisticUserMessageId, signal } = options;
  if (signal?.aborted) return Promise.reject(getAbortError(signal));

  return new Promise<void>((resolve, reject) => {
    let accepted = false;

    void sendMessage({
      files: [file],
      message: '',
      onMessageAccepted: () => {
        accepted = true;
        resolve();
      },
      preserveComposer: true,
      ...(context ? { conversationContext: context } : {}),
      ...(optimisticUserMessageId ? { optimisticUserMessageId } : {}),
      ...(signal ? { signal } : {}),
    }).then(
      () => {
        if (accepted) return;

        reject(
          signal?.aborted ? getAbortError(signal) : new Error('Voice message was not accepted'),
        );
      },
      (error) => {
        if (accepted) return;

        reject(signal?.aborted ? getAbortError(signal) : error);
      },
    );
  });
};
