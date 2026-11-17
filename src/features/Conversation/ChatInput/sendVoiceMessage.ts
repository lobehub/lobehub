import type { ConversationContext, SendMessageParams, UploadFileItem } from '@lobechat/types';

import type { DraftGitSendResult } from '@/features/ChatInput/ControlBar/DraftGit/prepareSend';

type SendMessage = (
  params: SendMessageParams & { conversationContext?: ConversationContext },
) => Promise<void>;

interface SendVoiceMessageOptions {
  context?: ConversationContext;
  optimisticUserMessageId?: string;
  /**
   * Run before anything is dispatched — the composer's send-time git step for a
   * new topic. `ok: false` (cancelled or failed) rejects the send, which keeps
   * the recording as a retryable failed turn.
   */
  prepare?: () => Promise<DraftGitSendResult>;
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
  const { context, optimisticUserMessageId, prepare, signal, transcribe } = options;
  if (signal?.aborted) throw getAbortError(signal);

  const message = transcribe ? await transcribe(file, signal) : '';
  if (signal?.aborted) throw getAbortError(signal);

  // After transcription, the last step that can fail before dispatch: a retry
  // after a failed transcript must still find the branch pick unspent and no
  // worktree made for it.
  const prepared = prepare ? await prepare() : undefined;
  if (prepared && !prepared.ok)
    throw new Error('Voice message was not sent: git step did not complete');
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
      ...(prepared?.ok
        ? {
            firstSendWorktree: prepared.firstSendWorktree,
            newTopicWorkingDirectory: prepared.newTopicWorkingDirectory,
            onMessagePersisted: prepared.onMessagePersisted,
          }
        : {}),
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
