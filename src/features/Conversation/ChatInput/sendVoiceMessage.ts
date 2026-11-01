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
  /**
   * Resolve the turn text from the uploaded recording. Runtimes that cannot take audio input
   * (heterogeneous agents) send the transcript as the message content instead of an audio-only turn.
   */
  transcribe?: (file: UploadFileItem, signal?: AbortSignal) => Promise<string>;
}

const getAbortError = (signal: AbortSignal) =>
  signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Voice message send was cancelled', 'AbortError');

/**
 * Dispatch a voice turn (audio-only, or its transcript when `transcribe` is given) and retain the recording until the conversation lifecycle owns it
 * as either a persisted user message or a queued turn.
 */
export const sendVoiceMessage = async (
  sendMessage: SendMessage,
  file: UploadFileItem,
  options: SendVoiceMessageOptions = {},
) => {
  const { context, optimisticUserMessageId, signal, transcribe } = options;
  if (signal?.aborted) throw getAbortError(signal);

  const message = transcribe ? await transcribe(file, signal) : '';
  if (signal?.aborted) throw getAbortError(signal);

  return new Promise<void>((resolve, reject) => {
    let accepted = false;

    void sendMessage({
      files: [file],
      message,
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
